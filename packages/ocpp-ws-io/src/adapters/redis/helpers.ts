export interface RedisLikeClient {
  publish(
    channel: string,
    message: string,
  ): Promise<number | unknown | undefined>;
  subscribe(channel: string, ...args: unknown[]): Promise<unknown | undefined>;
  unsubscribe(
    channel: string,
    ...args: unknown[]
  ): Promise<unknown | undefined>;
  on?(
    event: "message",
    callback: (channel: string, message: string) => void,
  ): unknown;
  disconnect?(): Promise<void> | void;
  quit?(): Promise<unknown> | undefined;
  // Node Redis v4 specific
  isOpen?: boolean;
}

// ─── Stream Types ───────────────────────────────────────────────

export interface StreamMessage {
  id: string;
  data: Record<string, string>;
}

export interface StreamEntry {
  stream: string;
  messages: StreamMessage[];
}

// ─── Client Commands ────────────────────────────────────────────
//
// The commands each driver sends, typed as the clients answer them. Clients
// arrive as RedisLikeClient (RedisAdapterOptions, createDriver); createDriver
// tells node-redis from ioredis and hands each driver its own kind.

/** A reply of a Lua script or a pipelined command. */
export type RedisReply = string | number | null | Buffer | RedisReply[];

/** Event subscription both client libraries share. */
interface ClientEvents {
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "connect" | "ready", listener: () => void): unknown;
  on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): unknown;
  removeListener(event: "error", listener: (err: Error) => void): unknown;
  removeListener(event: "connect" | "ready", listener: () => void): unknown;
}

/** ioredis XREAD reply: `[[stream, [[id, [field, value, ...]], ...]], ...]`. */
export type IoRedisStreamReply = [
  stream: string,
  messages: [id: string, fields: string[]][],
][];

/** The ioredis pipeline commands the drivers queue. */
export interface IoRedisPipeline {
  set(key: string, value: string, mode: "EX", seconds: number): unknown;
  xadd(key: string, ...args: string[]): unknown;
  // ioredis declares each result as unknown
  exec(): Promise<[error: Error | null, result: unknown][] | null>;
}

