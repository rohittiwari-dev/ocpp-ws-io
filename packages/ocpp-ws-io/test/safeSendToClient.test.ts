import { describe, test, expect, vi } from "vitest";
import { OCPPServer } from "../src/server";

class TestServer extends OCPPServer {
  constructor() {
    super({});
  }
}

describe("OCPPServer safeSendToClient", () => {
  test("returns undefined when client not found (instead of throwing)", async () => {
    const server = new TestServer();

    // Mock logger
    const warnSpy = vi.fn();
    // @ts-ignore
    server._logger = {
      warn: warnSpy,
      debug: () => {},
      info: () => {},
      error: () => {},
      child: () => ({ warn: warnSpy } as any),
    };

    // sendToClient throws if client not found
    // safeSendToClient should return undefined
    const result = await server.safeSendToClient(
      "non-existent-client",
      "Heartbeat",
      {},
    );

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "SafeSendToClient failed",
      expect.objectContaining({
        identity: "non-existent-client",
        error: expect.any(Error),
      }),
    );
  });
});
