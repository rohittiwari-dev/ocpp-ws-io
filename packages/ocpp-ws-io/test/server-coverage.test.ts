import { describe, test, expect, vi, beforeEach } from "vitest";
import { OCPPServer } from "../src/server";

describe("OCPPServer Coverage", () => {
  let server: OCPPServer;
  let adapter: any;
  let broadcastHandler: (msg: any) => void;
  let unicastHandler: (msg: any) => void;

  beforeEach(async () => {
    server = new OCPPServer();
    adapter = {
      publish: vi.fn(),
      subscribe: vi.fn((channel, handler) => {
        if (channel === "ocpp:broadcast") broadcastHandler = handler;
        if (channel.startsWith("ocpp:node:")) unicastHandler = handler;
        return Promise.resolve();
      }),
      getPresence: vi.fn(),
      setPresence: vi.fn(),
      removePresence: vi.fn(),
    };
    // @ts-ignore
    server._nodeId = "my-node-id";
    await server.setAdapter(adapter);
  });

  test("ignores broadcast from self", () => {
    const loggerSpy = vi.fn();
    // @ts-ignore
    server._logger = { error: loggerSpy };

    broadcastHandler({ source: "my-node-id", method: "Test", params: {} });
    expect(loggerSpy).not.toHaveBeenCalled();
  });

  test("handles malformed broadcast", () => {
    const loggerSpy = vi.fn();
    // @ts-ignore
    server._logger = { error: loggerSpy }; // Error log happens on catch

    // Valid msg but throws in processing?
    // Or invalid msg structure. The code checks `if (!msg || typeof msg !== "object") return;`
    // So null/undefined returns early.
    broadcastHandler(null);
    broadcastHandler("string");
    expect(loggerSpy).not.toHaveBeenCalled();

    // To hit catch block, we need something to throw inside the try.
    // e.g. accessing property of null... but we check that.
    // Maybe if client.call throws?
    // client.call(...).catch() handles it.

    // Changing inner logic via mock to throw?
    // It's hard to make _onBroadcast throw unless we mock this._clients iterator to throw.
  });

  test("handles malformed unicast", () => {
    unicastHandler(null);
    expect(adapter.publish).not.toHaveBeenCalledWith(
      expect.stringContaining("ocpp:node"),
      expect.anything(),
    );
  });

  test("unicast to unknown client logs warn and removes presence", () => {
    const warnSpy = vi.fn();
    // @ts-ignore
    server._logger = { warn: warnSpy, error: vi.fn() };

    unicastHandler({
      source: "other-node",
      target: "unknown-client",
      method: "Test",
      params: {},
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "Received unicast for unknown client",
      expect.any(Object),
    );
    expect(adapter.removePresence).toHaveBeenCalledWith("unknown-client");
  });

  test("unicast client call error is logged", async () => {
    const errorSpy = vi.fn();
    // @ts-ignore
    server._logger = { error: errorSpy };

    // Mock client
    const client = {
      identity: "client-1",
      call: vi.fn().mockRejectedValue(new Error("Call Failed")),
    } as any;
    // @ts-ignore — mirror real _handleUpgrade: both the set and the identity index
    server._clients.add(client);
    // @ts-ignore
    server._clientsByIdentity.set("client-1", client);

    await unicastHandler({
      source: "other-node",
      target: "client-1",
      method: "Test",
      params: {},
    });

    // Wait for promise rejection handling
    await new Promise((r) => setTimeout(r, 10));

    expect(errorSpy).toHaveBeenCalledWith(
      "Error delivering unicast to client",
      expect.any(Object),
    );
  });

  test("sendToClient throws if registry returns null", async () => {
    adapter.getPresence.mockResolvedValue(null);
    await expect(server.sendToClient("missing", "Test", {})).rejects.toThrow(
      "Client missing not found",
    );
  });

  test("sendToClient: checks overload parsing (coverage for branches)", async () => {
    // 3 args
    adapter.getPresence.mockResolvedValue(null);
    await expect(server.sendToClient("id", "Method", {})).rejects.toThrow();

    // 4 args
    await expect(
      (server.sendToClient as any)("id", "1.6", "Method", {}),
    ).rejects.toThrow();
  });

  test("sendToClient forwards version to a local client's call", async () => {
    const client = {
      identity: "cp-1",
      call: vi.fn().mockResolvedValue({ ok: true }),
    } as any;
    // @ts-ignore
    server._clientsByIdentity.set("cp-1", client);

    // Versioned overload: (identity, version, method, params, options)
    await (server.sendToClient as any)(
      "cp-1",
      "ocpp1.6",
      "GetConfiguration",
      { key: ["X"] },
      { timeoutMs: 5000 },
    );

    expect(client.call).toHaveBeenCalledWith(
      "ocpp1.6",
      "GetConfiguration",
      { key: ["X"] },
      { timeoutMs: 5000 },
    );
  });

  test("sendToClient publishes version across the cluster (unicast)", async () => {
    adapter.getPresence.mockResolvedValue("remote-node");

    // Remote calls now block on a correlated response (H1); the mock adapter
    // never answers, so don't await — assert the published request instead.
    const pending = (server.sendToClient as any)("cp-remote", "ocpp2.0.1", "Reset", {
      type: "Soft",
    });
    pending.catch(() => {}); // rejected with "Server closing" on teardown

    await vi.waitFor(() => expect(adapter.publish).toHaveBeenCalled());

    expect(adapter.publish).toHaveBeenCalledWith(
      "ocpp:node:remote-node",
      expect.objectContaining({
        target: "cp-remote",
        version: "ocpp2.0.1",
        method: "Reset",
        params: { type: "Soft" },
        correlationId: expect.any(String),
      }),
    );
  });

  test("unicast handler forwards version to the target client's call", async () => {
    const client = {
      identity: "cp-2",
      call: vi.fn().mockResolvedValue(undefined),
    } as any;
    // @ts-ignore
    server._clientsByIdentity.set("cp-2", client);

    unicastHandler({
      source: "other-node",
      target: "cp-2",
      version: "ocpp2.1",
      method: "Reset",
      params: { type: "Hard" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(client.call).toHaveBeenCalledWith(
      "ocpp2.1",
      "Reset",
      { type: "Hard" },
      undefined,
    );
  });
});

describe("reconfigure applies changes (low)", () => {
  test("maxPayloadBytes rebuilds the WebSocketServer", async () => {
    const srv = new OCPPServer({ maxPayloadBytes: 65536 });
    srv.reconfigure({ maxPayloadBytes: 1024 });
    expect(((srv as any)._wss.options as any).maxPayload).toBe(1024);
    await srv.close({ force: true });
  });

  test("rateLimit.adaptive toggles the limiter", async () => {
    const srv = new OCPPServer({});
    expect((srv as any)._adaptiveLimiter).toBeNull();
    srv.reconfigure({
      rateLimit: { limit: 10, windowMs: 1000, adaptive: true },
    });
    expect((srv as any)._adaptiveLimiter).not.toBeNull();
    srv.reconfigure({ rateLimit: { limit: 10, windowMs: 1000 } });
    expect((srv as any)._adaptiveLimiter).toBeNull();
    await srv.close({ force: true });
  });
});
