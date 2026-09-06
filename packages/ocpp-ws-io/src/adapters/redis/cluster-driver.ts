import { createRequire } from "node:module";
import type { RedisPubSubDriver, StreamEntry } from "./helpers.js";

// ─── Redis Cluster Driver ───────────────────────────────────────
//
// Wraps an ioredis `Cluster` instance (or compatible) and exposes
// the same RedisPubSubDriver interface.

export interface ClusterNode {
  host: string;
  port: number;
}

export interface ClusterDriverOptions {
  /** Seed nodes for the Redis Cluster */
  nodes: ClusterNode[];
  /** NAT mapping for Docker/k8s environments */
  natMap?: Record<string, { host: string; port: number }>;
  /** Additional ioredis options passed to the Cluster constructor */
  redisOptions?: Record<string, unknown>;
  /**
   * @deprecated Never read. Key prefixing is configured on the adapter via
   * `RedisAdapterOptions.prefix`; this field was documented as driving hash-tag
   * generation but no hash tags were ever emitted. Cross-slot batches are
   * handled by falling back to individual commands instead — see `xaddBatch`
   * and `mget`. Setting this has no effect.
   */
  prefix?: string;
}

/**
 * Redis Cluster driver that implements `RedisPubSubDriver`.
 * Requires `ioredis` as a peer dependency.
 *
 * @example
 * ```ts
 * const driver = new ClusterDriver({
 *   nodes: [{ host: '10.0.0.1', port: 6379 }, { host: '10.0.0.2', port: 6379 }],
 * });
 * const adapter = new RedisAdapter({ driver });
 * ```
 */
export class ClusterDriver implements RedisPubSubDriver {
  private _cluster: any;
  private _subscriber: any;
  private _handlers = new Map<string, (msg: string) => void>();
  /** Distinguishes the initial connect from a genuine reconnect. */
  private _hasBeenReady = false;

  /** Cluster connections share command pipelines — never issue blocking reads. */
  readonly hasBlockingClient = false;

