import { afterEach, describe, expect, test, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import type { OCPPPlugin } from "../src/types.js";

describe("plugin registration", () => {
  const servers: OCPPServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  test("registering the same plugin object twice does not double its hooks", async () => {
    const onInit = vi.fn();
    const onClosing = vi.fn();
    const plugin: OCPPPlugin = { name: "dupe", onInit, onClosing };

    const server = new OCPPServer();
    server.plugin(plugin);
    server.plugin(plugin);

    expect(onInit).toHaveBeenCalledTimes(1);
    await server.close();
    // Would be 2 if the duplicate registration had been kept.
    expect(onClosing).toHaveBeenCalledTimes(1);
  });

  test("two distinct instances sharing a name are both kept", async () => {
    // Two webhook plugins posting to different URLs legitimately share a name,
    // so deduplication is by identity, never by name.
    const aClosing = vi.fn();
    const bClosing = vi.fn();
    const a: OCPPPlugin = { name: "webhook", onInit: vi.fn(), onClosing: aClosing };
    const b: OCPPPlugin = { name: "webhook", onInit: vi.fn(), onClosing: bClosing };

    const server = new OCPPServer();
    server.plugin(a, b);

    expect(a.onInit).toHaveBeenCalledTimes(1);
    expect(b.onInit).toHaveBeenCalledTimes(1);
    await server.close();
    expect(aClosing).toHaveBeenCalledTimes(1);
    expect(bClosing).toHaveBeenCalledTimes(1);
  });

  test("warns when a route sets process-wide adaptive rate-limit options", async () => {
    const warn = vi.fn();
    const server = new OCPPServer({
      logging: {
        logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
      } as never,
    });
    servers.push(server);

    server.route("/ocpp/:identity").config({
      rateLimit: { adaptive: true, limit: 10, windowMs: 1000 },
    });
    await server.listen(0);

    expect(warn).toHaveBeenCalled();
    const call = warn.mock.calls.find((c) =>
      String(c[0]).includes("adaptive"),
    );
    expect(call).toBeDefined();
    expect((call?.[1] as { ignored: string[] }).ignored).toContain("adaptive");
  });

  test("does not warn for a route rate limit without adaptive options", async () => {
    const warn = vi.fn();
    const server = new OCPPServer({
      logging: {
        logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
      } as never,
    });
    servers.push(server);

    server.route("/ocpp/:identity").config({
      rateLimit: { limit: 10, windowMs: 1000 },
    });
    await server.listen(0);

    const adaptiveWarn = warn.mock.calls.find((c) =>
      String(c[0]).includes("adaptive"),
    );
    expect(adaptiveWarn).toBeUndefined();
  });
});
