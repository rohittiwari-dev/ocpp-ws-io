import type { OCPPPlugin } from "../types.js";
import type { AsyncWorkerPlugin } from "./async-worker.js";

/**
 * Minimal MQTT client contract — compatible with `mqtt.js`, `aedes`, etc.
 * Users bring their own MQTT dependency; this plugin does not bundle one.
 */
export interface MqttClientLike {
  publish(
    topic: string,
    message: string | Buffer,
    opts?: { qos?: number; retain?: boolean },
    callback?: (err?: Error) => void,
  ): unknown;
  end(force?: boolean, callback?: () => void): void;
  connected: boolean;
}

type MqttEvent =
  | "connect"
  | "disconnect"
  | "message"
  | "security"
  | "error"
  | "auth_failed"
  | "eviction";

/**
 * Options for the MQTT plugin.
 */
export interface MqttPluginOptions {
  /**
   * User-provided MQTT client instance (e.g., `mqtt.connect(...)`).
   * The plugin does NOT install `mqtt` — users bring their own.
   */
  client: MqttClientLike;

  /**
   * Topic prefix for all published messages.
   * Identity is appended: `{prefix}/{identity}/{event}`
   * @default "ocpp"
   */
  topicPrefix?: string;

  /**
   * Which events to publish.
   * @default ["connect", "disconnect", "message", "security"]
   */
  events?: MqttEvent[];

  /**
   * QoS level for published messages.
   * - 0: at most once (fire-and-forget, fastest)
   * - 1: at least once (with ack)
   * - 2: exactly once (slowest)
   * @default 0
   */
  qos?: 0 | 1 | 2;

  /**
   * Whether to publish full message payloads or just metadata.
   * @default false
   */
  includePayload?: boolean;

  /**
   * Custom topic builder for full control over topic structure.
   * If set, overrides `topicPrefix`.
   */
  topicBuilder?: (event: string, identity?: string) => string;

  /**
   * Transform the payload before publishing.
   * Useful for filtering sensitive data or reformatting.
   */
  transform?: (payload: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Optional async worker for non-blocking publishes.
   * When provided, all publish calls are enqueued to the worker.
   */
  worker?: AsyncWorkerPlugin;
}

/**
 * Publishes OCPP events to an MQTT broker.
 *
 * Essential for IoT-style architectures where charging stations, fleet
 * management systems, and monitoring dashboards subscribe to live OCPP feeds.
 *
 * @example
 * ```ts
 * import mqtt from 'mqtt';
 * import { mqttPlugin } from 'ocpp-ws-io/plugins';
 *
 * const client = mqtt.connect('mqtt://broker:1883');
 *
 * server.plugin(mqttPlugin({
 *   client,
 *   topicPrefix: 'ocpp/v1',
 *   events: ['connect', 'disconnect', 'message'],
 *   qos: 1,
 * }));
 * ```
 *
 * @example With async worker for non-blocking
 * ```ts
 * import { asyncWorkerPlugin, mqttPlugin } from 'ocpp-ws-io/plugins';
 *
 * const worker = asyncWorkerPlugin({ concurrency: 20 });
 * server.plugin(worker, mqttPlugin({ client, worker }));
 * ```
 *
 * @example Topic structure
 * ```
 * ocpp/CP-101/connect      → { identity, ip, protocol, timestamp }
 * ocpp/CP-101/message/IN   → { method, messageType, timestamp }
 * ocpp/CP-101/disconnect    → { code, reason, durationSec }
 * ocpp/security             → { type, identity, ip, details }
 * ```
 */
export function mqttPlugin(options: MqttPluginOptions): OCPPPlugin {
  const prefix = options.topicPrefix ?? "ocpp";
  const allowedEvents = new Set<MqttEvent>(
    options.events ?? ["connect", "disconnect", "message", "security"],
  );
  const qos = options.qos ?? 0;
  const connectionTimes = new Map<string, number>();

  function buildTopic(event: string, identity?: string): string {
    if (options.topicBuilder) return options.topicBuilder(event, identity);
    return identity ? `${prefix}/${identity}/${event}` : `${prefix}/${event}`;
  }

  function publish(topic: string, data: Record<string, unknown>): void {
    const payload = options.transform ? options.transform(data) : data;
    const message = JSON.stringify(payload);

    if (options.worker) {
      options.worker.enqueue(
        "mqtt-publish",
        () =>
          new Promise<void>((resolve, reject) => {
            options.client.publish(topic, message, { qos }, (err) =>
              err ? reject(err) : resolve(),
            );
          }),
      );
    } else {
      // Fire-and-forget — don't block the hook
      options.client.publish(topic, message, { qos });
    }
  }

  return {
    name: "mqtt",

    onConnection(client) {
      connectionTimes.set(client.identity, Date.now());
      if (!allowedEvents.has("connect")) return;

      publish(buildTopic("connect", client.identity), {
        identity: client.identity,
        ip: client.handshake.remoteAddress,
        protocol: client.protocol,
        timestamp: new Date().toISOString(),
      });
    },

    onDisconnect(client, code, reason) {
      if (!allowedEvents.has("disconnect")) {
        connectionTimes.delete(client.identity);
        return;
      }

      const startTime = connectionTimes.get(client.identity);
      const durationSec = startTime
        ? Math.round((Date.now() - startTime) / 1000)
        : 0;
      connectionTimes.delete(client.identity);

      publish(buildTopic("disconnect", client.identity), {
        identity: client.identity,
        code,
        reason,
        durationSec,
        timestamp: new Date().toISOString(),
      });
    },

    onMessage(client, payload) {
      if (!allowedEvents.has("message")) return;

      const msgData: Record<string, unknown> = {
        identity: client.identity,
        direction: payload.direction,
        messageType: payload.message[0],
        timestamp: payload.ctx.timestamp,
      };

      // Add method name for CALL messages
      if (payload.message[0] === 2 && payload.message[2]) {
        msgData.method = payload.message[2];
      }

      // Add latency for responses
      if (payload.ctx.latencyMs !== undefined) {
        msgData.latencyMs = payload.ctx.latencyMs;
      }

      if (options.includePayload) {
        msgData.payload = payload.message;
      }

      publish(
        buildTopic(`message/${payload.direction}`, client.identity),
        msgData,
      );
    },

    onSecurityEvent(event) {
      if (!allowedEvents.has("security")) return;

      publish(buildTopic("security", event.identity), {
        type: event.type,
        identity: event.identity,
        ip: event.ip,
        timestamp: event.timestamp,
        details: event.details,
      });
    },

    onError(client, error) {
      if (!allowedEvents.has("error")) return;

      publish(buildTopic("error", client.identity), {
        identity: client.identity,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    },

    onAuthFailed(handshake, code, reason) {
      if (!allowedEvents.has("auth_failed")) return;

      publish(buildTopic("auth_failed"), {
        identity: handshake.identity,
        ip: handshake.remoteAddress,
        code,
        reason,
        timestamp: new Date().toISOString(),
      });
    },

    onEviction(evictedClient, newClient) {
      if (!allowedEvents.has("eviction")) return;

      publish(buildTopic("eviction", evictedClient.identity), {
        identity: evictedClient.identity,
        evictedBy: newClient.handshake.remoteAddress,
        timestamp: new Date().toISOString(),
      });
    },

    onClosing() {
      // Publish server-closing event
      publish(buildTopic("closing"), {
        timestamp: new Date().toISOString(),
      });
    },

    onClose() {
      connectionTimes.clear();
      // Graceful MQTT disconnect
      try {
        options.client.end(false);
      } catch {
        // Ignore — client may already be closed
      }
    },
  };
}
