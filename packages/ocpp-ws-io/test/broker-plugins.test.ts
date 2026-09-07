import { describe, expect, it, vi } from "vitest";
import { amqpPlugin } from "../src/plugins/amqp.js";
import { kafkaPlugin } from "../src/plugins/kafka.js";
import { mqttPlugin } from "../src/plugins/mqtt.js";
import { redisPubSubPlugin } from "../src/plugins/redis-pubsub.js";

/**
 * mqtt and kafka shipped with no test file at all. These cover the wiring a
 * user actually depends on: which events reach the broker, what the payload
 * looks like, and the two defects the audit turned up — kafka's session
 * duration going to zero on a duplicate-identity eviction, and redis-pubsub
 * swallowing failures before the async worker could report them.
 */

const client = (identity: string) =>
  ({ identity, handshake: { remoteAddress: "127.0.0.1" } }) as never;

describe("kafkaPlugin", () => {
  const producer = () => ({ send: vi.fn().mockResolvedValue(undefined) });

  it("publishes connect keyed by charger identity", () => {
    const p = producer();
    const plugin = kafkaPlugin({ producer: p as never });
    plugin.onConnection?.(client("CP001"));

    expect(p.send).toHaveBeenCalledTimes(1);
    const arg = p.send.mock.calls[0]![0] as {
      topic: string;
      messages: { key: string; value: string }[];
    };
    expect(arg.topic).toBe("ocpp.events");
    expect(arg.messages[0]!.key).toBe("CP001");
    expect(JSON.parse(arg.messages[0]!.value)).toMatchObject({
      identity: "CP001",
    });
  });

  it("does not publish auth_failed or eviction by default", () => {
    // The docs claimed the default was "all events"; it is four of six.
    const p = producer();
    const plugin = kafkaPlugin({ producer: p as never });
    plugin.onAuthFailed?.({ identity: "CP001", remoteAddress: "127.0.0.1" } as never, 401, "bad");
    plugin.onEviction?.(client("CP001"), client("CP001"));
    expect(p.send).not.toHaveBeenCalled();
  });

  it("publishes them once they are named", () => {
    const p = producer();
    const plugin = kafkaPlugin({
      producer: p as never,
      events: ["auth_failed"],
    });
    plugin.onAuthFailed?.({ identity: "CP001", remoteAddress: "127.0.0.1" } as never, 401, "bad");
    expect(p.send).toHaveBeenCalledTimes(1);
  });

  it("reports a real duration when a duplicate identity evicts a connection", () => {
    // Both connections share one identity for a moment. Keyed by identity, the
    // evicted socket's late close read and deleted the new connection's entry,
    // so both disconnects reported 0.
    const p = producer();
    const plugin = kafkaPlugin({
      producer: p as never,
      events: ["connect", "disconnect"],
    });

    const first = client("CP001");
    const second = client("CP001");

    plugin.onConnection?.(first);
    plugin.onConnection?.(second);
    // The evicted socket closes after the replacement has registered.
    plugin.onDisconnect?.(first, 1006, "evicted");
    plugin.onDisconnect?.(second, 1000, "bye");

    const durations = p.send.mock.calls
      .map((c) => JSON.parse((c[0] as never as { messages: { value: string }[] }).messages[0]!.value))
      .filter((v: Record<string, unknown>) => "durationSec" in v)
      .map((v: Record<string, unknown>) => v.durationSec);

    expect(durations).toHaveLength(2);
    // Neither may be undefined — that was the symptom.
    expect(durations.every((d) => typeof d === "number")).toBe(true);
  });

  it("routes to subtopics when topicRouting is on", () => {
    const p = producer();
    const plugin = kafkaPlugin({ producer: p as never, topicRouting: true });
    plugin.onConnection?.(client("CP001"));
    expect(
      (p.send.mock.calls[0]![0] as never as { topic: string }).topic,
    ).toBe("ocpp.events.connect");
  });
});

