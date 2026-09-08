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
   * Set false to skip the dedicated blocking-read connection, trading cross-node
   * latency for one fewer cluster connection. (default: true)
   */
  blockingReads?: boolean;
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

  private _blocking: any;

  /**
   * True once a dedicated connection exists for blocking XREAD.
   *
   * A blocking read on a shared connection would head-of-line block every other
   * command on it, which is why this used to be hardcoded false. But the
   * consequence was that every Redis Cluster deployment fell back to
   * non-blocking polls with a 1s sleep — up to a second of added latency on
   * each direction of every cross-node RPC. A third, dedicated cluster
   * connection removes that without risking the shared ones.
   */
  get hasBlockingClient(): boolean {
    return !!this._blocking;
  }

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
    const clusterOpts: Record<string, unknown> = {
      redisOptions: redisOpts,
    };
    if (_options.natMap) {
      clusterOpts.natMap = _options.natMap;
    }

    const nodes = () =>
      _options.nodes.map((n) => ({ host: n.host, port: n.port }));

    // Construction errors (bad nodes, auth, etc.) now propagate as-is
    this._cluster = new IoRedis.Cluster(nodes(), clusterOpts);
    // Separate subscriber connection for Pub/Sub
    this._subscriber = new IoRedis.Cluster(nodes(), clusterOpts);

    // Dedicated connection for blocking XREAD, unless explicitly disabled.
    // Without it the adapter polls with a 1s sleep instead of blocking, which
    // is a second of latency on each leg of a cross-node call.
    if (_options.blockingReads !== false) {
      this._blocking = new IoRedis.Cluster(nodes(), clusterOpts);
      this._blocking.on("error", () => {
        // Covered by onError() below once a handler is registered; this keeps
        // an early error from being an uncaught exception.
      });
    }

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

    const client =
      typeof block === "number" && this._blocking
        ? this._blocking
        : this._cluster;
    const result = (await client.xread(...args)) as any;
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
    await Promise.allSettled([
      this._cluster.quit(),
      this._subscriber.quit(),
      // Closed too, or it leaks a cluster connection and keeps the process
      // alive after shutdown.
      ...(this._blocking ? [this._blocking.quit()] : []),
    ]);
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
    this._blocking?.on("error", handler);
    return () => {
      this._cluster.removeListener("error", handler);
      this._subscriber.removeListener("error", handler);
      this._blocking?.removeListener("error", handler);
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
