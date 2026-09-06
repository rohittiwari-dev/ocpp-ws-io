import { afterEach, describe, expect, test, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import { TimeoutError } from "../src/errors.js";

// sendToClient used to `await adapter.publish(...)` before awaiting the pending
// call's own promise. An adapter whose publish() hangs instead of rejecting — a
// black-holed Redis connection with no socket timeout — parked the caller on
// that await while the call's timer fired with nobody observing it: an
// unhandled rejection (fatal on Node by default) plus a caller promise that
// never settled.

describe("cross-node send with a stalled transport", () => {
  const servers: OCPPServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  test("a publish that never settles still times out the call", async () => {
    const adapter = new InMemoryAdapter();
    // Presence says the client lives on another node, so the unicast path runs.
    await adapter.setPresence("CP001", "some-other-node", 300);
    // ...and the transport black-holes the message.
    adapter.publish = () => new Promise<void>(() => {});

    const server = new OCPPServer({ callTimeoutMs: 150 });
    servers.push(server);
    await server.setAdapter(adapter);

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await expect(
        server.sendToClient("CP001", "Heartbeat", {}),
      ).rejects.toBeInstanceOf(TimeoutError);

      // Give any stray rejection a turn to surface.
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  test("a publish that rejects settles the call with the transport error", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.setPresence("CP001", "some-other-node", 300);
    adapter.publish = async () => {
      throw new Error("adapter down");
    };

    const server = new OCPPServer({ callTimeoutMs: 5000 });
    servers.push(server);
    await server.setAdapter(adapter);

    // Rejects immediately with the transport error, not after the full timeout.
    await expect(server.sendToClient("CP001", "Heartbeat", {})).rejects.toThrow(
      "adapter down",
    );
  });

  test("no pending remote call is left behind after either failure", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.setPresence("CP001", "some-other-node", 300);
    adapter.publish = async () => {
      throw new Error("adapter down");
    };

    const server = new OCPPServer({ callTimeoutMs: 5000 });
    servers.push(server);
    await server.setAdapter(adapter);

    await expect(
      server.sendToClient("CP001", "Heartbeat", {}),
    ).rejects.toThrow();

    const pending = (
      server as unknown as { _pendingRemoteCalls: Map<string, unknown> }
    )._pendingRemoteCalls;
    expect(pending.size).toBe(0);
  });
});