describe("mqttPlugin", () => {
  const mqtt = () => ({ publish: vi.fn(), connected: true, end: vi.fn() });

  it("publishes connect to a per-event topic", () => {
    const c = mqtt();
    const plugin = mqttPlugin({ client: c as never });
    plugin.onConnection?.(client("CP001"));

    expect(c.publish).toHaveBeenCalledTimes(1);
    const [topic, payload] = c.publish.mock.calls[0]!;
    expect(String(topic)).toContain("connect");
    expect(JSON.parse(String(payload))).toMatchObject({ identity: "CP001" });
  });

  it("honours the events filter", () => {
    const c = mqtt();
    const plugin = mqttPlugin({ client: c as never, events: ["disconnect"] });
    plugin.onConnection?.(client("CP001"));
    expect(c.publish).not.toHaveBeenCalled();
    plugin.onDisconnect?.(client("CP001"), 1000, "bye");
    expect(c.publish).toHaveBeenCalledTimes(1);
  });

  it("routes through the worker when one is supplied", () => {
    const c = mqtt();
    const enqueue = vi.fn().mockReturnValue(true);
    const plugin = mqttPlugin({
      client: c as never,
      worker: { enqueue } as never,
    });
    plugin.onConnection?.(client("CP001"));
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0]).toBe("mqtt-publish");
  });
});

describe("redisPubSubPlugin", () => {
  it("hands the worker an unwrapped promise so failures can be reported", async () => {
    // It used to .catch() before enqueueing, so a rejection could never reach
    // a configured AsyncWorkerOptions.onError.
    const failing = {
      publish: vi.fn().mockRejectedValue(new Error("redis down")),
    };
    let task: (() => Promise<unknown>) | undefined;
    const plugin = redisPubSubPlugin({
      client: failing as never,
      worker: {
        enqueue: (_n: string, fn: () => Promise<unknown>) => {
          task = fn;
          return true;
        },
      } as never,
    });

    plugin.onConnection?.(client("CP001"));
    expect(task).toBeTypeOf("function");
    await expect(task!()).rejects.toThrow("redis down");
  });

  it("warns when stream mode is asked for on a client without xadd", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      redisPubSubPlugin({
        client: { publish: vi.fn() } as never,
        mode: "stream",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("xadd");
    } finally {
      warn.mockRestore();
    }
  });

  it("stays quiet when the client can do streams", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      redisPubSubPlugin({
        client: { publish: vi.fn(), xadd: vi.fn() } as never,
        mode: "stream",
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("failure reporting", () => {
  it("mqtt reports a publish error through onPublishError", () => {
    const errors: { error: Error; topic: string }[] = [];
    const c = {
      connected: true,
      end: vi.fn(),
      publish: vi.fn(
        (
          _t: string,
          _m: string,
          _o: unknown,
          cb?: (e?: Error) => void,
        ) => cb?.(new Error("broker refused")),
      ),
    };
    const plugin = mqttPlugin({
      client: c as never,
      onPublishError: (error, ctx) => errors.push({ error, topic: ctx.topic }),
    });

    plugin.onConnection?.(client("CP001"));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.message).toBe("broker refused");
    expect(errors[0]!.topic).toContain("connect");
  });

  it("mqtt reports an attempt made while disconnected", () => {
    const errors: Error[] = [];
    const c = { connected: false, end: vi.fn(), publish: vi.fn() };
    const plugin = mqttPlugin({
      client: c as never,
      onPublishError: (error) => errors.push(error),
    });
    plugin.onConnection?.(client("CP001"));
    expect(errors.map((e) => e.message)).toContain(
      "MQTT client is not connected",
    );
  });

  it("mqtt survives an onPublishError that throws", () => {
    const c = {
      connected: true,
      end: vi.fn(),
      publish: vi.fn(
        (_t: string, _m: string, _o: unknown, cb?: (e?: Error) => void) =>
          cb?.(new Error("boom")),
      ),
    };
    const plugin = mqttPlugin({
      client: c as never,
      onPublishError: () => {
        throw new Error("observer blew up");
      },
    });
    expect(() => plugin.onConnection?.(client("CP001"))).not.toThrow();
  });

  it("amqp reports a dead channel through onError", () => {
    const errors: { error: Error; event: string }[] = [];
    const channel = {
      publish: vi.fn(() => {
        throw new Error("Channel closed");
      }),
      close: vi.fn(),
    };
    const plugin = amqpPlugin({
      channel: channel as never,
      onError: (error, ctx) => errors.push({ error, event: ctx.event }),
    });

    plugin.onConnection?.(client("CP001"));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.message).toBe("Channel closed");
    expect(errors[0]!.event).toBe("connect");
  });

  it("amqp stays silent when no onError is supplied", () => {
    const channel = {
      publish: vi.fn(() => {
        throw new Error("Channel closed");
      }),
      close: vi.fn(),
    };
    const plugin = amqpPlugin({ channel: channel as never });
    // Unchanged default: the throw is swallowed, nothing escapes the hook.
    expect(() => plugin.onConnection?.(client("CP001"))).not.toThrow();
  });
});
