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

// ─── Extended Redis Driver ──────────────────────────────────────

export interface RedisPubSubDriver {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  disconnect(): Promise<void>;

  // Key-Value Store for Presence
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
}

export class IoRedisDriver implements RedisPubSubDriver {
  private _handlers = new Map<string, (msg: string) => void>();

  constructor(private pub: any, private sub: any) {
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

  async del(key: string): Promise<void> {
    await this.pub.del(key);
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
  constructor(private pub: any, private sub: any) {}

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

  async del(key: string): Promise<void> {
    await this.pub.del(key);
  }

  async disconnect(): Promise<void> {
    if (this.pub.isOpen) await this.pub.disconnect();
    if (this.sub.isOpen) await this.sub.disconnect();
  }
}

export function createDriver(pub: any, sub: any): RedisPubSubDriver {
  // Simple heuristic: Node Redis v4 clients usually have 'isOpen' boolean
  if (sub.isOpen !== undefined && typeof sub.subscribe === "function") {
    return new NodeRedisDriver(pub, sub);
  }
  // Default to IoRedis / Generic
  return new IoRedisDriver(pub, sub);
}
