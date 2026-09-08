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
  | "eviction"
  | "closing";

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
  // Keyed by the client object rather than the identity string. A duplicate
  // identity evicts the older connection, and the new connection's
  // onConnection fires before the evicted socket's onDisconnect — so keyed by
  // identity, that late disconnect reads and deletes the entry the
  // replacement had just written. A WeakMap also releases an evicted client
  // without waiting for its close to arrive.
  const connectionTimes = new WeakMap<object, number>();

  // `mode: "stream"` falls back to PUBLISH when the client has no lowercase
  // `xadd`, which silently trades durability for fire-and-forget. ioredis has
  // it; node-redis and @redis/client expose `xAdd`, so those callers asked for
  // streams and got pub/sub with nothing said. Reported from onInit rather
  // than thrown — an exception here would take down deployments running today.
  const degradedToPubSub =
    mode === "stream" && typeof options.client.xadd !== "function";

  function buildKey(event: string): string {
    return `${prefix}:${event}`;
  }

  function send(event: string, data: Record<string, unknown>): void {
    // Sub-typed events carry a suffix in the key ("message:inbound"), but
    // `events` is configured with base names ("message"). Gate on the base or
    // every sub-typed event is silently dropped.
    const base = event.split(":")[0] as RedisPubSubEvent;
    if (!allowedEvents.has(base)) return;

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
      // Hand the worker the raw promise. Catching here first meant a rejection
      // could never reach a configured `AsyncWorkerOptions.onError`, so this
      // was the one bridge plugin whose failures were unreportable — kafka,
      // mqtt and amqp all pass theirs through.
      options.worker.enqueue(`redis-${mode}`, doPublish);
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

    onInit(server) {
      if (degradedToPubSub) {
        server.log.warn(
          'redisPubSubPlugin: mode "stream" fell back to PUBLISH',
          {
            reason:
              "the supplied client exposes no lowercase xadd, so events are published fire-and-forget and dropped when no subscriber is listening",
            fix: "ioredis exposes xadd; node-redis and @redis/client expose xAdd and need an adapter",
          },
        );
      }
    },

    onConnection(client) {
      connectionTimes.set(client, Date.now());

      send("connect", {
        identity: client.identity,
        ip: client.handshake.remoteAddress,
        protocol: client.protocol,
        timestamp: new Date().toISOString(),
      });
    },

    onDisconnect(client, code, reason) {
      const startTime = connectionTimes.get(client);
      const durationSec = startTime
        ? Math.round((Date.now() - startTime) / 1000)
        : 0;
      connectionTimes.delete(client);

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
      // connectionTimes is a WeakMap — entries are released with their clients.
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
