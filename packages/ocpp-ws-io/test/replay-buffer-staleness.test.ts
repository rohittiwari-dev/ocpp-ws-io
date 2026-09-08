import { describe, expect, it, vi } from "vitest";
import { replayBufferPlugin } from "../src/plugins/replay-buffer.js";

/**
 * A queued command acts on whatever the connector is doing when it arrives,
 * not on the situation that prompted it. With no expiry, a
 * RemoteStartTransaction queued for one driver and delivered an hour later
 * reaches a connector where a different driver has since started a session
 * with an offline RFID tag — and starts, or bills, the wrong person.
 * UnlockConnector releases a cable that now belongs to someone else, and
 * RemoteStopTransaction carries a transactionId a charger may have reused.
 */

function fakeRedis() {
  const lists = new Map<string, string[]>();
  return {
    lists,
    seed: (key: string, items: string[]) => lists.set(key, [...items]),
    rpush: async (key: string, ...v: string[]) => {
      const l = lists.get(key) ?? [];
      l.push(...v);
      lists.set(key, l);
      return l.length;
    },
    lpush: async (key: string, ...v: string[]) => {
      const l = lists.get(key) ?? [];
      l.unshift(...v);
      lists.set(key, l);
      return l.length;
    },
    lpop: async (key: string) => (lists.get(key) ?? []).shift() ?? null,
  };
}

const QUEUE = "ocpp:replay:CP001";

/** A queued frame, optionally stamped as having been queued `agoMs` ago. */
const entry = (method: string, agoMs?: number) =>
  JSON.stringify(
    agoMs === undefined
      ? [2, "mid-1", method, { idTag: "USER-A" }]
      : [2, "mid-1", method, { idTag: "USER-A" }, 0, Date.now() - agoMs],
  );

function client(call: () => Promise<unknown>) {
  return {
    identity: "CP001",
    protocol: "ocpp1.6",
    handshake: { remoteAddress: "127.0.0.1" },
    use: () => {},
    call,
  } as never;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("a command queued long before the charger came back", () => {
  it("does not replay a RemoteStart queued an hour ago", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [entry("RemoteStartTransaction", 60 * 60 * 1000)]);
    const call = vi.fn(() => Promise.resolve({ status: "Accepted" }));

    const plugin = replayBufferPlugin({ redis: redis as never });
    plugin.onConnection?.(client(call));
    await settle();

    // The driver it was queued for left long ago; someone else may be charging.
    expect(call).not.toHaveBeenCalled();
    expect(redis.lists.get(QUEUE) ?? []).toHaveLength(0);
  });

  it("still replays one queued seconds ago, which is the real use case", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [entry("RemoteStopTransaction", 3_000)]);
    const call = vi.fn(() => Promise.resolve({ status: "Accepted" }));

    const plugin = replayBufferPlugin({ redis: redis as never });
    plugin.onConnection?.(client(call));
    await settle();

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("says which command it discarded and how old it was", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [entry("UnlockConnector", 30 * 60 * 1000)]);
    const warnings: string[] = [];

    const plugin = replayBufferPlugin({
      redis: redis as never,
      logger: { warn: (m: unknown) => warnings.push(String(m)), error: () => {} },
    });
    plugin.onConnection?.(client(() => Promise.resolve({})));
    await settle();

    expect(warnings.some((w) => w.includes("UnlockConnector"))).toBe(true);
    expect(warnings.some((w) => w.includes("Discarding"))).toBe(true);
  });

  it("honours a caller's own per-action policy", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [
      entry("GetConfiguration", 10_000),
      entry("RemoteStartTransaction", 10_000),
    ]);
    const seen: string[] = [];

    const plugin = replayBufferPlugin({
      redis: redis as never,
      // Reads are safe whenever they land; starting a charge is not.
      replayable: (action) => action.startsWith("Get"),
    });
    plugin.onConnection?.(
      client(((m: string) => {
        seen.push(m);
        return Promise.resolve({});
      }) as never),
    );
    await settle();

    expect(seen).toEqual(["GetConfiguration"]);
  });

  it("replays an entry queued before the timestamp existed", async () => {
    const redis = fakeRedis();
    // Four slots — written by a previous version. Dropping these on upgrade
    // would be its own kind of loss.
    redis.seed(QUEUE, [entry("Reset")]);
    const call = vi.fn(() => Promise.resolve({}));

    const plugin = replayBufferPlugin({ redis: redis as never });
    plugin.onConnection?.(client(call));
    await settle();

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not let retries refresh the age and outlive the limit", async () => {
    const redis = fakeRedis();
    // Old enough that it should expire, but with an attempt already recorded.
    redis.seed(QUEUE, [
      JSON.stringify([
        2,
        "mid-1",
        "RemoteStartTransaction",
        {},
        1,
        Date.now() - 10 * 60 * 1000,
      ]),
    ]);
    const call = vi.fn(() => Promise.reject(new Error("nope")));

    const plugin = replayBufferPlugin({ redis: redis as never });
    plugin.onConnection?.(client(call));
    await settle();

    expect(call).not.toHaveBeenCalled();
    expect(redis.lists.get(QUEUE) ?? []).toHaveLength(0);
  });

  it("replays regardless of age when expiry is disabled", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [entry("GetDiagnostics", 24 * 60 * 60 * 1000)]);
    const call = vi.fn(() => Promise.resolve({}));

    const plugin = replayBufferPlugin({
      redis: redis as never,
      maxQueueAgeMs: 0,
    });
    plugin.onConnection?.(client(call));
    await settle();

    expect(call).toHaveBeenCalledTimes(1);
  });
});
