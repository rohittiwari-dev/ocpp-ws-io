import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import http, { type Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import {
  attachOcppExpress,
  createOcppExpressContext,
  ocppMiddleware,
  type OcppExpressBinding,
} from "../src/frameworks/express/index.js";

const getPort = (server: HttpServer): number => {
  const address = server.address();
  if (address && typeof address === "object") return address.port;
  return 0;
};

const listen = (server: HttpServer): Promise<void> =>
  new Promise((resolve) => server.listen(0, resolve));

const closeHttpServer = (server?: HttpServer): Promise<void> =>
  new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
  });

describe("Express OCPP Integration", () => {
  let httpServer: HttpServer | undefined;
  let ocppServer: OCPPServer | undefined;
  let binding: OcppExpressBinding | undefined;
  let client: OCPPClient | undefined;

  afterEach(async () => {
    if (client) {
      await client.close({ force: true }).catch(() => {});
      client = undefined;
    }

    if (binding) {
      await binding.close({ force: true }).catch(() => {});
      binding = undefined;
    } else if (ocppServer) {
      await ocppServer.close({ force: true }).catch(() => {});
    }

    await closeHttpServer(httpServer);
    httpServer = undefined;
    ocppServer = undefined;
  });

  function createApp() {
    const app = express();
    app.use(express.json());

    httpServer = http.createServer(app);
    ocppServer = new OCPPServer({
      protocols: ["ocpp1.6"],
      logging: false,
    });

    const context = createOcppExpressContext(ocppServer);
    app.use(ocppMiddleware(context));

    binding = attachOcppExpress(httpServer, ocppServer, {
      upgradePathPrefix: "/ocpp",
    });

    return app;
  }

  it("serves Express HTTP routes and OCPP WebSockets on the same server", async () => {
    const app = createApp();

    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });

    await listen(httpServer!);

    const health = await fetch(`http://localhost:${getPort(httpServer!)}/health`);
    await expect(health.json()).resolves.toEqual({ ok: true });

    client = new OCPPClient({
      identity: "CP-EXPRESS",
      endpoint: `ws://localhost:${getPort(httpServer!)}/ocpp`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });

    await client.connect();
    expect(client.state).toBe(OCPPClient.OPEN);
  });

  it("injects req.ocpp for REST routes", async () => {
    const app = createApp();

    app.get("/chargers/:id", async (req, res) => {
      res.json({
        local: Boolean(req.ocpp.getClient(req.params.id)),
        global: await req.ocpp.hasClient(req.params.id),
      });
    });

    await listen(httpServer!);

    client = new OCPPClient({
      identity: "CP-REQ",
      endpoint: `ws://localhost:${getPort(httpServer!)}/ocpp`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    await client.connect();

    const response = await fetch(
      `http://localhost:${getPort(httpServer!)}/chargers/CP-REQ`,
    );

    await expect(response.json()).resolves.toEqual({
      local: true,
      global: true,
    });
  });

  it("lets REST routes call a connected charger through req.ocpp", async () => {
    const app = createApp();

    app.post("/chargers/:id/reset", async (req, res) => {
      const result = await req.ocpp.sendToClient(req.params.id, "Reset", {
        type: req.body.type,
      });
      res.json(result);
    });

    await listen(httpServer!);

    client = new OCPPClient({
      identity: "CP-CALL",
      endpoint: `ws://localhost:${getPort(httpServer!)}/ocpp`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    client.handle("Reset", ({ params }) => ({
      status: "Accepted",
      received: params,
    }));
    await client.connect();

    const response = await fetch(
      `http://localhost:${getPort(httpServer!)}/chargers/CP-CALL/reset`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "Soft" }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      status: "Accepted",
      received: { type: "Soft" },
    });
  });

  it("does not consume non-OCPP upgrade requests when a prefix is configured", async () => {
    const app = createApp();
    const otherWss = new WebSocketServer({ noServer: true });
    let otherUpgradeHandled = false;

    httpServer!.on("upgrade", (req, socket, head) => {
      if (!req.url?.startsWith("/socket.io")) return;
      otherUpgradeHandled = true;
      otherWss.handleUpgrade(req, socket, head, (ws) => {
        ws.close();
      });
    });

    await listen(httpServer!);

    const ws = new WebSocket(
      `ws://localhost:${getPort(httpServer!)}/socket.io`,
    );

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    expect(otherUpgradeHandled).toBe(true);

    ws.close();
    otherWss.close();
  });

  it("dispose removes only the OCPP upgrade listener", async () => {
    createApp();
    const before = httpServer!.listenerCount("upgrade");

    binding!.dispose();

    expect(httpServer!.listenerCount("upgrade")).toBe(before - 1);
  });

  it("close shuts down OCPP without closing the Express HTTP server by default", async () => {
    const app = createApp();

    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });

    await listen(httpServer!);

    await binding!.close({ force: true });
    binding = undefined;

    expect(httpServer!.listening).toBe(true);

    const response = await fetch(
      `http://localhost:${getPort(httpServer!)}/health`,
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
