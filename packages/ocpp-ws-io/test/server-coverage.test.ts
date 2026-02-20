import { describe, test, expect, vi, beforeEach } from "vitest";
import { OCPPServer } from "../src/server";
import { OCPPServerClient } from "../src/server-client";

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
    // @ts-ignore
    server._clients.add(client);

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
});
