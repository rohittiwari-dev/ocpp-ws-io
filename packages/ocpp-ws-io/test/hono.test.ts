import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { OCPPServer } from "../src/server.js";
import { ocppMiddleware, attachOcppHonoNode } from "../src/frameworks/hono/index.js";
import http from "node:http";

describe("Hono Integration", () => {
  let app: Hono;
  let ocppServer: OCPPServer;

  beforeEach(() => {
    app = new Hono();
    ocppServer = new OCPPServer({ protocols: ["ocpp1.6"] });
  });

  afterEach(async () => {
    await ocppServer.close();
  });

  it("should inject ocpp context into Hono context", async () => {
    app.use("*", ocppMiddleware(ocppServer));

    app.get("/test", (c) => {
      const ocpp = c.get("ocpp");
      expect(ocpp).toBeDefined();
      expect(ocpp.server).toBe(ocppServer);
      return c.json({ success: true });
    });

    const req = new Request("http://localhost/test");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });

  describe("Node Server Upgrade Handling", () => {
    let httpServer: http.Server;
    
    beforeEach(() => {
      httpServer = serve({
        fetch: app.fetch,
        port: 0,
      }) as unknown as http.Server;
    });

    afterEach(() => {
      httpServer.close();
    });

    it("should handle upgrade requests automatically via attachOcppHonoNode", () => {
      const handleUpgradeSpy = vi.spyOn(ocppServer, "handleUpgrade").mockImplementation(async () => {});
      
      const binding = attachOcppHonoNode(httpServer, ocppServer, { upgradePathPrefix: "/ocpp" });

      const req = {
        headers: { upgrade: "websocket", host: "localhost" },
        url: "/ocpp/charger1",
      } as unknown as http.IncomingMessage;

      const socket = {} as any;
      const head = Buffer.from("");

      httpServer.emit("upgrade", req, socket, head);

      expect(handleUpgradeSpy).toHaveBeenCalledWith(req, socket, head);
      
      binding.dispose();
    });

    it("should not handle upgrade requests for non-matching paths", () => {
      const handleUpgradeSpy = vi.spyOn(ocppServer, "handleUpgrade").mockImplementation(async () => {});
      
      const binding = attachOcppHonoNode(httpServer, ocppServer, { upgradePathPrefix: "/ocpp" });

      const req = {
        headers: { upgrade: "websocket", host: "localhost" },
        url: "/other/path",
      } as unknown as http.IncomingMessage;

      httpServer.emit("upgrade", req, {} as any, Buffer.from(""));

      expect(handleUpgradeSpy).not.toHaveBeenCalled();
      
      binding.dispose();
    });
  });
});
