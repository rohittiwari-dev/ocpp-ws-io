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
}

export class IoRedisDriver implements RedisPubSubDriver {
  private _handlers = new Map<string, (msg: string) => void>();

  constructor(
    private pub: any,
    private sub: any,
    private blocking?: any,
  ) {
    if (this.sub.on) {
      this.sub.on("message", (channel: string, message: string) => {
        const handler = this._handlers.get(channel);
        if (handler) handler(message);
      });
    }
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

  async get(key: string): Promise<string | null> {
    return (await this.pub.get(key)) || null;
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return await this.pub.mget(...keys);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await client.xread(...args)) as any;

    if (!result) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.map(([stream, messages]: any) => ({
      stream,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    return (await this.pub.xlen(stream)) as number;
  }

  async disconnect(): Promise<void> {
    this._handlers.clear();
    const close = async (c: any) => {
      if (c.quit) await c.quit();
      else if (c.disconnect) await c.disconnect();
    };
    await Promise.all([close(this.pub), close(this.sub)]);
  }
}

export class NodeRedisDriver implements RedisPubSubDriver {
  constructor(
    private pub: any,
    private sub: any,
    private blocking?: any,
  ) {}

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

  async get(key: string): Promise<string | null> {
    return (await this.pub.get(key)) || null;
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return await this.pub.mGet(keys);
  }

  async del(key: string): Promise<void> {
    await this.pub.del(key);
  }

  async xadd(
    stream: string,
    args: Record<string, string>,
    maxLen?: number,
  ): Promise<string> {
    const options: any = {};
    if (maxLen) {
      options.MKSTREAM = true; // Make sure stream exists
      // node-redis specific options for MAXLEN
      // But basic xadd signature is (key, id, message, options?)
    }
    // Node Redis v4 xAdd: (key, id, message)
    // For trimming, it might be in options.
    // Let's assume standard usage for now.
    // Actually Node Redis v4: .xAdd(key, id, message, options)

    // Construct message object
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
    const options: any = {};
    if (count) options.COUNT = count;
    if (typeof block === "number") options.BLOCK = block;

    const streamsParam = streams.map((s) => ({
      key: s.key,
      id: s.id,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = block && this.blocking ? this.blocking : this.pub;
    const result = (await client.xRead(streamsParam, options)) as any;

    if (!result || result.length === 0) return null;

    // Node Redis v4 returns: { name: string, messages: { id: string, message: Record<string,string> }[] }[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.map((entry: any) => ({
      stream: entry.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: entry.messages.map((msg: any) => ({
        id: msg.id,
        data: msg.message,
      })),
    }));
  }

  async xlen(stream: string): Promise<number> {
    return (await this.pub.xLen(stream)) as number;
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.pub.disconnect(), this.sub.disconnect()]);
  }
}

export function createDriver(
  pub: any,
  sub: any,
  blocking?: any,
): RedisPubSubDriver {
  // Simple heuristic: Node Redis v4 clients usually have 'isOpen' boolean
  if (sub.isOpen !== undefined && typeof sub.subscribe === "function") {
    return new NodeRedisDriver(pub, sub, blocking);
  }
  // Default to IoRedis / Generic
  return new IoRedisDriver(pub, sub, blocking);
}
