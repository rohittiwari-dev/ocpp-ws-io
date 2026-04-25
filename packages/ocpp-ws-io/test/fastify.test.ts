import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { OCPPServer } from "../src/server.js";
import { ocppFastifyPlugin } from "../src/frameworks/fastify/index.js";
import http from "node:http";

describe("Fastify Integration", () => {
  let fastify: ReturnType<typeof Fastify>;
  let ocppServer: OCPPServer;

  beforeEach(() => {
    fastify = Fastify();
    ocppServer = new OCPPServer({ protocols: ["ocpp1.6"] });
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should decorate request with ocpp context", async () => {
    await fastify.register(ocppFastifyPlugin, { ocppServer });

    fastify.get("/test", async (request: any) => {
      expect(request.ocpp).toBeDefined();
      expect(request.ocpp.server).toBe(ocppServer);
      return { success: true };
    });

    const response = await fastify.inject({
      method: "GET",
      url: "/test",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
  });

  it("should handle upgrade requests automatically", async () => {
    const handleUpgradeSpy = vi.spyOn(ocppServer, "handleUpgrade").mockImplementation(async () => {});
    await fastify.register(ocppFastifyPlugin, { ocppServer, upgradePathPrefix: "/ocpp" });

    // We must start listening to get the real HTTP server
    await fastify.ready();

    // Simulate an upgrade request
    const req = {
      headers: { upgrade: "websocket", host: "localhost" },
      url: "/ocpp/charger1",
    } as unknown as http.IncomingMessage;

    const socket = {} as any;
    const head = Buffer.from("");

    fastify.server.emit("upgrade", req, socket, head);

    expect(handleUpgradeSpy).toHaveBeenCalledWith(req, socket, head);
  });

  it("should not handle upgrade requests for non-matching paths", async () => {
    const handleUpgradeSpy = vi.spyOn(ocppServer, "handleUpgrade").mockImplementation(async () => {});
    await fastify.register(ocppFastifyPlugin, { ocppServer, upgradePathPrefix: "/ocpp" });

    await fastify.ready();

    const req = {
      headers: { upgrade: "websocket", host: "localhost" },
      url: "/other/path",
    } as unknown as http.IncomingMessage;

    fastify.server.emit("upgrade", req, {} as any, Buffer.from(""));

    expect(handleUpgradeSpy).not.toHaveBeenCalled();
  });
});
