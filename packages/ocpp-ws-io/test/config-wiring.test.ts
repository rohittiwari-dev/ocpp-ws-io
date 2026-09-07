import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { AdaptiveLimiter } from "../src/adaptive-limiter.js";
import { OCPPServer } from "../src/server.js";
import { getClientIp } from "../src/ws-util.js";

const req = (headers: Record<string, string>, remote = "10.0.0.1") =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

describe("connectionRateLimit is per-IP only when a proxy is trusted", () => {
  it("collapses every client onto the proxy address when untrusted", () => {
    // The failure this guards: behind a load balancer every charger resolves
    // to the same address, so one shared bucket turns a per-IP limit into a
    // fleet-wide cap.
    const a = getClientIp(req({ "x-forwarded-for": "203.0.113.7" }), undefined);
    const b = getClientIp(req({ "x-forwarded-for": "203.0.113.9" }), undefined);
    expect(a).toBe("10.0.0.1");
    expect(a).toBe(b);
  });

  it("separates clients once the proxy is trusted", () => {
    const a = getClientIp(req({ "x-forwarded-for": "203.0.113.7" }), true);
    const b = getClientIp(req({ "x-forwarded-for": "203.0.113.9" }), true);
    expect(a).toBe("203.0.113.7");
    expect(b).toBe("203.0.113.9");
    expect(a).not.toBe(b);
  });

  it("takes the first hop of a multi-proxy chain", () => {
    expect(
      getClientIp(
        req({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" }),
        true,
      ),
    ).toBe("203.0.113.7");
  });

  it("accepts trustProxy on connectionRateLimit without configuring CORS", () => {
    const server = new OCPPServer({
      connectionRateLimit: { limit: 20, windowMs: 10_000, trustProxy: true },
    });
    expect(
      (server as unknown as { _options: { connectionRateLimit?: unknown } })
        ._options.connectionRateLimit,
    ).toMatchObject({ trustProxy: true });
  });
});

describe("adaptive limiter reconfiguration", () => {
  it("keeps sampleIntervalMs when adaptive is enabled by reconfigure", () => {
    const server = new OCPPServer({});
    server.reconfigure({
      rateLimit: { limit: 10, windowMs: 1000, adaptive: true, sampleIntervalMs: 500 },
    });

    const limiter = (server as unknown as { _adaptiveLimiter?: AdaptiveLimiter })
      ._adaptiveLimiter;
    expect(limiter).toBeInstanceOf(AdaptiveLimiter);
    // Was dropped on this path while the constructor honoured it, so a server
    // asking for 500 ms silently sampled every 2000 ms.
    expect(
      (limiter as unknown as { _sampleInterval: number })._sampleInterval,
    ).toBe(500);

    limiter?.stop?.();
  });
});