  constructor(_options: ClusterDriverOptions) {
    // Dynamically require ioredis to avoid bundling it. `__filename` exists
    // in the CJS build natively and via the tsup shim in the ESM build.
    let IoRedis: any;
    try {
      const dynamicRequire = createRequire(__filename);
      IoRedis = dynamicRequire("ioredis");
    } catch {
      throw new Error(
        "ClusterDriver requires 'ioredis' as a peer dependency. Install it with: npm i ioredis",
      );
    }

    const redisOpts = _options.redisOptions ?? {};

    // `natMap` is a top-level Cluster option in ioredis — `redisOptions` is
    // forwarded to each individual node connection, where natMap is never
    // read. Nesting it there silently disabled NAT mapping in Docker/k8s.
    const clusterOpts: Record<string, unknown> = { redisOptions: redisOpts };
    if (_options.natMap) {
      clusterOpts.natMap = _options.natMap;
    }

    const nodes = () =>
      _options.nodes.map((n) => ({ host: n.host, port: n.port }));

    // Construction errors (bad nodes, auth, etc.) now propagate as-is
    this._cluster = new IoRedis.Cluster(nodes(), clusterOpts);
    // Separate subscriber connection for Pub/Sub
    this._subscriber = new IoRedis.Cluster(nodes(), clusterOpts);

    this._subscriber.on("message", (channel: string, message: string) => {
      const handler = this._handlers.get(channel);
      if (handler) handler(message);
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    await this._cluster.publish(channel, message);
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<void> {
    this._handlers.set(channel, handler);
    await this._subscriber.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    await this._subscriber.unsubscribe(channel);
    this._handlers.delete(channel);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this._cluster.set(key, value, "EX", ttlSeconds);
    } else {
      await this._cluster.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return (await this._cluster.get(key)) || null;
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    // ioredis Cluster mget requires all keys in the same slot,
    // so we fall back to individual gets when cross-slot
    try {
      return await this._cluster.mget(...keys);
    } catch {
      return await Promise.all(keys.map((k) => this.get(k)));
    }
  }

  async del(key: string): Promise<void> {
    await this._cluster.del(key);
  }

  async evalScript(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    // Every fencing script touches exactly one key, so it is slot-safe.
    return this._cluster.eval(script, keys.length, ...keys, ...args);
  }

  async xadd(
    stream: string,
    args: Record<string, string>,
    maxLen?: number,
  ): Promise<string> {
    const flatArgs: string[] = [];
    if (maxLen) {
      flatArgs.push("MAXLEN", "~", maxLen.toString());
    }
    flatArgs.push("*");
    for (const [k, v] of Object.entries(args)) {
      flatArgs.push(k, v);
    }
    return (await this._cluster.xadd(stream, ...flatArgs)) as string;
  }

  async xaddBatch(
    messages: { stream: string; args: Record<string, string> }[],
    maxLen?: number,
  ): Promise<void> {
    if (messages.length === 0) return;

    const buildArgs = (msg: {
      stream: string;
      args: Record<string, string>;
    }): string[] => {
      const flatArgs: string[] = [];
      if (maxLen) {
        flatArgs.push("MAXLEN", "~", maxLen.toString());
      }
      flatArgs.push("*");
      for (const [k, v] of Object.entries(msg.args)) {
        flatArgs.push(k, v);
      }
      return flatArgs;
    };

    const sendOne = (msg: { stream: string; args: Record<string, string> }) =>
      this._cluster.xadd(msg.stream, ...buildArgs(msg));

    // A cluster pipeline requires every key to live in one hash slot. Per-node
    // stream keys are not hash-tagged, so any batch addressing more than one
    // node is cross-slot: ioredis either rejects the whole pipeline or returns
    // per-command errors, which used to be discarded so a total failure looked
    // like success. Same try/fallback shape as mget() above.
    //
    // Only the failed entries are retried individually — replaying the whole
    // batch would duplicate the ones that did land, and these are streams.
    try {
      const pipeline = this._cluster.pipeline();
      for (const msg of messages) {
        pipeline.xadd(msg.stream, ...buildArgs(msg));
      }
      const results = (await pipeline.exec()) as
        | [Error | null, unknown][]
        | null;

      if (results) {
        const failed = messages.filter((_, i) => results[i]?.[0]);
        if (failed.length === 0) return;
        await Promise.all(failed.map(sendOne));
        return;
      }
    } catch {
      // Pipeline rejected before dispatch — nothing was written, so it is safe
      // to send every entry individually below.
    }

    await Promise.all(messages.map(sendOne));
  }

  async xread(
    streams: { key: string; id: string }[],
    count?: number,
    block?: number,
  ): Promise<StreamEntry[] | null> {
    const args: (string | number)[] = [];
    if (count) args.push("COUNT", count);
    if (typeof block === "number") args.push("BLOCK", block);
    args.push("STREAMS");
    for (const s of streams) args.push(s.key);
    for (const s of streams) args.push(s.id);

    const result = (await this._cluster.xread(...args)) as any;
    if (!result) return null;

    return result.map(([stream, messages]: any) => ({
      stream,
      messages: messages.map(([id, fields]: any) => {
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]] = fields[i + 1];
        }
        return { id, data };
      }),
    }));
  }

  async xlen(stream: string): Promise<number> {
    return (await this._cluster.xlen(stream)) as number;
  }

  async disconnect(): Promise<void> {
    this._handlers.clear();
    await Promise.allSettled([this._cluster.quit(), this._subscriber.quit()]);
  }

  async setPresenceBatch(
    entries: { key: string; value: string; ttlSeconds: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    // Redis Cluster pipelines cannot span hash slots — issue per-key SETs
    // and let the cluster client route each one (report M2).
    await Promise.all(
      entries.map(({ key, value, ttlSeconds }) =>
        this._cluster.set(key, value, "EX", ttlSeconds),
      ),
    );
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this._cluster.expire(key, ttlSeconds);
  }

  onError(handler: (err: Error) => void): () => void {
    // Both connections must be covered: an unhandled 'error' event on the
    // subscriber is an uncaught exception that takes down the process.
    this._cluster.on("error", handler);
    this._subscriber.on("error", handler);
    return () => {
      this._cluster.removeListener("error", handler);
      this._subscriber.removeListener("error", handler);
    };
  }

  onReconnect(handler: () => void): () => void {
    // 'reconnecting' fires while the connection is still DOWN — anything the
    // handler does (e.g. presence rehydration) fails against a dead socket and
    // is never retried. 'ready' is the event that means the cluster is usable.
    // The first 'ready' is the initial connect, not a reconnect, so it is
    // skipped; every later one is a genuine recovery.
    const onReady = () => {
      if (this._hasBeenReady) handler();
      else this._hasBeenReady = true;
    };
    this._cluster.on("ready", onReady);
    return () => this._cluster.removeListener("ready", onReady);
  }
}
