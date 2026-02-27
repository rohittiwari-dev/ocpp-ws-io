import type { RedisPubSubDriver, StreamEntry } from "./helpers.js";

// ─── Redis Cluster Driver ───────────────────────────────────────
//
// Wraps an ioredis `Cluster` instance (or compatible) and exposes
// the same RedisPubSubDriver interface. Hash tags ensure related
// keys land on the same shard.

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
  /** Key prefix (used for hash tag generation) */
  prefix?: string;
}

/**
 * Redis Cluster driver that implements `RedisPubSubDriver`.
 * Requires `ioredis` as a peer dependency.
 *
 * Hash-tag strategy:
 * - Presence keys: `{identity}` → sharded by station identity
 * - Stream keys: `{nodeId}` → sharded by server node ID
 *
 * @example
 * ```ts
 * const driver = createClusterDriver({
 *   nodes: [{ host: '10.0.0.1', port: 6379 }, { host: '10.0.0.2', port: 6379 }],
 * });
 * const adapter = new RedisAdapter({ pubClient: {}, subClient: {}, driverFactory: () => driver });
 * ```
 */
export class ClusterDriver implements RedisPubSubDriver {
  private _cluster: any;
  private _subscriber: any;
  private _handlers = new Map<string, (msg: string) => void>();

  constructor(_options: ClusterDriverOptions) {
    // Dynamically require ioredis to avoid bundling
    try {
      const { createRequire } = require("node:module");
      const dynamicRequire = createRequire(__filename);
      const Redis = dynamicRequire("ioredis");

      const redisOpts = _options.redisOptions ?? {};
      if (_options.natMap) {
        (redisOpts as any).natMap = _options.natMap;
      }

      this._cluster = new Redis.Cluster(
        _options.nodes.map((n) => ({ host: n.host, port: n.port })),
        { redisOptions: redisOpts },
      );

      // Separate subscriber connection for Pub/Sub
      this._subscriber = new Redis.Cluster(
        _options.nodes.map((n) => ({ host: n.host, port: n.port })),
        { redisOptions: redisOpts },
      );

      this._subscriber.on("message", (channel: string, message: string) => {
        const handler = this._handlers.get(channel);
        if (handler) handler(message);
      });
    } catch {
      throw new Error(
        "ClusterDriver requires 'ioredis' as a peer dependency. Install it with: npm i ioredis",
      );
    }
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
    const pipeline = this._cluster.pipeline();
    for (const msg of messages) {
      const flatArgs: string[] = [];
      if (maxLen) {
        flatArgs.push("MAXLEN", "~", maxLen.toString());
      }
      flatArgs.push("*");
      for (const [k, v] of Object.entries(msg.args)) {
        flatArgs.push(k, v);
      }
      pipeline.xadd(msg.stream, ...flatArgs);
    }
    await pipeline.exec();
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
    const pipeline = this._cluster.pipeline();
    for (const { key, value, ttlSeconds } of entries) {
      pipeline.set(key, value, "EX", ttlSeconds);
    }
    await pipeline.exec();
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this._cluster.expire(key, ttlSeconds);
  }

  onError(handler: (err: Error) => void): () => void {
    this._cluster.on("error", handler);
    return () => this._cluster.removeListener("error", handler);
  }

  onReconnect(handler: () => void): () => void {
    this._cluster.on("reconnecting", handler);
    return () => this._cluster.removeListener("reconnecting", handler);
  }
}
