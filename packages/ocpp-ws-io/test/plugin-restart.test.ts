import { afterEach, describe, expect, it } from "vitest";
import { OCPPServer } from "../src/server.js";
import type { OCPPPlugin } from "../src/types.js";

/**
 * close() sends every plugin onClosing and onClose, but onInit ran only at
 * registration — so a server restarted through the close()/listen() cycle the
 * library explicitly supports came back with all of its plugins torn down, and
 * the next close() sent them a second onClose they had never been
 * re-initialised for.
 */

describe("plugin lifecycle across a restart", () => {
  let server: OCPPServer | undefined;

  afterEach(async () => {
    await server?.close().catch(() => {});
    server = undefined;
  });

  it("re-initialises plugins when the server is restarted", async () => {
    const events: string[] = [];
    const plugin: OCPPPlugin = {
      name: "lifecycle-spy",
      onInit() {
        events.push("init");
      },
      onClose() {
        events.push("close");
      },
    };

    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.plugin(plugin);

    await server.listen(0);
    await server.close();
    await server.listen(0);
    await server.close();

    // Every teardown is preceded by a matching setup.
    expect(events).toEqual(["init", "close", "init", "close"]);
  }, 20000);

  it("does not double-initialise on a first listen", async () => {
    let inits = 0;
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.plugin({ name: "counter", onInit: () => void inits++ });

    // Registration initialises once; the first listen must not repeat it.
    expect(inits).toBe(1);
    await server.listen(0);
    expect(inits).toBe(1);
  }, 20000);

  it("initialises a plugin registered while the server is already running", async () => {
    let inits = 0;
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    await server.listen(0);

    server.plugin({ name: "late", onInit: () => void inits++ });
    expect(inits).toBe(1);
  }, 20000);

  it("survives a plugin whose onInit rejects on the restart path", async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.plugin({
      name: "bad-init",
      async onInit() {
        throw new Error("init backend down");
      },
    });

    await server.listen(0);
    await server.close();
    // The restart must still complete — a broken plugin cannot block listen().
    await expect(server.listen(0)).resolves.toBeDefined();
  }, 20000);
});

describe("a plugin registered while clients are already connected", () => {
  let running: OCPPServer | undefined;
  let conn: import("../src/client.js").OCPPClient | undefined;

  afterEach(async () => {
    await conn?.close({ force: true }).catch(() => {});
    await running?.close().catch(() => {});
    running = undefined;
    conn = undefined;
  });

  it("is told about the connections it missed", async () => {
    const { OCPPClient } = await import("../src/client.js");
    const seen: string[] = [];

    running = new OCPPServer({ protocols: ["ocpp1.6"] });
    running.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const http = await running.listen(0);
    const addr = http.address();
    const port = addr && typeof addr !== "string" ? addr.port : 0;

    conn = new OCPPClient({
      identity: "CP-EARLY",
      endpoint: `ws://127.0.0.1:${port}`,
      protocols: ["ocpp1.6"],
    });
    await conn.connect();
    await new Promise((r) => setTimeout(r, 50));

    // Registered after the charger is already connected. Without the catch-up
    // it would receive that charger's onDisconnect having never seen it open.
    running.plugin({
      name: "late-arrival",
      onConnection: (c) => void seen.push(`connect:${c.identity}`),
      onDisconnect: (c) => void seen.push(`disconnect:${c.identity}`),
    });

    expect(seen).toEqual(["connect:CP-EARLY"]);

    await conn.close({ force: true });
    await new Promise((r) => setTimeout(r, 100));

    // Every disconnect it sees is now matched by a connect it saw.
    expect(seen).toEqual(["connect:CP-EARLY", "disconnect:CP-EARLY"]);
  }, 20000);

  it("sees nothing when registered before anything connects", async () => {
    const seen: string[] = [];
    running = new OCPPServer({ protocols: ["ocpp1.6"] });
    running.plugin({
      name: "early-arrival",
      onConnection: (c) => void seen.push(c.identity),
    });
    await running.listen(0);
    expect(seen).toEqual([]);
  }, 20000);
});
