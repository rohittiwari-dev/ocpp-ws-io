import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { OCPPServerClient } from "../src/server-client.js";
import type { WorkerPool } from "../src/worker-pool.js";

/**
 * `rateLimit.methods` used to force a main-thread JSON.parse and then return
 * before the worker-pool branch was reached, so a server configured for both
 * ran with a fully allocated, permanently idle pool while every frame parsed
 * on the event loop — with nothing said about it.
 */

/** A socket stub good enough for OCPPServerClient's constructor and dispatch. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  protocol = "ocpp1.6";
  send = vi.fn();
  close = vi.fn();
  terminate = vi.fn();
  ping = vi.fn();
  pong = vi.fn();
}

function makeClient(
  options: Record<string, unknown> & { plugins?: unknown[] },
  workerPool?: Partial<WorkerPool>,
) {
  const { plugins, ...clientOptions } = options;
  const ws = new FakeSocket();
  const client = new OCPPServerClient(
    { identity: "CP001", endpoint: "ws://localhost", ...clientOptions },
    {
      ws: ws as never,
      handshake: {
        identity: "CP001",
        remoteAddress: "127.0.0.1",
        headers: {},
        protocols: new Set(["ocpp1.6"]),
        pathname: "/CP001",
        params: {},
        query: new URLSearchParams(),
        request: {} as never,
      },
      session: {},
      protocol: "ocpp1.6",
      workerPool: workerPool as WorkerPool | undefined,
      plugins: plugins as never,
    },
  );
  return { client, ws };
}

const deliver = async (client: OCPPServerClient, frame: string) => {
  await (
    client as unknown as { _processInboundMessage(d: unknown): Promise<void> }
  )._processInboundMessage(Buffer.from(frame));
};

describe("rateLimit.methods alongside workerThreads", () => {
  const frame = '[2,"id1","Heartbeat",{}]';

  it("still parses off-thread when per-method limits are configured", async () => {
    const parse = vi.fn().mockResolvedValue({ message: JSON.parse(frame) });
    const { client } = makeClient(
      { rateLimit: { limit: 100, windowMs: 1000, methods: { Heartbeat: { limit: 100, windowMs: 1000 } } } },
      { parse } as Partial<WorkerPool>,
    );
    const onMessage = vi.spyOn(
      client as unknown as { _onMessage(...a: unknown[]): void },
      "_onMessage",
    );

    await deliver(client, frame);

    // The whole point: the pool is used rather than sitting idle.
    expect(parse).toHaveBeenCalledTimes(1);
    // ...and its result is handed on, so nothing parses twice.
    expect(onMessage).toHaveBeenCalledWith(expect.anything(), [
      2,
      "id1",
      "Heartbeat",
      {},
    ]);
  });

  it("uses the pool when no rate limit is configured at all", async () => {
    const parse = vi.fn().mockResolvedValue({ message: JSON.parse(frame) });
    const { client } = makeClient({}, { parse } as Partial<WorkerPool>);
    await deliver(client, frame);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("still enforces the per-method limit on the parsed action", async () => {
    const parse = vi.fn().mockResolvedValue({ message: JSON.parse(frame) });
    const { client } = makeClient(
      { rateLimit: { limit: 100, windowMs: 60_000, methods: { Heartbeat: { limit: 1, windowMs: 60_000 } } } },
      { parse } as Partial<WorkerPool>,
    );
    const onMessage = vi.spyOn(
      client as unknown as { _onMessage(...a: unknown[]): void },
      "_onMessage",
    );

    await deliver(client, frame);
    await deliver(client, frame);

    // Both frames reach the pool, but the second exceeds the Heartbeat budget
    // and is dropped before dispatch.
    expect(parse).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("falls back to a main-thread parse when the pool fails", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("pool is down"));
    const { client } = makeClient(
      { rateLimit: { limit: 100, windowMs: 1000, methods: { Heartbeat: { limit: 100, windowMs: 1000 } } } },
      { parse } as Partial<WorkerPool>,
    );
    const onMessage = vi.spyOn(
      client as unknown as { _onMessage(...a: unknown[]): void },
      "_onMessage",
    );

    await deliver(client, frame);

    expect(parse).toHaveBeenCalledTimes(1);
    // Still dispatched, with the method extracted inline for the limiter.
    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});

describe("connection rate limiting runs before plugins", () => {
  const frame = '[2,"id1","Heartbeat",{}]';

  it("does not spend a plugin's work on a message it is about to drop", async () => {
    // messageDedupPlugin parses on the main thread and does a Redis round trip
    // per message. Running it before the limiter meant a flooding station
    // bought one of each for every message the limiter then discarded.
    const onBeforeReceive = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({
      rateLimit: { limit: 1, windowMs: 60_000 },
      plugins: [{ name: "expensive", onBeforeReceive }],
    });

    await deliver(client, frame);
    await deliver(client, frame);
    await deliver(client, frame);

    // Only the message that survived the limiter reached the plugin.
    expect(onBeforeReceive).toHaveBeenCalledTimes(1);
  });

  it("still lets a plugin block a message that is within the limit", async () => {
    const onMessage = vi.fn();
    const { client } = makeClient({
      rateLimit: { limit: 100, windowMs: 60_000 },
      plugins: [{ name: "blocker", onBeforeReceive: () => false }],
    });
    const spy = vi.spyOn(
      client as unknown as { _onMessage(...a: unknown[]): void },
      "_onMessage",
    );

    await deliver(client, frame);
    expect(spy).not.toHaveBeenCalled();
    void onMessage;
  });
});
