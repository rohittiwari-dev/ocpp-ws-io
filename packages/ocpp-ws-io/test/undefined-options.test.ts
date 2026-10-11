import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import type { OCPPServerClient } from "../src/server/server-client.js";

/**
 * An option given as `undefined` is not set: the default applies, and
 * reconfigure() leaves the current value. Spreading the options over the
 * defaults let it replace them, so `callTimeoutMs: undefined` timed every
 * call out at once and `maxReconnects: undefined` stopped reconnection.
 */
describe("an option given as undefined is not set", () => {
  let server: OCPPServer<"ocpp1.6"> | undefined;
  let client: OCPPClient<"ocpp1.6"> | undefined;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close({ force: true });
    client = undefined;
    server = undefined;
  });

  const answerAfter = <T>(ms: number, value: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  /** A server and a connected client; the client answers Reset after 50 ms. */
  const connect = async (serverOptions: { callTimeoutMs?: number }) => {
    server = new OCPPServer({ protocols: ["ocpp1.6"], ...serverOptions });
    server.on("client", (c) =>
      c.handle("Heartbeat", () =>
        answerAfter(50, { currentTime: new Date().toISOString() }),
      ),
    );
    const connected = new Promise<OCPPServerClient<"ocpp1.6">>((resolve) =>
      server?.on("client", resolve),
    );
    const port = ((await server.listen(0)).address() as AddressInfo).port;
    client = new OCPPClient({
      identity: "CP1",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      callTimeoutMs: undefined,
      reconnect: false,
    });
    client.handle("Reset", () => answerAfter(50, { status: "Accepted" }));
    await client.connect();
    return connected;
  };

  it("OCPPClient keeps its defaults", () => {
    client = new OCPPClient({
      identity: "CP1",
      endpoint: "ws://localhost:1",
      protocols: ["ocpp1.6"],
      callTimeoutMs: undefined,
      maxReconnects: undefined,
      pingIntervalMs: undefined,
      maxBadMessages: undefined,
    });
    expect(client.options).toMatchObject({
      callTimeoutMs: 30_000,
      maxReconnects: Number.POSITIVE_INFINITY,
      pingIntervalMs: 30_000,
      maxBadMessages: 50,
    });
  });

  it("a client call with callTimeoutMs undefined waits for its answer", async () => {
    await connect({});
    await expect(client?.call("Heartbeat", {})).resolves.toHaveProperty(
      "currentTime",
    );
  });

  it("OCPPClient.reconfigure leaves the current value", () => {
    client = new OCPPClient({
      identity: "CP1",
      endpoint: "ws://localhost:1",
      protocols: ["ocpp1.6"],
      callTimeoutMs: 5000,
    });
    client.reconfigure({ callTimeoutMs: undefined });
    expect(client.options.callTimeoutMs).toBe(5000);
  });

  it("a server call with callTimeoutMs undefined waits for its answer", async () => {
    const serverClient = await connect({ callTimeoutMs: undefined });
    await expect(
      serverClient.call("Reset", { type: "Soft" }),
    ).resolves.toEqual({ status: "Accepted" });
  });

  it("OCPPServer.reconfigure leaves the current value", async () => {
    const serverClient = await connect({ callTimeoutMs: 5000 });
    server?.reconfigure({ callTimeoutMs: undefined });
    // A client connecting after the reconfigure gets the server's value.
    await client?.close({ force: true });
    const next = new Promise<OCPPServerClient<"ocpp1.6">>((resolve) =>
      server?.on("client", resolve),
    );
    await client?.connect();
    await expect(
      (await next).call("Reset", { type: "Soft" }),
    ).resolves.toEqual({ status: "Accepted" });
    expect(serverClient).toBeDefined();
  });

  it("BrowserOCPPClient keeps its defaults, and reconfigure its values", () => {
    const browser = new BrowserOCPPClient({
      identity: "CP1",
      endpoint: "ws://localhost:1",
      protocols: ["ocpp1.6"],
      callTimeoutMs: undefined,
      maxReconnects: undefined,
    });
    const options = () =>
      (
        browser as unknown as {
          _options: { callTimeoutMs?: number; maxReconnects?: number };
        }
      )._options;
    expect(options()).toMatchObject({
      callTimeoutMs: 30_000,
      maxReconnects: Number.POSITIVE_INFINITY,
    });
    browser.reconfigure({ callTimeoutMs: undefined });
    expect(options().callTimeoutMs).toBe(30_000);
  });
});
