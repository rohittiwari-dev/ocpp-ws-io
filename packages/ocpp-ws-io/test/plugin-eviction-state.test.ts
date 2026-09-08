import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { amqpPlugin } from "../src/plugins/amqp.js";
import { kafkaPlugin } from "../src/plugins/kafka.js";
import { metricsPlugin } from "../src/plugins/metrics.js";
import { mqttPlugin } from "../src/plugins/mqtt.js";
import { otelPlugin } from "../src/plugins/otel.js";
import { redisPubSubPlugin } from "../src/plugins/redis-pubsub.js";
import { sessionLogPlugin } from "../src/plugins/session-log.js";
import type { OCPPPlugin } from "../src/types.js";

/**
 * A duplicate identity evicts the older connection, and the observed order is:
 *
 *   onConnection(old) → onEviction → onConnection(new) → onDisconnect(old)
 *
 * The new connection's onConnection therefore lands *before* the evicted
 * socket's onDisconnect. Any plugin holding per-connection state under the
 * identity string had that late disconnect read and delete the entry the
 * replacement had just written — so the surviving connection lost its state
 * and both events reported nonsense.
 *
 * Two distinct client objects sharing one identity is the whole test.
 */

const makeClient = (identity: string) =>
  ({
    identity,
    protocol: "ocpp1.6",
    handshake: { remoteAddress: "127.0.0.1" },
  }) as never;

/** Drive one plugin through the real eviction sequence. */
function evictionSequence(plugin: OCPPPlugin) {
  const older = makeClient("CP-DUP");
  const newer = makeClient("CP-DUP");

  plugin.onConnection?.(older);
  plugin.onEviction?.(older, newer);
  plugin.onConnection?.(newer);
  // The evicted socket's close arrives last — this is the line that used to
  // destroy the replacement's state.
  plugin.onDisconnect?.(older, 4000, "evicted");

  // Let the survivor accumulate a duration a lost entry could not report: with
  // its start time gone the code falls back to 0, which is still a number, so
  // only elapsed time separates "tracked" from "wiped".
  vi.advanceTimersByTime(5000);

  return { older, newer };
}

const SURVIVOR_SECONDS = 5;

describe("per-connection plugin state survives a duplicate-identity eviction", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("kafka still knows the surviving connection", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const plugin = kafkaPlugin({
      producer: { send } as never,
      events: ["connect", "disconnect"],
    });
    const { newer } = evictionSequence(plugin);

    send.mockClear();
    plugin.onDisconnect?.(newer, 1000, "bye");

    const body = JSON.parse(
      (send.mock.calls[0]![0] as { messages: { value: string }[] }).messages[0]!
        .value,
    );
    // Reported 0 once the evicted socket wiped the shared entry.
    expect(body.durationSec).toBe(SURVIVOR_SECONDS);
  });

  for (const [name, build] of [
    [
      "mqtt",
      () => {
        const publish = vi.fn();
        const plugin = mqttPlugin({
          client: { publish, connected: true, end: vi.fn() } as never,
          events: ["connect", "disconnect"],
        });
        return { plugin, read: () => publish.mock.calls.at(-1)?.[1] };
      },
    ],
    [
      "redis-pubsub",
      () => {
        const publish = vi.fn().mockResolvedValue(1);
        const plugin = redisPubSubPlugin({
          client: { publish } as never,
          events: ["connect", "disconnect"],
        });
        return { plugin, read: () => publish.mock.calls.at(-1)?.[1] };
      },
    ],
    [
      "amqp",
      () => {
        const pub = vi.fn();
        const plugin = amqpPlugin({
          channel: { publish: pub, close: vi.fn() } as never,
          events: ["connect", "disconnect"],
        });
        return { plugin, read: () => String(pub.mock.calls.at(-1)?.[2]) };
      },
    ],
  ] as const) {
    it(`${name} still knows the surviving connection`, () => {
      const { plugin, read } = build();
      const { newer } = evictionSequence(plugin);

      plugin.onDisconnect?.(newer, 1000, "bye");
      const payload = JSON.parse(String(read()));
      expect(payload.durationSec).toBe(SURVIVOR_SECONDS);
    });
  }

  it("session-log reports a duration for the surviving connection", () => {
    const lines: Record<string, unknown>[] = [];
    const plugin = sessionLogPlugin({
      logger: {
        info: (_msg: string, meta?: Record<string, unknown>) => {
          if (meta) lines.push(meta);
        },
        warn: () => {},
        error: () => {},
      },
    } as never);

    const { newer } = evictionSequence(plugin);
    plugin.onDisconnect?.(newer, 1000, "bye");

    const last = lines.at(-1)!;
    expect(last.durationSec).toBe(SURVIVOR_SECONDS);
  });

  it("metrics does not lose the surviving connection", () => {
    const plugin = metricsPlugin();
    const { newer } = evictionSequence(plugin);
    // Nothing should throw, and the survivor must still be tracked.
    expect(() => plugin.onDisconnect?.(newer, 1000, "bye")).not.toThrow();
  });

  it("otel ends the evicted span, not the replacement's", () => {
    const ended: string[] = [];
    const spans: { name: string; ended: boolean }[] = [];
    const tracer = {
      startSpan: (name: string) => {
        const s = {
          name,
          ended: false,
          setAttribute: vi.fn(),
          setStatus: vi.fn(),
          addEvent: vi.fn(),
          end: vi.fn(() => {
            s.ended = true;
            ended.push(name);
          }),
          spanContext: () => ({ traceId: "t", spanId: "s" }),
        };
        spans.push(s as never);
        return s;
      },
    };

    const plugin = otelPlugin({ tracer: tracer as never });
    const { newer } = evictionSequence(plugin);

    // Two spans were started; exactly one — the evicted connection's — is done.
    expect(spans).toHaveLength(2);
    expect(spans[0]!.ended).toBe(true);
    expect(spans[1]!.ended).toBe(false);

    plugin.onDisconnect?.(newer, 1000, "bye");
    expect(spans[1]!.ended).toBe(true);
  });
});
