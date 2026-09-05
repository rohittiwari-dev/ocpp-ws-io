import { describe, expect, test } from "vitest";
import { OCPPServer } from "../src/server.js";

describe("lifecycle probes b0ee", () => {
  test("A: close() while listen(host) in flight leaves port bound", async () => {
    const server = new OCPPServer();
    const p = server.listen(0, "localhost");
    const closeDone = await Promise.race([
      server.close().then(() => "close-resolved"),
      new Promise((r) => setTimeout(() => r("close-hung"), 2000)),
    ]);
    const srv: any = await Promise.race([
      p,
      new Promise((r) => setTimeout(() => r(null), 2000)),
    ]);
    console.log("A: close:", closeDone, "listen resolved?", !!srv);
    if (!srv) { console.log("A: LISTEN PROMISE NEVER SETTLED"); expect(true).toBe(true); return; }
    console.log(
      "A: state after close+listen:",
      server.state,
      "listening:",
      srv.listening,
      "addr:",
      JSON.stringify(srv.address()),
    );
    if (srv.listening) await new Promise<void>((r) => srv.close(() => r()));
    expect(true).toBe(true);
  });

  test("B: second close() resolves before first finished", async () => {
    const server = new OCPPServer();
    await server.listen(0);
    let firstDone = false;
    (server as any)._plugins.push({
      name: "slow",
      onClosing: async () => {
        await new Promise((r) => setTimeout(r, 300));
      },
    });
    const p1 = server.close().then(() => {
      firstDone = true;
    });
    await server.close();
    console.log(
      "B: after 2nd close resolved, first close done?",
      firstDone,
      "state:",
      server.state,
    );
    await p1;
    expect(true).toBe(true);
  });

  test("C: intervals after close/listen restart", async () => {
    const server = new OCPPServer({ telemetry: { pushIntervalMs: 1000 } });
    server.plugin({ name: "t", onTelemetry: () => {} } as any);
    await server.listen(0);
    console.log(
      "C: before close gc:",
      !!(server as any)._gcInterval,
      "telemetry:",
      !!(server as any)._telemetryInterval,
    );
    await server.close();
    await server.listen(0);
    console.log(
      "C: after restart gc:",
      !!(server as any)._gcInterval,
      "telemetry:",
      !!(server as any)._telemetryInterval,
      "presence:",
      !!(server as any)._presenceInterval,
    );
    await server.close();
    expect(true).toBe(true);
  });

  test("D: reconfigure sessionTtlMs / maxSessions no-op", async () => {
    const server = new OCPPServer({ sessionTtlMs: 1000, maxSessions: 10 });
    server.reconfigure({ sessionTtlMs: 999999, maxSessions: 500 });
    console.log(
      "D: _sessionTimeoutMs:",
      (server as any)._sessionTimeoutMs,
      "lru maxSize:",
      (server as any)._sessions.maxSize,
      "options:",
      (server as any)._options.sessionTtlMs,
      (server as any)._options.maxSessions,
    );
    await server.close();
    expect(true).toBe(true);
  });

  test("E: adapter left set but disconnected after close", async () => {
    const { InMemoryAdapter } = await import("../src/adapters/adapter.js");
    const server = new OCPPServer();
    await server.setAdapter(new InMemoryAdapter());
    await server.listen(0);
    console.log("E: presence interval:", !!(server as any)._presenceInterval);
    await server.close();
    await server.listen(0);
    console.log(
      "E: after restart adapter set?",
      !!(server as any)._adapter,
      "presence interval:",
      !!(server as any)._presenceInterval,
      "channels:",
      (server as any)._adapter?._channels?.size,
    );
    await server.close();
    expect(true).toBe(true);
  });

  test("F: close() rejects if adapter.disconnect throws -> state stuck", async () => {
    const server = new OCPPServer();
    await server.setAdapter({
      publish: async () => {},
      subscribe: async () => {},
      unsubscribe: async () => {},
      disconnect: async () => {
        throw new Error("redis down");
      },
    } as any);
    await server.listen(0);
    let err: any;
    await server.close().catch((e) => {
      err = e;
    });
    console.log("F: close threw:", err?.message, "state:", server.state);
    const again = await server
      .close()
      .then(() => "resolved-noop")
      .catch((e) => `threw ${e.message}`);
    console.log("F: second close:", again, "state:", server.state);
    expect(true).toBe(true);
  });
});
