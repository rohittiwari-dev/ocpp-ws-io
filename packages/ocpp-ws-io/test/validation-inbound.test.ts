import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";
import { MessageType } from "../src/types.js";

const getPort = (srv: import("node:http").Server): number => {
  const addr = srv.address();
  if (addr && typeof addr !== "string") return addr.port;
  return 0;
};

describe("Inbound Validation (Strict Mode)", () => {
  let server: OCPPServer;
  let client: OCPPClient;
  let port: number;

  beforeEach(async () => {
    server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.auth((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const httpServer = await server.listen(0);
    port = getPort(httpServer);
  });

  afterEach(async () => {
    if (client) await client.close({ force: true }).catch(() => {});
    await server.close({ force: true }).catch(() => {});
  });

  it("should accept valid payload in strict mode", async () => {
    client = new OCPPClient({
      identity: "CS_VALID",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      strictMode: true, // Enable inbound validation
    });

    const handler = vi.fn().mockResolvedValue({});
    client.handle("RemoteStartTransaction", handler);

    const clientConnectPromise = new Promise<void>((resolve) => {
      server.on("client", (sc) => {
        // Send valid call
        sc.call("RemoteStartTransaction", {
          idTag: "TAG1",
          connectorId: 1,
        }).catch(() => {});
        resolve();
      });
    });

    await client.connect();
    await clientConnectPromise;

    // Wait for client to process
    await new Promise((r) => setTimeout(r, 10));

    expect(handler).toHaveBeenCalled();
  });

  it("should reject invalid payload in strict mode", async () => {
    let validationFailure: any = null;

    client = new OCPPClient({
      identity: "CS_INVALID",
      endpoint: `ws://localhost:${port}`,
      protocols: ["ocpp1.6"],
      strictMode: true,
    });

    client.on("strictValidationFailure", (details) => {
      validationFailure = details;
    });

    const handler = vi.fn().mockResolvedValue({});
    client.handle("RemoteStartTransaction", handler);

    let serverClient: any;
    const responsePromise = new Promise<any>((resolve) => {
      server.on("client", (sc) => {
        serverClient = sc;
        sc.call("RemoteStartTransaction", { connectorId: 1 })
          .then(() => resolve("success"))
          .catch((err) => resolve(err));
      });
    });

    await client.connect();

    // Wait for response
    const result = await responsePromise;

    expect(handler).not.toHaveBeenCalled();
    expect(validationFailure).not.toBeNull();
    // Server should have received an error response
    expect(result).toBeInstanceOf(Error);
  });
});
