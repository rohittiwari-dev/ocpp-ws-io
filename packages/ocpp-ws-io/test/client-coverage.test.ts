import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { OCPPClient } from "../src/client";
import { SecurityProfile, ConnectionState } from "../src/types";

// Mock WebSocket
const mockWs = {
  ping: vi.fn(),
  terminate: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
  readyState: 1, // OPEN
};

vi.mock("ws", () => {
  return {
    default: vi.fn(() => mockWs),
  };
});

class TestClient extends OCPPClient {
  public get options() {
    return this._options;
  }
  public get ws() {
    return this._ws;
  }
  public set ws(v: any) {
    this._ws = v;
  }
  public get state() {
    return this._state;
  }
  public set state(v: any) {
    this._state = v;
  }

  // @ts-ignore
  public buildWsOptions() {
    return (this as any)._buildWsOptions();
  }
  // @ts-ignore
  public startPing() {
    (this as any)._startPing();
  }
  // @ts-ignore
  public stopPing() {
    (this as any)._stopPing();
  }
  // @ts-ignore
  public recordActivity() {
    (this as any)._recordActivity();
  }
  // @ts-ignore
  public validateOutbound(m: string, p: any, s: any) {
    return (this as any)._validateOutbound(m, p, s);
  }
  public setProtocol(p: string) {
    this._protocol = p;
  }
}

describe("OCPPClient Coverage", () => {
  let client: TestClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    vi.clearAllMocks();
    client = new TestClient({ identity: "test", endpoint: "ws://test" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to advance both timer execution and system time (Date.now())
  const advanceClock = (ms: number) => {
    vi.advanceTimersByTime(ms);
    vi.setSystemTime(new Date(Date.now() + ms));
  };

  test("Ping Deferral", () => {
    const c = new TestClient({
      identity: "test",
      endpoint: "ws://test",
      pingIntervalMs: 1000,
      deferPingsOnActivity: true,
    });
    c.ws = mockWs;
    c.state = ConnectionState.OPEN;

    c.startPing();

    // Initial: T+0. Timer set for 1000ms.
    expect(mockWs.ping).not.toHaveBeenCalled();

    // Move to T+500s
    advanceClock(500);
    c.recordActivity(); // Activity at T+500

    // Move to T+1000. Original Timer fires.
    // Logic: elapsed = 1000 - 500 = 500. 500 < 1000.
    // Defer: setTimeout(doPing, 1000 - 500 = 500).
    advanceClock(500);

    // Should be deferred, so no ping yet.
    expect(mockWs.ping).not.toHaveBeenCalled();

    // Move to T+1500. Deferred Timer fires.
    // Logic: elapsed = 1500 - 500 = 1000. 1000 >= 1000.
    // Proceed to ping.
    advanceClock(500);

    expect(mockWs.ping).toHaveBeenCalled();
  });

  test("Pong Timeout terminates connection", () => {
    const c = new TestClient({
      identity: "test",
      endpoint: "ws://test",
      pingIntervalMs: 1000,
      pongTimeoutMs: 500,
    });
    c.ws = mockWs;
    c.state = ConnectionState.OPEN;

    const warnSpy = vi.fn();
    // @ts-ignore
    c._logger = { warn: warnSpy };

    c.startPing();

    // Move to T+1000. Timer fires -> Ping sent.
    advanceClock(1000);
    // Note: If tests fail, increase this slightly or check if implementation adds buffer.
    // Implementation: this._pingTimer = setTimeout(doPing, this._options.pingIntervalMs);
    // So 1000ms should be exact.

    expect(mockWs.ping).toHaveBeenCalled();

    // Move to T+1500 (Ping + 500ms). Pong Timeout fires.
    advanceClock(500);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Pong timeout"),
      expect.any(Object),
    );
    expect(mockWs.terminate).toHaveBeenCalled();
  });

  test("Strict validation failure throws and emits", () => {
    const c = new TestClient({
      identity: "test",
      endpoint: "ws://test",
      strictMode: true,
    });
    c.setProtocol("ocpp1.6");

    const emitSpy = vi.spyOn(c, "emit");

    expect(() => {
      c.validateOutbound("BootNotification", {}, "req");
    }).toThrow();

    expect(emitSpy).toHaveBeenCalledWith(
      "strictValidationFailure",
      expect.any(Object),
    );
  });

  test("_buildWsOptions: Basic Auth and TLS", () => {
    const c = new TestClient({
      identity: "test",
      endpoint: "ws://test",
      securityProfile: SecurityProfile.BASIC_AUTH,
      password: "pass",
    });
    expect(c.buildWsOptions().headers?.Authorization).toContain("Basic");
  });
});
