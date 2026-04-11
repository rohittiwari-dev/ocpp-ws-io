import type { OCPPPlugin } from "../types.js";
import type { AsyncWorkerPlugin } from "./async-worker.js";

/**
 * Minimal Kafka Producer contract — compatible with `kafkajs`.
 * Users bring their own Kafka dependency; this plugin does not bundle one.
 */
export interface KafkaProducerLike {
  send(record: {
    topic: string;
    messages: Array<{
      key?: string | Buffer;
      value: string | Buffer;
      headers?: Record<string, string | Buffer>;
    }>;
    acks?: number;
    timeout?: number;
    compression?: number;
  }): Promise<unknown>;
}

type KafkaEvent =
  | "connect"
  | "disconnect"
  | "message"
  | "security"
  | "auth_failed"
  | "eviction";

/**
 * Options for the Kafka plugin.
 */
export interface KafkaPluginOptions {
  /**
   * User-provided Kafka Producer (e.g. from `kafkajs`).
   * The plugin does NOT manage connections — users provide a ready producer.
   */
  producer: KafkaProducerLike;

  /**
   * Base topic to publish to.
   * If `topicRouting` is true, this is a prefix.
   * @default "ocpp.events"
   */
  topic?: string;

  /**
   * If true, route events to specific topics instead of all to `topic`.
   * e.g., `ocpp.events.message`, `ocpp.events.security`
   * @default false
   */
  topicRouting?: boolean;

  /**
   * Which events to publish.
   * @default ["connect", "disconnect", "message", "security"]
   */
  events?: KafkaEvent[];

  /**
   * Include full message payloads for message events.
   * @default false
   */
  includePayload?: boolean;

  /**
   * Optional async worker for non-blocking publishes.
   * Highly recommended for Kafka.
   */
  worker?: AsyncWorkerPlugin;
}

/**
 * Publishes OCPP events to an Apache Kafka topic.
 *
 * Designed for high-throughput edge environments where raw OCPP telemetry
 * needs to be streamed into big data architectures (Data Lakes, ClickHouse)
 * for analysis.
 *
 * @example
 * ```ts
 * import { Kafka } from 'kafkajs';
 *
 * const kafka = new Kafka({ clientId: 'ocpp', brokers: ['localhost:9092'] });
 * const producer = kafka.producer();
 * await producer.connect();
 *
 * server.plugin(kafkaPlugin({
 *   producer,
 *   topic: 'ocpp.telemetry',
 *   includePayload: true
 * }));
 * ```
 */
export function kafkaPlugin(options: KafkaPluginOptions): OCPPPlugin {
  const baseTopic = options.topic ?? "ocpp.events";
  const topicRouting = options.topicRouting ?? false;
  const allowedEvents = new Set<KafkaEvent>(
    options.events ?? ["connect", "disconnect", "message", "security"],
  );

  const connectionTimes = new Map<string, number>();

  function resolveTopic(event: string) {
    if (!topicRouting) return baseTopic;
    return `${baseTopic}.${event}`;
  }

  function send(
    event: string,
    identity: string | undefined,
    data: Record<string, unknown>,
  ): void {
    if (!allowedEvents.has(event.split(".")[0] as KafkaEvent)) return;

    const topic = resolveTopic(event.split(".")[0]!);
    const value = JSON.stringify(data);

    // Kafka partitions heavily rely on the key. We use identity (CP Name) as key
    // so that messages for a particular charger process in-order on the same partition.
    const key = identity ?? "server";

    if (options.worker) {
      options.worker.enqueue("kafka-publish", async () => {
        await options.producer.send({
          topic,
          messages: [{ key, value, headers: { event } }],
        });
      });
    } else {
      // Fire and forget, catching errors privately
      options.producer
        .send({
          topic,
          messages: [{ key, value, headers: { event } }],
        })
        .catch(() => {});
    }
  }

  return {
    name: "kafka",

    onConnection(client) {
      connectionTimes.set(client.identity, Date.now());

      send("connect", client.identity, {
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

      send("disconnect", client.identity, {
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

      send(`message.${payload.direction}`, client.identity, msgData);
    },

    onSecurityEvent(event) {
      send("security", event.identity, {
        type: event.type,
        identity: event.identity,
        ip: event.ip,
        timestamp: event.timestamp,
        details: event.details,
      });
    },

    onAuthFailed(handshake, code, reason) {
      send("auth_failed", handshake.identity, {
        identity: handshake.identity,
        ip: handshake.remoteAddress,
        code,
        reason,
        timestamp: new Date().toISOString(),
      });
    },

    onEviction(evictedClient, newClient) {
      send("eviction", evictedClient.identity, {
        identity: evictedClient.identity,
        evictedBy: newClient.handshake.remoteAddress,
        timestamp: new Date().toISOString(),
      });
    },

    onClosing() {
      send("closing", undefined, {
        timestamp: new Date().toISOString(),
      });
    },

    onClose() {
      connectionTimes.clear();
      // We don't control the producer; user must disconnect it
    },
  };
}
