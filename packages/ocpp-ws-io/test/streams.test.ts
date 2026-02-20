import { describe, test, expect, afterAll, beforeAll } from "vitest";
import RedisMock from "ioredis-mock";
// @ts-ignore
import Redis from "ioredis";
import { RedisAdapter } from "../src/adapters/redis";

// Mock the Redis class for the tests
const RedisConstructor = RedisMock as unknown as typeof Redis;

describe("Redis Streams Persistence", () => {
  let pub: Redis;
  let sub: Redis;
  let blocking: Redis;
  let sender: Redis;

  beforeAll(() => {
    pub = new RedisConstructor();
    sub = new RedisConstructor();
    blocking = new RedisConstructor();
    sender = new RedisConstructor();
  });

  afterAll(async () => {
    // Adapter disconnects pub/sub/blocking.
    // We only need to cleanup sender or check if others are open.
    if (sender.status === "ready") await sender.quit();
    // Ensure others are closed if test failed before adapter.disconnect
    try {
      if (pub.status === "ready") await pub.quit();
    } catch {}
    try {
      if (sub.status === "ready") await sub.quit();
    } catch {}
    try {
      if (blocking.status === "ready") await blocking.quit();
    } catch {}
  });

  test("should persist messages when node is offline", async () => {
    const nodeId = "node-persistent-1";
    const streamKey = `ocpp-ws-io:ocpp:node:${nodeId}`;

    // 1. Ensure stream is clean
    await sender.del(streamKey);

    // 2. Simulate "offline" node: Send message to stream while no consumer is running
    const message = { type: "test", data: "hello-persistence" };
    // Using low-level Redis command to simulate another node publishing
    await sender.xadd(streamKey, "*", "message", JSON.stringify(message));

    // 3. Start "Node A" (Consumer) with logic that picks up from stream
    // We instantiate the adapter manually to control detailed behavior or just use OCPPServer
    const adapter = new RedisAdapter({
      pubClient: pub,
      subClient: sub,
      blockingClient: blocking,
      prefix: "ocpp-ws-io:",
    });

    const receivedMessages: unknown[] = [];

    // Subscribe to our own node ID
    await adapter.subscribe(`ocpp:node:${nodeId}`, (data) => {
      receivedMessages.push(data);
    });

    // 4. Wait for polling to pick up the OLD message
    // The adapter should start reading from '$' (new only)...
    // WAIT. If we implemented '$', it WON'T pick up the old message!
    // We need to verify if our implementation supports '0-0' or stored offset.
    // Our implementation currently uses '$' (new only) in `index.ts`.
    // So this test WILL FAIL if we expect persistence across restarts without stored offset logic.

    // Let's adjust the expectation:
    // If we use '$', we only get NEW messages.
    // To support persistence, we must pass a specific ID (or '0') to start reading.
    // But `RedisAdapter` currently hardcodes '$' in `_streamOffsets.set(..., "$")`.

    // CRITICAL: We need to modify `RedisAdapter` to allow resuming from a stored offset or '0' if valid.
    // For this test to pass "persistence", we might need to change the implementation to default to '0'
    // or allow configuration.

    // Let's pause writing the test and FIX implementation first?
    // Or write the test to PROVE it fails (TDD)?

    // Wait, let's look at `index.ts` again.
    // line: `this._streamOffsets.set(prefixedChannel, "$");`

    // If we want persistence, we should probably default to '0' (beginning)
    // OR we need a mechanism to store the last processed ID.
    // If we indiscriminately read from '0', we replay ALL history every restart.
    // That's bad for production unless we TRIM aggressively.

    // Let's write the test to EXPECT failure (or rather, modify expectation to show what currently happens)
    // and then fix it.

    // BUT, the goal is "Verify Persistence".
    // So let's write the test that *sends a message concurrently* (simulating live stream) first
    // to prove Streams work at all.

    // Then we tackle the "Goes down and comes back" part.

    // Let's verify BASIC stream delivery first.

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Send another message (LIVE)
    const liveMessage = { type: "test", data: "hello-live" };
    await sender.xadd(streamKey, "*", "message", JSON.stringify(liveMessage));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify we received BOTH the persistent message and the live message
    // The order depends on polling, but they should both be there.

    // We expect the persistent message to arrive immediately upon subscription (polling starts)
    // And live message arrived later.

    // Check for persistence
    const persistentMsg = receivedMessages.find(
      (m: any) => m.data === "hello-persistence",
    );
    expect(persistentMsg).toBeDefined();

    const liveMsg = receivedMessages.find((m: any) => m.data === "hello-live");
    expect(liveMsg).toBeDefined();

    await adapter.disconnect();
  }, 10000);
});
