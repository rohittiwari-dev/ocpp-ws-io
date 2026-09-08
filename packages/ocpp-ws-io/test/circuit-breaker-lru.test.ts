import { describe, expect, it, vi } from "vitest";
import { circuitBreakerPlugin } from "../src/plugins/circuit-breaker.js";

/**
 * The circuit was looked up once in onConnection and captured by the
 * middleware closure, while the store is LRU-bounded. Above maxTrackedClients
 * a new identity evicts an older one — the closure kept mutating the detached
 * object, and transition() created a fresh entry and wrote state there. The
 * breaker then never opened for the evicted connection, which on a busy server
 * is most of them.
 */

/** A client stub that records the middleware the plugin installs. */
function fakeClient(identity: string) {
  let middleware: ((ctx: unknown, next: () => unknown) => unknown) | undefined;
  const client = {
    identity,
    protocol: "ocpp1.6",
    handshake: { remoteAddress: "127.0.0.1" },
    use: (mw: (ctx: unknown, next: () => unknown) => unknown) => {
      middleware = mw;
    },
  };
  return {
    client: client as never,
    call: (fail: boolean) =>
      middleware?.({ type: "outgoing_call", method: "Heartbeat" }, () =>
        fail ? Promise.reject(new Error("boom")) : Promise.resolve("ok"),
      ),
  };
}

describe("circuit breaker after LRU eviction", () => {
  it("still fast-fails for a connection whose entry was evicted", async () => {
    const plugin = circuitBreakerPlugin({
      failureThreshold: 3,
      // Tiny store so eviction is easy to force.
      maxTrackedClients: 2,
    });

    const victim = fakeClient("CP-VICTIM");
    plugin.onConnection?.(victim.client);

    // Push the victim out of the LRU with other identities.
    for (const id of ["CP-A", "CP-B", "CP-C"]) {
      const other = fakeClient(id);
      plugin.onConnection?.(other.client);
      await other.call(false).catch(() => {});
    }

    // Trip the breaker on the evicted connection.
    for (let i = 0; i < 4; i++) await victim.call(true).catch(() => {});

    // With the circuit captured once, transition() wrote OPEN to a fresh map
    // entry while the middleware kept reading the detached object — which
    // stayed CLOSED, so calls went on flowing to a charger already known bad.
    await expect(victim.call(false)).rejects.toThrow(/[Cc]ircuit/);
  });

  it("fast-fails once open", async () => {
    const plugin = circuitBreakerPlugin({
      failureThreshold: 2,
      maxTrackedClients: 2,
    });
    const c = fakeClient("CP-TRIP");
    plugin.onConnection?.(c.client);

    for (let i = 0; i < 3; i++) await c.call(true).catch(() => {});

    // The next call is rejected by the breaker rather than attempted.
    await expect(c.call(false)).rejects.toThrow(/[Cc]ircuit/);
  });
});
