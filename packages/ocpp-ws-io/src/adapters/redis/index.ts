import type { EventAdapterInterface } from "../../types.js";
import {
  createDriver,
  type RedisLikeClient,
  type RedisPubSubDriver,
} from "./helpers.js";

export interface RedisAdapterOptions {
  /** Redis client for publishing (required unless `driver` is provided) */
  pubClient?: RedisLikeClient;
  /** Redis client for subscribing — must be a separate connection (required unless `driver` is provided) */
  subClient?: RedisLikeClient;
  /**
   * A third, dedicated Redis client used only for blocking stream reads.
   *
   * Must be its own connection. `XREAD ... BLOCK` occupies a connection for
   * the whole block, so sharing `pubClient` here stalls every publish and
   * presence command behind it for up to a second per poll.
   *
   * This is a latency option, not a reliability one: without it delivery still
   * works, falling back to a non-blocking poll plus a 1s sleep, which adds up
   * to a second to each leg of a cross-node call.
   */
  blockingClient?: RedisLikeClient;
  /**
   * Pre-built driver (e.g. a ClusterDriver) used directly as the primary
   * driver. When set, pubClient/subClient/blockingClient are ignored.
   */
  driver?: RedisPubSubDriver;
  /** Optional key prefix for channels (default: 'ocpp-ws-io:') */
  prefix?: string;
  /**
   * Where the adapter reports transport problems.
   *
   * Errors previously went to a hardcoded `console.error`, which is invisible
   * to any structured logging setup and unroutable in production. Pass the
   * server's logger (or any object with these methods) to get them.
   */
  logger?: {
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
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
  /**
   * Number of Redis connections to pool for message publishing (default: 1),
   * spreading load across TCP connections instead of queueing behind one.
   *
   * A connection is chosen by hashing the destination channel, **not** by
   * round-robin: everything addressed to one charger goes over one connection,
   * so its commands cannot overtake each other in flight. Round-robin was
   * removed for exactly that reason.
   *
   * Applies to `publish` and `publishBatch`. Pub/Sub subscriptions and every
   * presence operation — `setPresence`, `getPresence`, `claimPresence`,
   * batches and rehydration — always use the primary driver at pool index 0,
   * so raising this does not spread presence load.
   *
   * Requires `driverFactory`; without one the pool stays at a single
   * connection and the adapter warns.
   */
  poolSize?: number;
  /**
   * Creates the extra driver instances for the pool. Each call must return a
   * fresh, independent set of Redis connections — reusing one client across
   * pool entries defeats the point.
   *
   * Required when `poolSize > 1`. Without it the pool silently stays at one
   * connection, so the adapter logs a warning rather than leaving you to
   * discover it from throughput.
   */
  driverFactory?: () => RedisPubSubDriver;
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

  // Rehydration callbacks
  private _unsubError?: () => void;
  private _unsubReconnect?: () => void;

  // Stored presence entries for rehydration on reconnect
  private _presenceCache = new Map<string, { nodeId: string; ttl: number }>();

  // Connection pool
  private _driverPool: RedisPubSubDriver[];
  private _nextPoolIndex: number;

  private _logger?: RedisAdapterOptions["logger"];
  /** Consecutive stream-poll failures; surfaced through metrics(). */
  private _pollErrors = 0;
  private _lastPollError?: string;

  /** Report a transport problem, falling back to console when no logger is set. */
  private _log(
    level: "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
    const fn = this._logger?.[level];
    if (fn) {
      fn.call(this._logger, msg, meta);
      return;
    }
    // eslint-disable-next-line no-console
    console[level](`[RedisAdapter] ${msg}`, meta ?? "");
  }

  constructor(options: RedisAdapterOptions) {
    this._logger = options.logger;
    this._prefix = options.prefix ?? "ocpp-ws-io:";
    this._streamMaxLen = options.streamMaxLen ?? 1000;
    this._streamTtlSeconds = options.streamTtlSeconds ?? 300;
    this._presenceTtlSeconds = options.presenceTtlSeconds ?? 300;

    // Primary driver — either user-provided (e.g. ClusterDriver) or built
    // from raw pub/sub clients.
    if (options.driver) {
      this._driver = options.driver;
    } else if (options.pubClient && options.subClient) {
      this._driver = createDriver(
        options.pubClient,
        options.subClient,
        options.blockingClient,
      );
    } else {
      throw new Error(
        "RedisAdapter requires either `driver` or both `pubClient` and `subClient`",
      );
    }

    // Connection pool — default 1 (backward compatible)
    const poolSize = options.poolSize ?? 1;
    this._driverPool = [this._driver];
    this._nextPoolIndex = 0;

    if (poolSize > 1) {
      if (options.driverFactory) {
        for (let i = 1; i < poolSize; i++) {
          this._driverPool.push(options.driverFactory());
        }
      } else {
        // Silently running a one-connection pool looks identical to a working
        // one until throughput is measured, so say so.
        this._log(
          "warn",
          "poolSize ignored — driverFactory is required to create pool connections",
          { poolSize, effectivePoolSize: 1 },
        );
      }
    }

    // Redis Failure Rehydration — listen for errors and re-sync on reconnect
    if (this._driver.onError) {
      this._unsubError = this._driver.onError((err) => {
        // Log for observability — consumers can attach their own logger
        this._log("error", "Redis connection error", { error: err.message });
      });
    }
    if (this._driver.onReconnect) {
      this._unsubReconnect = this._driver.onReconnect(() => {
        this._rehydratePresence().catch(() => {});
      });
    }
  }

  /** Get the next driver from the pool (round-robin) */
  /**
   * Pick a pool connection for `channel`.
   *
   * Round-robining per call spread consecutive messages for the SAME target
   * across independent TCP connections, so they could arrive out of order —
   * which for OCPP unicast means a charger's commands reordering in transit.
   * Hashing the channel keeps one destination pinned to one connection (so
   * ordering holds) while still spreading different destinations across the
   * pool, which is the whole point of having one.
   */
  private _getPoolDriver(channel?: string): RedisPubSubDriver {
    if (this._driverPool.length === 1) return this._driver;
    if (channel === undefined) {
      const driver = this._driverPool[this._nextPoolIndex];
      this._nextPoolIndex = (this._nextPoolIndex + 1) % this._driverPool.length;
      return driver;
    }
    let hash = 0;
    for (let i = 0; i < channel.length; i++) {
      hash = (hash * 31 + channel.charCodeAt(i)) | 0;
    }
    return this._driverPool[Math.abs(hash) % this._driverPool.length];
  }

  async publish(channel: string, data: unknown): Promise<void> {
    const prefixedChannel = this._prefix + channel;

    const message = JSON.stringify(data);

    // Unicast (Node-to-Node) -> Use Streams
    if (channel.startsWith("ocpp:node:")) {
      const poolDriver = this._getPoolDriver(prefixedChannel);
      await poolDriver.xadd(prefixedChannel, { message }, this._streamMaxLen);
      // Set TTL lease on ephemeral stream key to prevent memory leaks
      await poolDriver
        .expire(prefixedChannel, this._streamTtlSeconds)
        .catch(() => {});
    } else {
      // Broadcast -> Use Pub/Sub
      await this._getPoolDriver(prefixedChannel).publish(
        prefixedChannel,
        message,
      );
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
      // One driver for the batch; entries are grouped per stream by the driver.
      const streamDriver = this._getPoolDriver(streamMessages[0]?.stream);
      promises.push(
        streamDriver
          .xaddBatch(streamMessages, this._streamMaxLen)
          .then(async () => {
            // Same TTL lease `publish()` sets. MAXLEN trims entries but never
            // removes the key, so without this every node id that ever
            // received a batch leaves a stream key behind forever — one per
            // pod restart on Kubernetes.
            const seen = new Set(streamMessages.map((m) => m.stream));
            await Promise.all(
              [...seen].map((stream) =>
                streamDriver
                  .expire(stream, this._streamTtlSeconds)
                  .catch(() => {}),
              ),
            );
          }),
      );
    }

    if (broadcastMessages.length > 0) {
      promises.push(
        Promise.all(
          broadcastMessages.map((bm) =>
            this._getPoolDriver(bm.channel).publish(bm.channel, bm.message),
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
          // Fresh stream → start from "0" (a brand-new nodeId stream is
          // empty, so this replays nothing). Re-subscribes keep their last
          // consumed id to avoid replaying retained entries (report M4).
          if (!this._streamOffsets.has(prefixedChannel)) {
            this._streamOffsets.set(prefixedChannel, "0");
          }
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
      // Offsets are intentionally kept so a later re-subscribe resumes
      // where it left off instead of replaying from "0".
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
    if (this._unsubError) this._unsubError();
    if (this._unsubReconnect) this._unsubReconnect();
    // Disconnect all pool drivers
    await Promise.allSettled(this._driverPool.map((d) => d.disconnect()));
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

      const canBlock = this._driver.hasBlockingClient === true;
      try {
        // With a dedicated blocking connection, BLOCK 1s for low latency.
        // Otherwise poll non-blocking and sleep, so the shared connection
        // never stalls publishes/presence ops (report M1).
        const entries = await this._driver.xread(
          streamsArg,
          undefined,
          canBlock ? 1000 : undefined,
        );

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
        } else if (!canBlock) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        // Previously swallowed entirely, with no log, no counter and no health
        // signal — a stream reader that had been failing for hours looked
        // identical to an idle one, and cross-node delivery was simply gone.
        this._pollErrors++;
        this._lastPollError = (err as Error)?.message ?? String(err);
        // Report the first failure and then every 60th, so a persistent outage
        // stays visible without flooding the log once per second.
        if (this._pollErrors === 1 || this._pollErrors % 60 === 0) {
          this._log("error", "Stream poll failed", {
            error: this._lastPollError,
            consecutiveFailures: this._pollErrors,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      // A clean pass clears the streak.
      if (this._pollErrors > 0) {
        this._log("warn", "Stream poll recovered", {
          afterFailures: this._pollErrors,
        });
        this._pollErrors = 0;
        this._lastPollError = undefined;
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
    // Drop the rehydration cache entry too — otherwise a Redis reconnect
    // resurrects presence for disconnected clients (report H3).
    this._presenceCache.delete(identity);
    await this._driver.del(key);
  }

  // ─── Presence Fencing ──────────────────────────────────────────────
  //
  // Unfenced presence writes let a node that no longer owns an identity
  // clobber the entry another node just wrote — routine under reconnect
  // churn, when a charger moves from node A to node B and A's teardown or
  // heartbeat lands afterwards. GET-then-SET cannot fix it (the race just
  // moves), so both operations run as Lua on the server.

  /** DEL only if the value still matches. Returns 1 when deleted. */
  private static readonly _DEL_IF_OWNED = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

  /** SET+EXPIRE only if absent or already ours. Returns 1 when claimed. */
  private static readonly _CLAIM_IF_FREE = `
local owner = redis.call('GET', KEYS[1])
if owner == false or owner == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0`;

  async removePresenceIfOwned(
    identity: string,
    nodeId: string,
  ): Promise<boolean> {
    const key = `${this._prefix}presence:${identity}`;
    if (!this._driver.evalScript) {
      // Driver cannot run scripts — fall back to a read-then-delete. Still
      // narrows the window enormously versus an unconditional DEL.
      const owner = await this._driver.get(key);
      if (owner !== nodeId) return false;
      this._presenceCache.delete(identity);
      await this._driver.del(key);
      return true;
    }

    const deleted = await this._driver.evalScript(
      RedisAdapter._DEL_IF_OWNED,
      [key],
      [nodeId],
    );
    if (Number(deleted) === 1) {
      this._presenceCache.delete(identity);
      return true;
    }
    return false;
  }

  async claimPresence(
    identity: string,
    nodeId: string,
    ttl: number,
  ): Promise<boolean> {
    const key = `${this._prefix}presence:${identity}`;
    const ttlSeconds = ttl || this._presenceTtlSeconds;

    if (!this._driver.evalScript) {
      const owner = await this._driver.get(key);
      if (owner !== null && owner !== nodeId) return false;
      this._presenceCache.set(identity, { nodeId, ttl: ttlSeconds });
      await this._driver.set(key, nodeId, ttlSeconds);
      return true;
    }

    const claimed = await this._driver.evalScript(
      RedisAdapter._CLAIM_IF_FREE,
      [key],
      [nodeId, String(ttlSeconds)],
    );
    if (Number(claimed) === 1) {
      this._presenceCache.set(identity, { nodeId, ttl: ttlSeconds });
      return true;
    }
    // Another node owns it — drop our stale rehydration entry so a Redis
    // reconnect does not resurrect our claim.
    this._presenceCache.delete(identity);
    return false;
  }

  // ─── Observability Pipeline ────────────────────────────────────────

  async metrics(): Promise<Record<string, unknown>> {
    let pendingMessages = 0;
    const streamDetails: Record<string, number> = {};

    // Calculate "consumer lag" by checking the length of all active streams
    // NOTE: XLEN counts all retained entries, including ones already
    // consumed but not yet trimmed by MAXLEN — treat this as an upper-bound
    // approximation of backlog, not an exact unread count (report M5).
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
      // Health of the stream reader. Non-zero means cross-node delivery into
      // this node is currently broken, which was previously invisible.
      pollErrors: this._pollErrors,
      ...(this._lastPollError ? { lastPollError: this._lastPollError } : {}),
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
