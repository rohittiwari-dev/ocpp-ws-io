import type { OCPPPlugin } from "../types.js";
import type { AsyncWorkerPlugin } from "./async-worker.js";

/**
 * Minimal AMQP channel contract — compatible with `amqplib`.
 * Users bring their own AMQP dependency; this plugin does not bundle one.
 */
export interface AmqpChannelLike {
  /** Publish a message to an exchange with a routing key. */
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: Record<string, unknown>,
  ): boolean;
  /** Close the channel. */
  close(): Promise<void> | void;
}

type AmqpEvent =
  | "connect"
  | "disconnect"
  | "message"
  | "security"
  | "auth_failed"
  | "eviction";

/**
 * Options for the AMQP plugin.
 */
export interface AmqpPluginOptions {
  /**
   * User-provided AMQP channel (from `amqplib`).
   * The plugin does NOT manage connections — users provide a ready channel.
   *
   * @example
   * ```ts
   * const conn = await amqp.connect('amqp://localhost');
   * const channel = await conn.createChannel();
   * await channel.assertExchange('ocpp.events', 'topic', { durable: true });
   * ```
   */
  channel: AmqpChannelLike;

  /**
   * Exchange to publish to.
   * @default "ocpp.events"
   */
  exchange?: string;

  /**
   * Routing key pattern. `{event}` and `{identity}` are interpolated.
   * @default "ocpp.{event}.{identity}"
   */
  routingKey?: string;

  /**
   * Which events to publish.
   * @default ["connect", "disconnect", "message", "security"]
   */
  events?: AmqpEvent[];

  /**
   * AMQP publish options.
   */
  publishOptions?: {
    /** Mark messages as persistent (survives broker restart). @default true */
    persistent?: boolean;
    /** Message priority (0-9). */
    priority?: number;
    /** Content type header. @default "application/json" */
    contentType?: string;
  };

  /**
   * Include full message payloads.
   * @default false
   */
  includePayload?: boolean;

  /**
   * Optional async worker for non-blocking publishes.
   */
  worker?: AsyncWorkerPlugin;
}

/**
 * Publishes OCPP events to an AMQP exchange (RabbitMQ, Azure Service Bus, etc).
 *
 * For enterprise integrations where guaranteed delivery and topic-based
 * routing are critical. Uses AMQP `topic` exchange by default so consumers
 * can subscribe to specific event patterns.
 *
 * @example
 * ```ts
 * import amqp from 'amqplib';
 * import { amqpPlugin } from 'ocpp-ws-io/plugins';
 *
 * const conn = await amqp.connect('amqp://localhost');
 * const channel = await conn.createChannel();
 * await channel.assertExchange('ocpp.events', 'topic', { durable: true });
 *
 * server.plugin(amqpPlugin({
 *   channel,
 *   exchange: 'ocpp.events',
 *   events: ['connect', 'disconnect', 'message', 'security'],
 * }));
 *
 * // Consumer binds:
 * // ocpp.connect.*     — all connection events
 * // ocpp.message.CP-101 — messages from CP-101
 * // ocpp.security.*    — all security events
 * ```
 */
export function amqpPlugin(options: AmqpPluginOptions): OCPPPlugin {
  const exchange = options.exchange ?? "ocpp.events";
  const routingKeyPattern = options.routingKey ?? "ocpp.{event}.{identity}";
  const allowedEvents = new Set<AmqpEvent>(
    options.events ?? ["connect", "disconnect", "message", "security"],
  );
  const pubOpts = {
    persistent: options.publishOptions?.persistent ?? true,
    contentType: options.publishOptions?.contentType ?? "application/json",
    ...(options.publishOptions?.priority !== undefined && {
      priority: options.publishOptions.priority,
    }),
  };
  const connectionTimes = new Map<string, number>();

  function buildRoutingKey(event: string, identity?: string): string {
    return routingKeyPattern
      .replace("{event}", event)
      .replace("{identity}", identity ?? "server");
  }

  function send(
    event: string,
    identity: string | undefined,
    data: Record<string, unknown>,
  ): void {
    if (!allowedEvents.has(event as AmqpEvent)) return;

    const routingKey = buildRoutingKey(event, identity);
    const content = Buffer.from(JSON.stringify(data));

    if (options.worker) {
      options.worker.enqueue("amqp-publish", async () => {
        options.channel.publish(exchange, routingKey, content, pubOpts);
      });
    } else {
      // channel.publish is synchronous (writes to TCP buffer)
      try {
        options.channel.publish(exchange, routingKey, content, pubOpts);
      } catch {
        // Channel may be closed — silently fail
      }
    }
  }

  return {
    name: "amqp",

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
      // Publish server-closing event
      send("closing", undefined, {
        timestamp: new Date().toISOString(),
      });
    },

    onClose() {
      connectionTimes.clear();
      try {
        options.channel.close();
      } catch {
        // Ignore — channel may already be closed
      }
    },
  };
}
