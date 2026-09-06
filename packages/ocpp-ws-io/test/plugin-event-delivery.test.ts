import { describe, expect, test, vi } from "vitest";
import { amqpPlugin } from "../src/plugins/amqp.js";
import { redisPubSubPlugin } from "../src/plugins/redis-pubsub.js";
import { webhookPlugin } from "../src/plugins/webhook.js";

// Three plugins dropped events on the floor:
//
// - amqp and redis-pubsub emit sub-typed message events ("message.inbound",
//   "message:inbound") but gate them against `events`, which is configured
//   with base names ("message"). Every message event was filtered out.
// - webhook enables "close" by default but only ever emitted "closing", which
//   the default list does not allow — so no shutdown webhook was ever sent.
//   It also fire-and-forgot the request instead of returning the promise the
//   server awaits.

const fakeClient = { identity: "CP001" } as never;

const inboundPayload = {
  direction: "inbound",
  message: [2, "id-1", "BootNotification", {}],
  ctx: { timestamp: Date.now() },
} as never;

describe("plugin event delivery", () => {
  test("amqp publishes sub-typed message events when 'message' is enabled", () => {
    const channel = {
      publish: vi.fn(
        (_exchange: string, _routingKey: string, _content: Buffer) => true,
      ),
    };
    const plugin = amqpPlugin({
      channel: channel as never,
      events: ["message"],
    });

    plugin.onMessage?.(fakeClient, inboundPayload);

    expect(channel.publish).toHaveBeenCalledTimes(1);
    const routingKey = channel.publish.mock.calls[0]?.[1];
    expect(routingKey).toContain("message.inbound");
  });

  test("amqp still honours the events allowlist", () => {
    const channel = {
      publish: vi.fn(
        (_exchange: string, _routingKey: string, _content: Buffer) => true,
      ),
    };
    const plugin = amqpPlugin({
      channel: channel as never,
      events: ["connect"],
    });

    plugin.onMessage?.(fakeClient, inboundPayload);

    expect(channel.publish).not.toHaveBeenCalled();
  });

  test("redis-pubsub publishes sub-typed message events when 'message' is enabled", () => {
    const client = {
      publish: vi.fn(async (_key: string, _message: string) => 1),
    };
    const plugin = redisPubSubPlugin({
      client: client as never,
      events: ["message"],
    });

    plugin.onMessage?.(fakeClient, inboundPayload);

    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(client.publish.mock.calls[0]?.[0]).toContain("message:inbound");
  });

  test("redis-pubsub still honours the events allowlist", () => {
    const client = {
      publish: vi.fn(async (_key: string, _message: string) => 1),
    };
    const plugin = redisPubSubPlugin({
      client: client as never,
      events: ["connect"],
    });

    plugin.onMessage?.(fakeClient, inboundPayload);

    expect(client.publish).not.toHaveBeenCalled();
  });

  test("webhook sends a shutdown notification under the default event list", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: { body: string }) =>
        new Response("", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const plugin = webhookPlugin({ url: "https://example.test/hook" });
      const result = plugin.onClosing?.();

      // Must return the promise so server.close() actually awaits it.
      expect(result).toBeInstanceOf(Promise);
      await result;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body ?? "{}");
      expect(body.event).toBe("close");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("webhook uses 'closing' when the config named that event", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: { body: string }) =>
        new Response("", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const plugin = webhookPlugin({
        url: "https://example.test/hook",
        events: ["closing"],
      });
      await plugin.onClosing?.();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body ?? "{}");
      expect(body.event).toBe("closing");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
