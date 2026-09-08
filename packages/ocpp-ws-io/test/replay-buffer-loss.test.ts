import { describe, expect, it, vi } from "vitest";
import { replayBufferPlugin } from "../src/plugins/replay-buffer.js";

/**
 * A queued command is lpop'd from Redis *before* it is replayed, and the
 * interceptor only re-queues errors that look like a closed socket. A timeout,
 * a CALLERROR from the charger, or a rejection from another plugin therefore
 * lost the command outright — in the plugin whose whole purpose is not losing
 * backend-initiated commands.
 */

/** An in-memory stand-in for the list operations the plugin uses. */
function fakeRedis(initial: string[] = []) {
  const lists = new Map<string, string[]>();
  return {
    lists,
    seed: (key: string, items: string[]) => lists.set(key, [...items]),
    rpush: async (key: string, ...values: string[]) => {
      const l = lists.get(key) ?? [];
      l.push(...values);
      lists.set(key, l);
      return l.length;
    },
    lpush: async (key: string, ...values: string[]) => {
      const l = lists.get(key) ?? [];
      l.unshift(...values);
      lists.set(key, l);
      return l.length;
    },
    lpop: async (key: string) => {
      const l = lists.get(key) ?? [];
      return l.shift() ?? null;
    },
    _initial: initial,
  };
}

const QUEUE = "ocpp:replay:CP001";
const queued = (method: string) =>
  JSON.stringify([2, "mid-1", method, { a: 1 }]);

function client(call: () => Promise<unknown>) {
  return {
    identity: "CP001",
    protocol: "ocpp1.6",
    handshake: { remoteAddress: "127.0.0.1" },
    use: () => {},
    call,
  } as never;
}

/** Let the flush's fire-and-forget replays settle. */
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("a replay that fails for a reason other than being offline", () => {
  it("returns the command to the queue instead of losing it", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [queued("RemoteStopTransaction")]);

    const plugin = replayBufferPlugin({ redis: redis as never });
    // A CALLERROR from the charger — not an offline error, so the interceptor
    // does not re-queue it and the command has already been popped.
    plugin.onConnection?.(
      client(() => Promise.reject(new Error("NotSupported"))),
    );
    await settle();

    const remaining = redis.lists.get(QUEUE) ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toContain("RemoteStopTransaction");
  });

  it("drops it once the attempt budget is spent, and says so", async () => {
    const redis = fakeRedis();
    // Already attempted twice; the third failure exhausts the default budget.
    redis.seed(QUEUE, [
      JSON.stringify([2, "mid-1", "UnlockConnector", { a: 1 }, 2]),
    ]);
    const errors: string[] = [];

    const plugin = replayBufferPlugin({
      redis: redis as never,
      logger: { warn: () => {}, error: (m: unknown) => errors.push(String(m)) },
    });
    plugin.onConnection?.(client(() => Promise.reject(new Error("nope"))));
    await settle();

    expect(redis.lists.get(QUEUE) ?? []).toHaveLength(0);
    expect(errors.some((e) => e.includes("Dropping queued"))).toBe(true);
  });

  it("does not re-queue a command that replayed successfully", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [queued("Reset")]);

    const plugin = replayBufferPlugin({ redis: redis as never });
    plugin.onConnection?.(client(() => Promise.resolve({ status: "Accepted" })));
    await settle();

    expect(redis.lists.get(QUEUE) ?? []).toHaveLength(0);
  });

  it("keeps the previous behaviour when maxReplayAttempts is 0", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [queued("Reset")]);

    const plugin = replayBufferPlugin({
      redis: redis as never,
      maxReplayAttempts: 0,
    });
    plugin.onConnection?.(client(() => Promise.reject(new Error("nope"))));
    await settle();

    expect(redis.lists.get(QUEUE) ?? []).toHaveLength(0);
  });

  it("counts attempts across flushes rather than retrying forever", async () => {
    const redis = fakeRedis();
    redis.seed(QUEUE, [queued("Reset")]);
    const call = vi.fn(() => Promise.reject(new Error("still failing")));
    const plugin = replayBufferPlugin({ redis: redis as never });

    // Three reconnects: attempt 1 and 2 return it, the third exhausts it.
    for (let i = 0; i < 3; i++) {
      plugin.onConnection?.(client(call));
      await settle();
    }

    expect(call).toHaveBeenCalledTimes(3);
    expect(redis.lists.get(QUEUE) ?? []).toHaveLength(0);
  });
});
