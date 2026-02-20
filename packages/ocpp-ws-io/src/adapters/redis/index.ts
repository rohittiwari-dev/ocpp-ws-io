import type { EventAdapterInterface } from "../../types.js";
import {
  createDriver,
  type RedisLikeClient,
  type RedisPubSubDriver,
} from "./helpers.js";

export interface RedisAdapterOptions {
  /** Redis client for publishing */
  pubClient: RedisLikeClient;
  /** Redis client for subscribing (must be a separate connection) */
  subClient: RedisLikeClient;
  /** Redis client for blocking stream operations (recommended for reliability) */
  blockingClient?: RedisLikeClient;
  /** Optional key prefix for channels (default: 'ocpp-ws-io:') */
  prefix?: string;
  /** StreamMaxLen for trimming (default: 1000) */
  streamMaxLen?: number;
}

/**
 * Redis adapter for cross-process event distribution.
 *
 * Supports `ioredis` and `node-redis` (v4+).
 * Uses Redis Streams for reliable unicast (node-to-node) and Pub/Sub for broadcast.
 */
export class RedisAdapter implements EventAdapterInterface {
  private _driver: RedisPubSubDriver;
  private _prefix: string;
  private _streamMaxLen: number;
  private _handlers = new Map<string, Set<(data: unknown) => void>>();
  private _streamOffsets = new Map<string, string>(); // streamKey -> lastId
  private _streams = new Set<string>(); // Active streams to poll
  private _polling = false;
  private _closed = false;

  constructor(options: RedisAdapterOptions) {
    this._prefix = options.prefix ?? "ocpp-ws-io:";
    this._streamMaxLen = options.streamMaxLen ?? 1000;
    this._driver = createDriver(
      options.pubClient,
      options.subClient,
      options.blockingClient,
    );
  }

  async publish(channel: string, data: unknown): Promise<void> {
    const prefixedChannel = this._prefix + channel;
    const message = JSON.stringify(data);

    // Unicast (Node-to-Node) -> Use Streams
    if (channel.startsWith("ocpp:node:")) {
      await this._driver.xadd(prefixedChannel, { message }, this._streamMaxLen);
    } else {
      // Broadcast -> Use Pub/Sub
      await this._driver.publish(prefixedChannel, message);
    }
  }

  async subscribe(
    channel: string,
    handler: (data: unknown) => void,
  ): Promise<void> {
    if (!this._handlers.has(channel)) {
      this._handlers.set(channel, new Set());
      const prefixedChannel = this._prefix + channel;

      if (channel.startsWith("ocpp:node:")) {
        // Stream subscription
        // Start from '0' (beginning) to pick up missed messages during downtime (persistence).
        // Since we trim the stream (MAXLEN), this will only replay recent pending messages.
        if (!this._streams.has(prefixedChannel)) {
          this._streams.add(prefixedChannel);
          this._streamOffsets.set(prefixedChannel, "0");
          this._ensurePolling();
        }
      } else {
        // Pub/Sub subscription
        await this._driver.subscribe(prefixedChannel, (message) => {
          this._handleMessage(channel, message);
        });
      }
    }
    this._handlers.get(channel)?.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    const prefixedChannel = this._prefix + channel;

    if (this._streams.has(prefixedChannel)) {
      this._streams.delete(prefixedChannel);
      this._streamOffsets.delete(prefixedChannel); // Cleanup offset
    } else {
      await this._driver.unsubscribe(prefixedChannel);
    }

    this._handlers.delete(channel);
  }

  async disconnect(): Promise<void> {
    this._closed = true;
    this._handlers.clear();
    this._streams.clear();
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

  // ─── Stream Polling ───────────────────────────────────────────────

  private _ensurePolling() {
    if (this._polling || this._closed) return;
    this._polling = true;
    this._pollLoop().catch(() => {
      this._polling = false;
    });
  }

  private async _pollLoop() {
    while (!this._closed) {
      if (this._streams.size === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const streamsArg = Array.from(this._streams).map((key) => ({
        key,
        id: this._streamOffsets.get(key) || "$",
      }));

      try {
        // Block for 1s. This allows picking up new subscriptions reasonably fast.
        const entries = await this._driver.xread(streamsArg, undefined, 1000);

        if (entries) {
          for (const entry of entries) {
            const channel = entry.stream.replace(this._prefix, ""); // remove prefix to find handler key

            for (const msg of entry.messages) {
              // Update offset
              this._streamOffsets.set(entry.stream, msg.id);

              const messageContent = msg.data.message;
              if (messageContent) {
                this._handleMessage(channel, messageContent);
              }
            }
          }
        }
      } catch (_err) {
        // Log error? For now swallow to keep loop alive
        // Avoid tight loop on error
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    this._polling = false;
  }

  // ─── Presence Registry ─────────────────────────────────────────────

  async setPresence(
    identity: string,
    nodeId: string,
    ttl: number,
  ): Promise<void> {
    const key = `${this._prefix}presence:${identity}`;
    await this._driver.set(key, nodeId, ttl);
  }

  async getPresence(identity: string): Promise<string | null> {
    const key = `${this._prefix}presence:${identity}`;
    return await this._driver.get(key);
  }

  async removePresence(identity: string): Promise<void> {
    const key = `${this._prefix}presence:${identity}`;
    await this._driver.del(key);
  }
}
