import { afterEach, describe, expect, test, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import { InMemoryAdapter } from "../src/adapters/adapter.js";

// The presence heartbeat used to be a bare setInterval at TTL/2 that wrote every
// local identity in one unbounded batch:
//
// - a single slow tick put the next write at exactly the expiry instant;
// - a refresh slower than the interval stacked up, each run re-reading and
//   re-writing every identity;
// - at 100k connections one cycle was a 100k-key MGET and a 100k-command
//   pipeline.

describe("presence heartbeat safety", () => {
  const servers: OCPPServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
    vi.useRealTimers();
  });

  test("chunks bulk registry calls instead of sending one huge batch", async () => {
    const adapter = new InMemoryAdapter();
    const batches: number[] = [];
    const readSizes: number[] = [];

    const originalSet = adapter.setPresenceBatch.bind(adapter);
    adapter.setPresenceBatch = async (entries) => {
      batches.push(entries.length);
      return originalSet(entries);
    };
    const originalGet = adapter.getPresenceBatch.bind(adapter);
    adapter.getPresenceBatch = async (ids) => {
      readSizes.push(ids.length);
      return originalGet(ids);
    };

    const server = new OCPPServer({ presenceTtlSeconds: 1 });
    servers.push(server);
    await server.setAdapter(adapter);

    // Populate more identities than one chunk holds, without real sockets.
    const map = (
      server as unknown as { _clientsByIdentity: Map<string, unknown> }
    )._clientsByIdentity;
    for (let i = 0; i < 2500; i++) map.set(`CP-${i}`, {});

    await (
      server as unknown as { _refreshPresence(t: number): Promise<void> }
    )._refreshPresence(1);

    expect(batches.length).toBe(3);
    expect(Math.max(...batches)).toBeLessThanOrEqual(1000);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(2500);

    expect(readSizes.length).toBe(3);
    expect(Math.max(...readSizes)).toBeLessThanOrEqual(1000);
  });

  test("skips a tick rather than overlapping a slow refresh", async () => {
    const warn = vi.fn();
    const adapter = new InMemoryAdapter();

    let inFlight = 0;
    let maxConcurrent = 0;
    // Held in an object; see client-lifecycle-holes for why a `let` will not
    // type-check here.
    const held: { release: (() => void) | null } = { release: null };
    adapter.setPresenceBatch = async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise<void>((r) => {
        held.release = r;
      });
      inFlight--;
    };

    const server = new OCPPServer({
      presenceTtlSeconds: 1, // ~333ms base interval
      logging: {
        logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
      } as never,
    });
    servers.push(server);
    await server.setAdapter(adapter);

    const map = (
      server as unknown as { _clientsByIdentity: Map<string, unknown> }
    )._clientsByIdentity;
    map.set("CP-1", {});

    // Let several ticks fire while the first refresh is still blocked.
    await new Promise((r) => setTimeout(r, 1200));

    expect(maxConcurrent).toBe(1);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("still running")),
    ).toBe(true);

    held.release?.();
  });
});
