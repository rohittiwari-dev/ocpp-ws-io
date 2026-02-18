import type { EventAdapterInterface } from "../types.js";

/**
 * Generic Redis-compatible client interface.
 * This works with both `ioredis` and the official `redis` package,
 * or any other client that implements these methods.
 */
export interface RedisLikeClient {
  publish(channel: string, message: string): Promise<number | unknown | void>;
  subscribe(channel: string, ...args: unknown[]): Promise<unknown | void>;
  unsubscribe(channel: string, ...args: unknown[]): Promise<unknown | void>;
  on(
    event: "message",
    callback: (channel: string, message: string) => void,
  ): unknown;
  disconnect?(): Promise<void> | void;
  quit?(): Promise<unknown> | void;
}

export interface RedisAdapterOptions {
  /** Redis client for publishing */
  pubClient: RedisLikeClient;
  /** Redis client for subscribing (must be a separate connection) */
  subClient: RedisLikeClient;
  /** Optional key prefix for channels (default: 'ocpp-ws-io:') */
  prefix?: string;
}

/**
 * Redis adapter for cross-process event distribution.
 *
 * This adapter is **generic** — it works with any Redis-compatible client
 * that implements the `RedisLikeClient` interface:
 * - `ioredis`
 * - `redis` (node-redis)
 * - Any custom implementation
 *
 * The user provides their own pub/sub client instances.
 * No Redis dependency is forced on the user.
 *
 * @example
 * ```typescript
 * // With ioredis
 * import Redis from 'ioredis';
 * const adapter = new RedisAdapter({
 *   pubClient: new Redis(),
 *   subClient: new Redis(),
 * });
 *
 * // With node-redis
 * import { createClient } from 'redis';
 * const pub = createClient();
 * const sub = pub.duplicate();
 * await pub.connect();
 * await sub.connect();
 * const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });
 * ```
 */
export class RedisAdapter implements EventAdapterInterface {
  private _pub: RedisLikeClient;
  private _sub: RedisLikeClient;
  private _prefix: string;
  private _handlers = new Map<string, Set<(data: unknown) => void>>();
  private _listening = false;

  constructor(options: RedisAdapterOptions) {
    this._pub = options.pubClient;
    this._sub = options.subClient;
    this._prefix = options.prefix ?? "ocpp-ws-io:";

    this._setupSubscriber();
  }

  private _setupSubscriber(): void {
    if (this._listening) return;
    this._listening = true;

    this._sub.on("message", (channel: string, message: string) => {
      // Strip prefix
      const actualChannel = channel.startsWith(this._prefix)
        ? channel.slice(this._prefix.length)
        : channel;

      const handlers = this._handlers.get(actualChannel);
      if (handlers) {
        let data: unknown;
        try {
          data = JSON.parse(message);
        } catch {
          data = message;
        }

        for (const handler of handlers) {
          try {
            handler(data);
          } catch {
            // Swallow handler errors
          }
        }
      }
    });
  }

  async publish(channel: string, data: unknown): Promise<void> {
    const prefixedChannel = this._prefix + channel;
    const message = JSON.stringify(data);
    await this._pub.publish(prefixedChannel, message);
  }

  async subscribe(
    channel: string,
    handler: (data: unknown) => void,
  ): Promise<void> {
    if (!this._handlers.has(channel)) {
      this._handlers.set(channel, new Set());
      const prefixedChannel = this._prefix + channel;
      await this._sub.subscribe(prefixedChannel);
    }
    this._handlers.get(channel)!.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    const prefixedChannel = this._prefix + channel;
    await this._sub.unsubscribe(prefixedChannel);
    this._handlers.delete(channel);
  }

  async disconnect(): Promise<void> {
    this._handlers.clear();

    // Gracefully disconnect both clients
    if (this._pub.quit) {
      await this._pub.quit();
    } else if (this._pub.disconnect) {
      await this._pub.disconnect();
    }

    if (this._sub.quit) {
      await this._sub.quit();
    } else if (this._sub.disconnect) {
      await this._sub.disconnect();
    }
  }
}
