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
  /**
   * TTL in seconds for ephemeral stream keys (default: 300).
   * Prevents abandoned channel keys from leaking memory in Redis.
   */
  streamTtlSeconds?: number;
  /**
   * Presence TTL in seconds (default: 300).
   * Used for batch presence heartbeat pipeline.
   */
  presenceTtlSeconds?: number;
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
  private _streamTtlSeconds: number;
  private _presenceTtlSeconds: number;
  private _handlers = new Map<string, Set<(data: unknown) => void>>();
  private _streamOffsets = new Map<string, string>(); // streamKey -> lastId
  private _streams = new Set<string>(); // Active streams to poll
  private _polling = false;
  private _closed = false;

  // C4: Per-stream sequence counter for message ordering
  private _sequenceCounters = new Map<string, number>();

  // C3: Rehydration callbacks
  private _unsubError?: () => void;
  private _unsubReconnect?: () => void;

  // Stored presence entries for rehydration on reconnect
  private _presenceCache = new Map<string, { nodeId: string; ttl: number }>();

  constructor(options: RedisAdapterOptions) {
    this._prefix = options.prefix ?? "ocpp-ws-io:";
    this._streamMaxLen = options.streamMaxLen ?? 1000;
    this._streamTtlSeconds = options.streamTtlSeconds ?? 300;
    this._presenceTtlSeconds = options.presenceTtlSeconds ?? 300;
    this._driver = createDriver(
      options.pubClient,
      options.subClient,
      options.blockingClient,
    );

    // C3: Redis Failure Rehydration — listen for errors and re-sync on reconnect
    if (this._driver.onError) {
      this._unsubError = this._driver.onError((err) => {
        // Log for observability — consumers can attach their own logger
        console.error("[RedisAdapter] Redis error:", err.message);
      });
    }
    if (this._driver.onReconnect) {
      this._unsubReconnect = this._driver.onReconnect(() => {
        this._rehydratePresence().catch(() => {});
      });
    }
  }

  async publish(channel: string, data: unknown): Promise<void> {
    const prefixedChannel = this._prefix + channel;

    // C4: Attach sequence ID to unicast messages for ordering
    const payload = data as Record<string, unknown> | null;
    if (
      payload &&
      typeof payload === "object" &&
      channel.startsWith("ocpp:node:")
    ) {
      const seq = (this._sequenceCounters.get(channel) ?? 0) + 1;
      this._sequenceCounters.set(channel, seq);
      (payload as Record<string, unknown>).__seq = seq;
    }

    const message = JSON.stringify(data);

    // Unicast (Node-to-Node) -> Use Streams
    if (channel.startsWith("ocpp:node:")) {
      await this._driver.xadd(prefixedChannel, { message }, this._streamMaxLen);
      // C2: Set TTL lease on ephemeral stream key to prevent memory leaks
      await this._driver
        .expire(prefixedChannel, this._streamTtlSeconds)
        .catch(() => {});
    } else {
      // Broadcast -> Use Pub/Sub
      await this._driver.publish(prefixedChannel, message);
    }
  }

  async publishBatch(
    messages: { channel: string; data: unknown }[],
  ): Promise<void> {
    const streamMessages: { stream: string; args: Record<string, string> }[] =
      [];
    const broadcastMessages: { channel: string; message: string }[] = [];

    for (const msg of messages) {
      const prefixedChannel = this._prefix + msg.channel;
      const message = JSON.stringify(msg.data);

      if (msg.channel.startsWith("ocpp:node:")) {
        streamMessages.push({ stream: prefixedChannel, args: { message } });
      } else {
        broadcastMessages.push({ channel: prefixedChannel, message });
      }
    }

    const promises: Promise<void>[] = [];

    if (streamMessages.length > 0) {
      promises.push(this._driver.xaddBatch(streamMessages, this._streamMaxLen));
    }

    if (broadcastMessages.length > 0) {
      promises.push(
        Promise.all(
          broadcastMessages.map((bm) =>
            this._driver.publish(bm.channel, bm.message),
          ),
        ).then(() => {}), // Map `Promise<void[]>` to `Promise<void>`
      );
    }

    await Promise.all(promises);
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
    this._presenceCache.clear();
    this._sequenceCounters.clear();
    if (this._unsubError) this._unsubError();
    if (this._unsubReconnect) this._unsubReconnect();
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
    // Cache for rehydration on reconnect (C3)
    this._presenceCache.set(identity, { nodeId, ttl });
    await this._driver.set(key, nodeId, ttl);
  }

  async getPresence(identity: string): Promise<string | null> {
    const key = `${this._prefix}presence:${identity}`;
    return await this._driver.get(key);
  }

  async getPresenceBatch(identities: string[]): Promise<(string | null)[]> {
    if (identities.length === 0) return [];
    const keys = identities.map((id) => `${this._prefix}presence:${id}`);
    if (this._driver.mget) {
      return await this._driver.mget(keys);
    }
    // Fallback if mget not available
    return await Promise.all(keys.map((k) => this._driver.get(k)));
  }

  async removePresence(identity: string): Promise<void> {
    const key = `${this._prefix}presence:${identity}`;
    await this._driver.del(key);
  }

  // ─── Observability Pipeline ────────────────────────────────────────

  async metrics(): Promise<Record<string, unknown>> {
    let pendingMessages = 0;
    const streamDetails: Record<string, number> = {};

    // Calculate "consumer lag" by checking the length of all active streams
    // Since we use MAXLEN for trimming, XLEN directly equals pending unread messages
    for (const streamKey of this._streams) {
      try {
        const length = await this._driver.xlen(streamKey);
        pendingMessages += length;
        streamDetails[streamKey] = length;
      } catch {
        // Ignore failures for individual stream stats
        streamDetails[streamKey] = -1;
      }
    }

    return {
      pendingMessages,
      activeStreams: this._streams.size,
      streamDetails,
    };
  }

  // ─── C1: Batch Presence Pipeline ────────────────────────────────────

  /**
   * Set multiple presence entries in a single Redis pipeline.
   * Reduces N network round-trips to 1 for bulk presence updates.
   */
  async setPresenceBatch(
    entries: { identity: string; nodeId: string; ttl?: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;

    const batchEntries = entries.map(({ identity, nodeId, ttl }) => {
      const key = `${this._prefix}presence:${identity}`;
      const ttlSeconds = ttl ?? this._presenceTtlSeconds;
      // Cache for rehydration
      this._presenceCache.set(identity, { nodeId, ttl: ttlSeconds });
      return { key, value: nodeId, ttlSeconds };
    });

    await this._driver.setPresenceBatch(batchEntries);
  }

  // ─── C3: Redis Failure Rehydration ──────────────────────────────────

  /**
   * Re-syncs all cached presence entries to Redis after a reconnection.
   * Called automatically when the Redis client reconnects.
   */
  private async _rehydratePresence(): Promise<void> {
    if (this._presenceCache.size === 0) return;

    const entries = Array.from(this._presenceCache.entries()).map(
      ([identity, { nodeId, ttl }]) => ({
        key: `${this._prefix}presence:${identity}`,
        value: nodeId,
        ttlSeconds: ttl,
      }),
    );

    await this._driver.setPresenceBatch(entries);
  }
}
