import { afterEach, describe, expect, it } from "vitest";
import { OCPPServer } from "../src/server.js";

/**
 * `close()` stops every periodic task the server owns; `listen()` is what
 * brings a closed server back. Three of those tasks were started once — in the
 * constructor, or at plugin registration — and never again, so a restarted
 * server came back permanently degraded in ways nothing reported: no session
 * GC (and therefore an unbounded per-IP connection-bucket map), adaptive rate
 * limiting pinned at 1, and no telemetry push.
 *
 * The plugin hooks, worker pool and event adapter already had this treatment.
 * These are the ones that were missed.
 */

type Internals = {
  _gcInterval: unknown;
  _telemetryInterval: unknown;
  _adaptiveLimiter: { _timer: unknown } | null;
  _connectionBuckets: Map<string, unknown>;
  _nodeLiveness: Map<string, { alive: boolean; at: number }>;
  _sweepConnectionBuckets: (now: number) => void;
  _sweepNodeLiveness: (now: number) => void;
};

const peek = (s: OCPPServer) => s as unknown as Internals;

describe("server restart lifecycle", () => {
  let server: OCPPServer | undefined;

  afterEach(async () => {
    await server?.close({ force: true }).catch(() => {});
    server = undefined;
  });

  it("restarts the session GC, so connection buckets keep being swept", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      connectionRateLimit: { maxPerWindow: 5, windowMs: 1000 },
      logging: false,
    } as never);

    await server.listen(0);
    expect(peek(server)._gcInterval).not.toBeNull();

    await server.close();
    expect(peek(server)._gcInterval).toBeNull();

    await server.listen(0);
    // Without this the sweep never runs again and the bucket map grows by one
    // entry per distinct client IP for the life of the process.
    expect(peek(server)._gcInterval).not.toBeNull();
  }, 20000);

  it("restarts adaptive rate limiting rather than leaving it attached and stopped", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      rateLimit: { adaptive: true, cpuThresholdPercent: 90 },
      logging: false,
    } as never);

    await server.listen(0);
    expect(peek(server)._adaptiveLimiter?._timer).toBeTruthy();

    await server.close();
    await server.listen(0);

    // The limiter object survived close() either way. What matters is whether
    // it is still sampling — stopped, it reports a multiplier of 1 forever and
    // silently never sheds load, while every option still says it is enabled.
    expect(peek(server)._adaptiveLimiter).not.toBeNull();
    expect(peek(server)._adaptiveLimiter?._timer).toBeTruthy();
  }, 20000);

  it("restarts the telemetry push", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      telemetry: { pushIntervalMs: 60000 },
      logging: false,
    } as never);
    server.plugin({ name: "t", onTelemetry: () => {} });

    await server.listen(0);
    expect(peek(server)._telemetryInterval).not.toBeNull();

    await server.close();
    await server.listen(0);

    // Only plugin() started this, so a restart left it off unless the
    // application happened to register another plugin afterwards.
    expect(peek(server)._telemetryInterval).not.toBeNull();
  }, 20000);

  it("sweeps connection buckets that have gone idle", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      connectionRateLimit: { maxPerWindow: 5, windowMs: 1000 },
      logging: false,
    } as never);
    await server.listen(0);

    const s = peek(server);
    s._connectionBuckets.set("10.0.0.1", { count: 1, lastRefill: 0 });
    s._sweepConnectionBuckets(Date.now());
    expect(s._connectionBuckets.size).toBe(0);
  }, 20000);

  it("prunes node-liveness entries far past their TTL", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false } as never);
    await server.listen(0);

    const s = peek(server);
    const now = Date.now();
    s._nodeLiveness.set("dead-pod", { alive: true, at: now - 60 * 60 * 1000 });
    s._nodeLiveness.set("live-pod", { alive: true, at: now });
    s._sweepNodeLiveness(now);

    // Node ids are per-process, so rolling deploys mint new ones and nothing
    // ever removed the old entries.
    expect(s._nodeLiveness.has("dead-pod")).toBe(false);
    expect(s._nodeLiveness.has("live-pod")).toBe(true);
  }, 20000);

  it("makes a second close() wait for the first instead of resolving early", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false } as never);
    await server.listen(0);

    const order: string[] = [];
    const first = server.close().then(() => order.push("first"));
    const second = server.close().then(() => order.push("second"));
    await Promise.all([first, second]);

    // A SIGTERM and a SIGINT handler both calling close() is the ordinary
    // shape of this. The second used to resolve immediately, mid-drain, and
    // the caller exited the process on it.
    expect(order[0]).toBe("first");
    expect(order).toHaveLength(2);
  }, 20000);
});