/** The ioredis commands IoRedisDriver and ClusterDriver send (Redis or Cluster). */
export interface IoRedisClient
  extends Omit<RedisLikeClient, "on">,
    ClientEvents {
  set(key: string, value: string): Promise<unknown>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  del(key: string): Promise<number>;
  // ioredis declares a script reply as unknown
  eval(
    script: string,
    numKeys: number,
    ...keysAndArgs: string[]
  ): Promise<unknown>;
  xadd(key: string, ...args: string[]): Promise<string | null>;
  xread(...args: (string | number)[]): Promise<IoRedisStreamReply | null>;
  xlen(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pipeline(): IoRedisPipeline;
  quit(): Promise<unknown>;
}

/** node-redis XREAD reply. */
export type NodeRedisStreamReply = {
  name: string;
  messages: { id: string; message: Record<string, string> }[];
}[];

/** node-redis stream trimming, as XADD's `TRIM` option. */
interface NodeRedisTrim {
  strategy: "MAXLEN";
  strategyModifier: "~";
  threshold: number;
}

/** The node-redis multi commands the driver queues. */
export interface NodeRedisMulti {
  set(key: string, value: string, options: { EX: number }): unknown;
  xAdd(
    key: string,
    id: string,
    message: Record<string, string>,
    options?: { TRIM?: NodeRedisTrim },
  ): unknown;
  exec(): Promise<RedisReply[]>;
}

/** The node-redis (v4+) commands NodeRedisDriver sends. */
export interface NodeRedisClient
  extends Omit<RedisLikeClient, "on">,
    ClientEvents {
  subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<unknown>;
  set(key: string, value: string, options?: { EX: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  mGet(keys: string[]): Promise<(string | null)[]>;
  del(key: string): Promise<number>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<RedisReply>;
  xAdd(
    key: string,
    id: string,
    message: Record<string, string>,
    options?: { TRIM?: NodeRedisTrim },
  ): Promise<string>;
  xRead(
    streams: { key: string; id: string }[],
    options?: { COUNT?: number; BLOCK?: number },
  ): Promise<NodeRedisStreamReply | null>;
  xLen(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number | boolean>;
  multi(): NodeRedisMulti;
  disconnect(): Promise<void>;
}

/** An ioredis XREAD reply as stream entries. */
export function fromIoRedisStreams(reply: IoRedisStreamReply): StreamEntry[] {
  return reply.map(([stream, messages]) => ({
    stream,
    messages: messages.map(([id, fields]) => {
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1];
      }
      return { id, data };
    }),
  }));
}

// ─── Extended Redis Driver ──────────────────────────────────────

export interface RedisPubSubDriver {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  disconnect(): Promise<void>;

  // Key-Value Store for Presence
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  get(key: string): Promise<string | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  del(key: string): Promise<void>;

  /**
   * Batch set multiple presence keys with TTL in a single pipeline.
   * Falls back to sequential sets if pipelining is unavailable.
   */
  setPresenceBatch(
    entries: { key: string; value: string; ttlSeconds: number }[],
  ): Promise<void>;

  /**
   * Set a TTL on an existing key (for ephemeral stream channel leases).
   */
  expire(key: string, ttlSeconds: number): Promise<void>;

  /**
   * Subscribe to connection error events for rehydration.
   * Returns an unsubscribe function.
   */
  onError?(handler: (err: Error) => void): () => void;

  /**
   * Subscribe to reconnection events.
   * Returns an unsubscribe function.
   */
  onReconnect?(handler: () => void): () => void;

  // Streams
  xadd(
    stream: string,
    args: Record<string, string>,
    maxLen?: number,
  ): Promise<string>;
  xaddBatch(
    messages: { stream: string; args: Record<string, string> }[],
    maxLen?: number,
  ): Promise<void>;
  xread(
    streams: { key: string; id: string }[],
    count?: number,
    block?: number,
  ): Promise<StreamEntry[] | null>;
  xlen(stream: string): Promise<number>;

  /**
   * Run a Lua script atomically. Used for presence fencing (compare-and-set /
   * compare-and-delete), which cannot be done correctly with separate GET and
   * SET round-trips. Optional: the adapter degrades to a racy read-then-write
   * when a driver does not provide it.
   */
  evalScript?(script: string, keys: string[], args: string[]): Promise<unknown>;

  /**
   * True when the driver has a dedicated connection for blocking XREAD.
   * Without it, BLOCK would head-of-line-block every other command on the
   * shared connection, so the adapter falls back to non-blocking polls.
   */
  readonly hasBlockingClient?: boolean;
}

/**
 * Commands per pipeline / keys per MGET.
 *
 * An unbounded batch is a single command that occupies the Redis event loop for
 * everyone else on the instance — at the 100k connections this library targets,
 * one presence refresh was a 100k-command pipeline.
 */
const REDIS_BATCH_SIZE = 500;

function chunk<T>(items: T[], size = REDIS_BATCH_SIZE): T[][] {
  if (items.length <= size) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/**
 * Throw if any command in a pipeline/multi reply carries an error.
 *
 * ioredis and node-redis both return per-command results rather than rejecting,
 * so `await pipeline.exec()` resolves happily even when every single command
 * failed. Discarding that reply reported a total failure to the caller as
 * success — presence silently not written, stream entries silently not added.
 */
function assertPipelineOk(replies: unknown, operation: string): void {
  if (!Array.isArray(replies)) return;
  for (const entry of replies) {
    // ioredis shape: [Error | null, result]
    if (Array.isArray(entry) && entry[0]) {
      throw new Error(
        `${operation}: ${(entry[0] as Error).message ?? String(entry[0])}`,
      );
    }
    // node-redis surfaces errors as Error instances in the array
    if (entry instanceof Error) {
      throw new Error(`${operation}: ${entry.message}`);
    }
  }
}

export class IoRedisDriver implements RedisPubSubDriver {
  private _handlers = new Map<string, (msg: string) => void>();

  constructor(
    private pub: IoRedisClient,
    private sub: IoRedisClient,
    private blocking?: IoRedisClient,
  ) {
    if (this.sub.on) {
      this.sub.on("message", (channel: string, message: string) => {
        const handler = this._handlers.get(channel);
        if (handler) handler(message);
      });
    }
  }

  get hasBlockingClient(): boolean {
    return !!this.blocking;
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.pub.publish(channel, message);
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<void> {
    this._handlers.set(channel, handler);
    await this.sub.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.sub.unsubscribe(channel);
    this._handlers.delete(channel);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.pub.set(key, value, "EX", ttlSeconds);
    } else {
      await this.pub.set(key, value);
    }
  }

  async evalScript(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    return this.pub.eval(script, keys.length, ...keys, ...args);
  }

  async get(key: string): Promise<string | null> {
    return (await this.pub.get(key)) || null;
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    const out: (string | null)[] = [];
    for (const part of chunk(keys)) {
      out.push(...(await this.pub.mget(...part)));
    }
    return out;
  }

  async del(key: string): Promise<void> {
    await this.pub.del(key);
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
    flatArgs.push("*"); // ID = auto
    for (const [k, v] of Object.entries(args)) {
      flatArgs.push(k, v);
    }
    return (await this.pub.xadd(stream, ...flatArgs)) as string;
  }

  async xaddBatch(
    messages: { stream: string; args: Record<string, string> }[],
    maxLen?: number,
  ): Promise<void> {
    if (messages.length === 0) return;
    const pipeline = this.pub.pipeline();
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
    if (count) {
      args.push("COUNT", count);
    }
    if (typeof block === "number") {
      args.push("BLOCK", block);
    }
    args.push("STREAMS");
    streams.forEach((s) => {
      args.push(s.key);
    });
    streams.forEach((s) => {
      args.push(s.id);
    });

    // Use blocking client if available and blocking is requested
    const client = block && this.blocking ? this.blocking : this.pub;

    // ioredis returns [[key, [[id, [k,v,k,v]]]]]
    const result = await client.xread(...args);

    // Normalise "no data" to null. ioredis can hand back an empty array where
    // node-redis returns nil, and the caller's poll loop treats a truthy result
    // as "got something" — so an empty array skipped its backoff sleep and spun
    // the loop hot.
    if (!result || result.length === 0) return null;

    return fromIoRedisStreams(result);
  }

  async xlen(stream: string): Promise<number> {
    return await this.pub.xlen(stream);
  }

  async disconnect(): Promise<void> {
    this._handlers.clear();
    const close = async (c: IoRedisClient | undefined) => {
      if (!c) return;
      if (c.quit) await c.quit();
      else if (c.disconnect) await c.disconnect();
    };
    // The blocking client is a third connection and was never closed: it leaked
    // a Redis connection per adapter and, being an open socket, kept the Node
    // process alive after everything else had shut down.
    await Promise.all([close(this.pub), close(this.sub), close(this.blocking)]);
  }

  async setPresenceBatch(
    entries: { key: string; value: string; ttlSeconds: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    for (const part of chunk(entries)) {
      const pipeline = this.pub.pipeline();
      for (const { key, value, ttlSeconds } of part) {
        pipeline.set(key, value, "EX", ttlSeconds);
      }
      assertPipelineOk(await pipeline.exec(), "setPresenceBatch");
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.pub.expire(key, ttlSeconds);
  }

  onError(handler: (err: Error) => void): () => void {
    this.pub.on("error", handler);
    return () => this.pub.removeListener("error", handler);
  }

  onReconnect(handler: () => void): () => void {
    this.pub.on("connect", handler);
    return () => this.pub.removeListener("connect", handler);
  }
}

export class NodeRedisDriver implements RedisPubSubDriver {
  constructor(
    private pub: NodeRedisClient,
    private sub: NodeRedisClient,
    private blocking?: NodeRedisClient,
  ) {}

  get hasBlockingClient(): boolean {
    return !!this.blocking;
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.pub.publish(channel, message);
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<void> {
    await this.sub.subscribe(channel, handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.sub.unsubscribe(channel);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.pub.set(key, value, { EX: ttlSeconds });
    } else {
      await this.pub.set(key, value);
    }
  }

  async evalScript(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    return this.pub.eval(script, { keys, arguments: args });
  }

  async get(key: string): Promise<string | null> {
    return (await this.pub.get(key)) || null;
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    const out: (string | null)[] = [];
    for (const part of chunk(keys)) {
      out.push(...(await this.pub.mGet(part)));
    }
    return out;
  }

  async del(key: string): Promise<void> {
    await this.pub.del(key);
  }

  async xadd(
    stream: string,
    args: Record<string, string>,
    maxLen?: number,
  ): Promise<string> {
    // Node Redis v4: .xAdd(key, id, message, options); trimming is `TRIM`.
    return await this.pub.xAdd(stream, "*", args, {
      TRIM: maxLen
        ? {
            strategy: "MAXLEN",
            strategyModifier: "~",
            threshold: maxLen,
          }
        : undefined,
    });
  }

  async xaddBatch(
    messages: { stream: string; args: Record<string, string> }[],
    maxLen?: number,
  ): Promise<void> {
    if (messages.length === 0) return;
    const multi = this.pub.multi();
    for (const msg of messages) {
      multi.xAdd(msg.stream, "*", msg.args, {
        TRIM: maxLen
          ? {
              strategy: "MAXLEN",
              strategyModifier: "~",
              threshold: maxLen,
            }
          : undefined,
      });
    }
    await multi.exec();
  }

  async xread(
    streams: { key: string; id: string }[],
    count?: number,
    block?: number,
  ): Promise<StreamEntry[] | null> {
    // Node Redis v4 .xRead(streams, options)
    const options: { COUNT?: number; BLOCK?: number } = {};
    if (count) options.COUNT = count;
    if (typeof block === "number") options.BLOCK = block;

    const streamsParam = streams.map((s) => ({
      key: s.key,
      id: s.id,
    }));

    const client = block && this.blocking ? this.blocking : this.pub;
    const result = await client.xRead(streamsParam, options);

    if (!result || result.length === 0) return null;

    // Node Redis v4 returns: { name: string, messages: { id: string, message: Record<string,string> }[] }[]
    return result.map((entry) => ({
      stream: entry.name,
      messages: entry.messages.map((msg) => ({
        id: msg.id,
        data: msg.message,
      })),
    }));
  }

  async xlen(stream: string): Promise<number> {
    return await this.pub.xLen(stream);
  }

  async disconnect(): Promise<void> {
    const close = async (c: NodeRedisClient | undefined) => {
      if (!c) return;
      await c.disconnect();
    };
    await Promise.all([close(this.pub), close(this.sub), close(this.blocking)]);
  }

  async setPresenceBatch(
    entries: { key: string; value: string; ttlSeconds: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    for (const part of chunk(entries)) {
      const multi = this.pub.multi();
      for (const { key, value, ttlSeconds } of part) {
        multi.set(key, value, { EX: ttlSeconds });
      }
      assertPipelineOk(await multi.exec(), "setPresenceBatch");
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.pub.expire(key, ttlSeconds);
  }

  onError(handler: (err: Error) => void): () => void {
    this.pub.on("error", handler);
    return () => this.pub.removeListener("error", handler);
  }

  onReconnect(handler: () => void): () => void {
    this.pub.on("connect", handler);
    return () => this.pub.removeListener("connect", handler);
  }
}

/**
 * The driver for a pair (or trio) of node-redis or ioredis clients. The
 * clients are the caller's own instances, taken as RedisLikeClient; their
 * kind decides which commands the driver sends.
 */
export function createDriver(
  pub: RedisLikeClient,
  sub: RedisLikeClient,
  blocking?: RedisLikeClient,
): RedisPubSubDriver {
  // Simple heuristic: Node Redis v4 clients usually have 'isOpen' boolean
  if (sub.isOpen !== undefined && typeof sub.subscribe === "function") {
    return new NodeRedisDriver(
      pub as NodeRedisClient,
      sub as NodeRedisClient,
      blocking as NodeRedisClient | undefined,
    );
  }
  // Default to IoRedis / Generic
  return new IoRedisDriver(
    pub as IoRedisClient,
    sub as IoRedisClient,
    blocking as IoRedisClient | undefined,
  );
}
