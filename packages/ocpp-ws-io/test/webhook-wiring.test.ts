import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OCPPClient } from "../src/client.js";
import { webhookPlugin } from "../src/plugins/webhook.js";
import { OCPPServer } from "../src/server.js";

/**
 * The "message" event was previously wired to a hook while absent from the
 * WebhookEvent union, so it could never fire and no unit test would have caught
 * that — the hook existed, the plugin object was well formed, and the gate
 * silently rejected it. This drives a real server and a real connection so the
 * whole chain is exercised: server dispatch, event gate, queue, and fetch.
 */

const getPort = (s: Server) => {
  const a = s.address();
  return a && typeof a !== "string" ? a.port : 0;
};

describe("webhook onMessage wiring", () => {
  let server: OCPPServer | undefined;
  let client: OCPPClient | undefined;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close().catch(() => {});
    vi.restoreAllMocks();
    client = undefined;
    server = undefined;
  });

  it("fires for a real OCPP exchange, once per direction", async () => {
    const sent: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      _u: string,
      init: RequestInit,
    ) => {
      sent.push(String(init.body));
      return { ok: true, status: 200 } as Response;
    }) as never);

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.plugin(
      webhookPlugin({
        url: "https://x.test",
        events: ["message"],
        maxConcurrent: 4,
      }),
    );
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.on("client", (c) =>
      c.handle("ocpp1.6", "Heartbeat", () => ({
        currentTime: new Date().toISOString(),
      })),
    );
    const http = await server.listen(0);

    client = new OCPPClient({
      identity: "CP-WIRED",
      endpoint: `ws://127.0.0.1:${getPort(http)}`,
      protocols: ["ocpp1.6"],
    });
    await client.connect();
    await client.call("ocpp1.6", "Heartbeat", {});

    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2), {
      timeout: 3000,
    });

    const events = sent.map((b) => JSON.parse(b));
    expect(events.every((e) => e.event === "message")).toBe(true);

    // One request/response pair is two webhooks — the inbound CALL and the
    // outbound CALLRESULT. Worth knowing before enabling this on a fleet.
    const directions = events.map((e) => e.data?.direction);
    expect(directions).toContain("IN");
    expect(directions).toContain("OUT");
    expect(events.some((e) => e.data?.method === "Heartbeat")).toBe(true);
    expect(events.every((e) => e.data?.identity === "CP-WIRED")).toBe(true);
  }, 20000);

  it("sends nothing when message events are not enabled", async () => {
    const sent: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      _u: string,
      init: RequestInit,
    ) => {
      sent.push(String(init.body));
      return { ok: true, status: 200 } as Response;
    }) as never);

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    // Default events: no "message".
    server.plugin(webhookPlugin({ url: "https://x.test" }));
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    server.on("client", (c) =>
      c.handle("ocpp1.6", "Heartbeat", () => ({
        currentTime: new Date().toISOString(),
      })),
    );
    const http = await server.listen(0);

    client = new OCPPClient({
      identity: "CP-QUIET",
      endpoint: `ws://127.0.0.1:${getPort(http)}`,
      protocols: ["ocpp1.6"],
    });
    await client.connect();
    await client.call("ocpp1.6", "Heartbeat", {});
    await new Promise((r) => setTimeout(r, 50));

    expect(sent.map((b) => JSON.parse(b).event)).not.toContain("message");
  }, 20000);
});
