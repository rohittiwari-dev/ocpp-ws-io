import type { OCPPPlugin } from "../types.js";
import type { AsyncWorkerPlugin } from "./async-worker.js";

/**
 * Minimal Redis client contract — compatible with `ioredis` and `node-redis`.
 * Users bring their own Redis dependency; this plugin does not bundle one.
 */
export interface RedisClientLike {
  /** Publish to a Pub/Sub channel. */
  publish(channel: string, message: string): Promise<number> | unknown;
  /** Append to a Redis Stream (optional — only needed for stream mode). */
  xadd?(
    key: string,
    ...args: (string | number)[]
  ): Promise<string | null> | unknown;
  /** Graceful disconnect. */
  quit?(): Promise<unknown> | unknown;
  disconnect?(): void;
}

type RedisPubSubEvent =
  | "connect"
  | "disconnect"
  | "message"
  | "security"
  | "auth_failed"
  | "eviction";

/**
 * Options for the Redis Pub/Sub plugin.
 */
export interface RedisPubSubPluginOptions {
  /**
   * User-provided Redis client for publishing.
   * Supports ioredis or node-redis compatible clients.
   */
  client: RedisClientLike;

  /**
   * Publishing mode:
   * - `"pubsub"`: Uses PUBLISH to channels (real-time subscribers)
   * - `"stream"`: Uses XADD to Redis Streams (persistent, consumer groups)
   * @default "pubsub"
   */
  mode?: "pubsub" | "stream";

  /**
   * Channel/stream key prefix.
   * @default "ocpp"
   */
  prefix?: string;

  /**
   * Which events to publish.
   * @default ["connect", "disconnect", "message", "security"]
   */
  events?: RedisPubSubEvent[];

  /**
   * For stream mode: max stream length (MAXLEN ~approximate trimming).
   * Older entries are trimmed automatically.
   * @default 10000
   */
  maxStreamLength?: number;

  /**
   * Include full message payloads.
   * @default false
   */
  includePayload?: boolean;

  /**
   * Custom serializer.
   * @default JSON.stringify
   */
  serialize?: (data: Record<string, unknown>) => string;

  /**
   * Optional async worker for non-blocking publishes.
   */
  worker?: AsyncWorkerPlugin;
}

/**
 * Publishes OCPP events to Redis Pub/Sub channels or Redis Streams.
 *
 * Ideal for microservice architectures where billing, analytics, and alerting
 * services subscribe to OCPP feeds, or for durable event sourcing via Streams.
 *
 * @example Pub/Sub mode
 * ```ts
 * import Redis from 'ioredis';
 * import { redisPubSubPlugin } from 'ocpp-ws-io/plugins';
 *
 * const redis = new Redis();
 * server.plugin(redisPubSubPlugin({
 *   client: redis,
 *   mode: 'pubsub',
 *   prefix: 'ocpp',
 *   events: ['connect', 'disconnect', 'message'],
 * }));
 * // Subscribers: redis.subscribe('ocpp:connect')
 * ```
 *
 * @example Stream mode (durable)
 * ```ts
 * server.plugin(redisPubSubPlugin({
 *   client: redis,
 *   mode: 'stream',
 *   maxStreamLength: 50000,
 * }));
 * // Consumers: redis.xreadgroup('GROUP', 'mygroup', 'consumer1', ...)
 * ```
 */
export function redisPubSubPlugin(
  options: RedisPubSubPluginOptions,
): OCPPPlugin {
  const mode = options.mode ?? "pubsub";
  const prefix = options.prefix ?? "ocpp";
  const allowedEvents = new Set<RedisPubSubEvent>(
    options.events ?? ["connect", "disconnect", "message", "security"],
  );
  const maxLen = options.maxStreamLength ?? 10000;
  const serialize = options.serialize ?? JSON.stringify;
  const connectionTimes = new Map<string, number>();

  function buildKey(event: string): string {
    return `${prefix}:${event}`;
  }

  function send(event: string, data: Record<string, unknown>): void {
    if (!allowedEvents.has(event as RedisPubSubEvent)) return;

    const key = buildKey(event);
    const message = serialize(data);

    const doPublish = async () => {
      if (mode === "stream" && options.client.xadd) {
        // XADD key MAXLEN ~ maxLen * data...
        await options.client.xadd(
          key,
          "MAXLEN",
          "~",
          maxLen,
          "*",
          "data",
          message,
        );
      } else {
        // PUBLISH channel message
        await options.client.publish(key, message);
      }
    };

    if (options.worker) {
      options.worker.enqueue(`redis-${mode}`, () =>
        doPublish().catch(() => {}),
      );
    } else {
      // Fire-and-forget
      try {
        doPublish().catch?.(() => {});
      } catch {
        // Sync errors from client
      }
    }
  }

  return {
    name: "redis-pubsub",

    onConnection(client) {
      connectionTimes.set(client.identity, Date.now());

      send("connect", {
        identity: client.identity,
        ip: client.handshake.remoteAddress,
        protocol: client.protocol,
        timestamp: new Date().toISOString(),
      });
    },

    onDisconnect(client, code, reason) {
      const startTime = connectionTimes.get(client.identity);
      const durationSec = startTime
        ? Math.round((Date.now() - startTime) / 1000)
        : 0;
      connectionTimes.delete(client.identity);

      send("disconnect", {
        identity: client.identity,
        code,
        reason,
        durationSec,
        timestamp: new Date().toISOString(),
      });
    },

    onMessage(client, payload) {
      const msgData: Record<string, unknown> = {
        identity: client.identity,
        direction: payload.direction,
        messageType: payload.message[0],
        timestamp: payload.ctx.timestamp,
      };

      if (payload.message[0] === 2 && payload.message[2]) {
        msgData.method = payload.message[2];
      }

      if (payload.ctx.latencyMs !== undefined) {
        msgData.latencyMs = payload.ctx.latencyMs;
      }

      if (options.includePayload) {
        msgData.payload = payload.message;
      }

      // Publish to direction-specific channel: ocpp:message:IN or ocpp:message:OUT
      send(`message:${payload.direction}`, msgData);
    },

    onSecurityEvent(event) {
      send("security", {
        type: event.type,
        identity: event.identity,
        ip: event.ip,
        timestamp: event.timestamp,
        details: event.details,
      });
    },

    onAuthFailed(handshake, code, reason) {
      send("auth_failed", {
        identity: handshake.identity,
        ip: handshake.remoteAddress,
        code,
        reason,
        timestamp: new Date().toISOString(),
      });
    },

    onEviction(evictedClient, newClient) {
      send("eviction", {
        identity: evictedClient.identity,
        evictedBy: newClient.handshake.remoteAddress,
        timestamp: new Date().toISOString(),
      });
    },

    onClosing() {
      send("closing", {
        timestamp: new Date().toISOString(),
      });
    },

    onClose() {
      connectionTimes.clear();
      try {
        if (options.client.quit) {
          options.client.quit();
        } else if (options.client.disconnect) {
          options.client.disconnect();
        }
      } catch {
        // Ignore — client may already be closed
      }
    },
  };
}
