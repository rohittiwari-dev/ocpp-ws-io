import { afterEach, describe, expect, test } from "vitest";
import { OCPPServer } from "../src/server.js";

describe("connection bucket GC (H4)", () => {
  let server: OCPPServer;
  afterEach(async () => {
    await server?.close({ force: true }).catch(() => {});
  });

  test("idle buckets are evicted; active buckets are kept", () => {
    server = new OCPPServer({
      connectionRateLimit: { limit: 5, windowMs: 1000 },
    });
    const buckets = (server as any)._connectionBuckets as Map<string, any>;
    buckets.set("1.2.3.4", { tokens: 2, lastRefill: Date.now() - 5000 });
    buckets.set("5.6.7.8", { tokens: 5, lastRefill: Date.now() });

    (server as any)._sweepConnectionBuckets(Date.now());

    expect(buckets.has("1.2.3.4")).toBe(false);
    expect(buckets.has("5.6.7.8")).toBe(true);
  });
});
