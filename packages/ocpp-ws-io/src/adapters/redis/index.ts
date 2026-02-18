import type { EventAdapterInterface } from "../../types.js";
import {
  type RedisLikeClient,
  type RedisPubSubDriver,
  createDriver,
} from "./helpers.js";

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
 * Supports `ioredis` and `node-redis` (v4+).
 */
export class RedisAdapter implements EventAdapterInterface {
  private _driver: RedisPubSubDriver;
  private _prefix: string;
  private _handlers = new Map<string, Set<(data: unknown) => void>>();

  constructor(options: RedisAdapterOptions) {
    this._prefix = options.prefix ?? "ocpp-ws-io:";
    this._driver = createDriver(options.pubClient, options.subClient);
  }

  async publish(channel: string, data: unknown): Promise<void> {
    const prefixedChannel = this._prefix + channel;
    const message = JSON.stringify(data);
    await this._driver.publish(prefixedChannel, message);
  }

  async subscribe(
    channel: string,
    handler: (data: unknown) => void,
  ): Promise<void> {
    if (!this._handlers.has(channel)) {
      this._handlers.set(channel, new Set());
      const prefixedChannel = this._prefix + channel;

      // Subscribe via driver with a callback for this specific channel
      await this._driver.subscribe(prefixedChannel, (message) => {
        this._handleMessage(channel, message);
      });
    }
    this._handlers.get(channel)!.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    const prefixedChannel = this._prefix + channel;
    await this._driver.unsubscribe(prefixedChannel);
    this._handlers.delete(channel);
  }

  async disconnect(): Promise<void> {
    this._handlers.clear();
    await this._driver.disconnect();
  }

  private _handleMessage(channel: string, message: string): void {
    const handlers = this._handlers.get(channel);
    if (!handlers) return;

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
}
