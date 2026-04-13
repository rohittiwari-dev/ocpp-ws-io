import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import {
  clearSessionCookieHeader,
  createAuthLayer,
  parseSessionCookie,
  sessionCookieHeader,
} from "./auth.js";
import { createBoardPlugin } from "./plugin.js";
import { SSEBroker } from "./sse.js";
import { CompressedMemoryStore } from "./store.js";
import type { BoardOptions, LoginCredentials } from "./types.js";

export function createBoard(options: BoardOptions) {
  const store = options.store ?? new CompressedMemoryStore();

  const auth = createAuthLayer(options.auth);
  const messageBroker = new SSEBroker(options.sseHeartbeatMs);
  const telemetryBroker = new SSEBroker(options.sseHeartbeatMs);
  const securityBroker = new SSEBroker(options.sseHeartbeatMs);

  // Start periodic telemetry broadcast
  const telemetryInterval = setInterval(async () => {
    telemetryBroker.emit("telemetry", await store.getTelemetry());
  }, 2000);

  // Create the OCPP plugin
  const plugin = createBoardPlugin(store, {
    onMessage: (msg) => {
      messageBroker.emit("message", msg);
    },
    onSecurityEvent: (evt) => {
      securityBroker.emit("security", evt);
    },
  });

  // ─── Hono App ─────────────────────────────────────────────────

  const app = new Hono();

  // ── Auth middleware ───────────────────────────────────────────

  function requireAuth(c: any, next: () => Promise<void>) {
    if (!auth.requiresAuth()) return next();
    const sessionId = parseSessionCookie(c.req.header("cookie"));
    if (!sessionId) return c.json({ error: "Unauthorized" }, 401);
    const session = auth.getSession(sessionId);
    if (!session) return c.json({ error: "Session expired" }, 401);
    c.set("user", session.user);
    return next();
  }

  // ── Auth Endpoints ───────────────────────────────────────────

  app.post("/api/auth/login", async (c) => {
    const body: LoginCredentials = await c.req.json();
    const result = await auth.authenticate(body);
    if (!result) {
      return c.json({ success: false, error: "Invalid credentials" }, 401);
    }
    const sessionId = auth.createSession(result);
    c.header("Set-Cookie", sessionCookieHeader(sessionId));
    return c.json({ success: true, user: { name: result.name } });
  });

  app.get("/api/auth/session", (c) => {
    if (!auth.requiresAuth()) {
      return c.json({
        authenticated: true,
        user: { name: "dev" },
        authMode: "disabled",
      });
    }
    const sessionId = parseSessionCookie(c.req.header("cookie"));
    if (!sessionId)
      return c.json({ authenticated: false, authMode: auth.getAuthMode() });
    const session = auth.getSession(sessionId);
    if (!session)
      return c.json({ authenticated: false, authMode: auth.getAuthMode() });
    return c.json({
      authenticated: true,
      user: session.user,
      authMode: auth.getAuthMode(),
    });
  });

  app.post("/api/auth/logout", (c) => {
    const sessionId = parseSessionCookie(c.req.header("cookie"));
    if (sessionId) auth.destroySession(sessionId);
    c.header("Set-Cookie", clearSessionCookieHeader());
    return c.json({ success: true });
  });

  // ── Protected API Endpoints ──────────────────────────────────

  app.get("/api/overview", requireAuth, async (c) => {
    return c.json(await store.getOverview());
  });

  app.get("/api/connections", requireAuth, async (c) => {
    const connections = await store.getConnections();
    return c.json(connections);
  });

  app.get("/api/connections/:identity", requireAuth, async (c) => {
    const identity = decodeURIComponent(c.req.param("identity"));
    const conn = await store.getConnection(identity);
    if (!conn) return c.json({ error: "Not found" }, 404);
    const messages = await store.getMessages({ identity, limit: 100 });
    return c.json({ ...conn, messages });
  });

  app.post("/api/connections/:identity/disconnect", requireAuth, async (c) => {
    const identity = decodeURIComponent(c.req.param("identity"));
    let disconnected = false;

    if (
      plugin.serverRef &&
      typeof plugin.serverRef.getLocalClient === "function"
    ) {
      const client = plugin.serverRef.getLocalClient(identity);
      if (client) {
        try {
          await client.close({
            code: 1000,
            reason: "Admin disconnect",
            force: true,
          });
          disconnected = true;
        } catch {
          try {
            client._ws?.terminate?.();
          } catch {}
          disconnected = true;
        }
      }
    }

    await store.removeConnection(identity, 1000, "Admin disconnect");
    return c.json({ success: true, disconnected });
  });

  app.post("/api/connections/:identity/purge", requireAuth, async (c) => {
    const identity = decodeURIComponent(c.req.param("identity"));
    let disconnected = false;

    if (
      plugin.serverRef &&
      typeof plugin.serverRef.getLocalClient === "function"
    ) {
      const client = plugin.serverRef.getLocalClient(identity);
      if (client) {
        try {
          await client.close({
            code: 1000,
            reason: "Admin purge",
            force: true,
          });
          disconnected = true;
        } catch {
          try {
            client._ws?.terminate?.();
          } catch {}
          disconnected = true;
        }
      }
    }

    await store.purgeConnection(identity);
    return c.json({ success: true, disconnected });
  });

  app.post("/api/connections/:identity/reconnect", requireAuth, async (c) => {
    const identity = decodeURIComponent(c.req.param("identity"));

    // Construct local URL based on the current request Host
    const protocol =
      c.req.header("x-forwarded-proto") === "https" ||
      c.req.url.startsWith("https")
        ? "wss"
        : "ws";
    const host = c.req.header("host") || "localhost:4200";
    const wsUrl = `${protocol}://${host}/ocpp/${encodeURIComponent(identity)}`;

    try {
      const { OCPPClient } = await import("ocpp-ws-io");
      const client = new OCPPClient({
        endpoint: wsUrl,
        identity: identity,
        protocols: ["ocpp2.0.1", "ocpp1.6"],
      });

      // Connect as a mock station
      await client.connect();

      return c.json({ success: true, connected: true });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  app.delete("/api/connections/:identity", requireAuth, async (c) => {
    const identity = decodeURIComponent(c.req.param("identity"));
    let disconnected = false;

    if (
      plugin.serverRef &&
      typeof plugin.serverRef.getLocalClient === "function"
    ) {
      const client = plugin.serverRef.getLocalClient(identity);
      if (client) {
        try {
          await client.close({
            code: 1000,
            reason: "Admin delete",
            force: true,
          });
          disconnected = true;
        } catch {
          try {
            client._ws?.terminate?.();
          } catch {}
          disconnected = true;
        }
      }
    }

    await store.purgeConnection(identity);
    return c.json({ success: true, disconnected });
  });

  app.get("/api/messages", requireAuth, async (c) => {
    const url = new URL(c.req.url);
    const messages = await store.getMessages({
      limit: Number(url.searchParams.get("limit")) || 100,
      offset: Number(url.searchParams.get("offset")) || 0,
      identity: url.searchParams.get("identity") ?? undefined,
      method: url.searchParams.get("method") ?? undefined,
      direction: url.searchParams.get("direction") ?? undefined,
    });
    return c.json(messages);
  });

  app.get("/api/messages/stream", requireAuth, (c) => {
    return streamSSE(c, messageBroker);
  });

  app.get("/api/telemetry", requireAuth, async (c) => {
    return c.json(await store.getTelemetry());
  });

  app.get("/api/telemetry/history", requireAuth, async (c) => {
    return c.json(await store.getTelemetryHistory());
  });

  app.get("/api/telemetry/stream", requireAuth, (c) => {
    return streamSSE(c, telemetryBroker);
  });

  // ── Security Events API ─────────────────────────────────────

  app.get("/api/security-events", requireAuth, async (c) => {
    const url = new URL(c.req.url);
    const events = await store.getSecurityEvents({
      limit: Number(url.searchParams.get("limit")) || 100,
      offset: Number(url.searchParams.get("offset")) || 0,
      category: url.searchParams.get("category") ?? undefined,
      identity: url.searchParams.get("identity") ?? undefined,
    });
    const totalCount = await store.getSecurityEventCount();
    return c.json({ events, totalCount });
  });

  app.get("/api/security-events/stream", requireAuth, (c) => {
    return streamSSE(c, securityBroker);
  });

  // ── Errors API ──────────────────────────────────────────────

  app.get("/api/errors", requireAuth, async (c) => {
    const url = new URL(c.req.url);
    const errors = await store.getErrors({
      limit: Number(url.searchParams.get("limit")) || 100,
      offset: Number(url.searchParams.get("offset")) || 0,
      category: url.searchParams.get("category") ?? undefined,
      identity: url.searchParams.get("identity") ?? undefined,
    });
    const totalCount = await store.getErrorCount();
    return c.json({ errors, totalCount });
  });

  // ── System Events API ───────────────────────────────────────

  app.get("/api/system-events", requireAuth, async (c) => {
    const url = new URL(c.req.url);
    const events = await store.getSystemEvents({
      limit: Number(url.searchParams.get("limit")) || 100,
      offset: Number(url.searchParams.get("offset")) || 0,
      type: url.searchParams.get("type") ?? undefined,
    });
    return c.json(events);
  });

  // ── Existing Smart Charge + Proxy ───────────────────────────

  app.get("/api/smart-charge", requireAuth, async (c) => {
    return c.json({
      connected: store.smartChargeConnected ?? false,
      sessions: store.smartChargeSessions
        ? [...store.smartChargeSessions.values()]
        : [],
      engineConfig: store.smartChargeConfig ?? {},
      dispatchErrors: store.dispatchErrors ?? [],
    });
  });

  app.get("/api/proxy", requireAuth, async (c) => {
    return c.json({
      connected: store.proxyConnected ?? false,
      events: await store.getProxyEvents(),
    });
  });

  // ── Static UI Serving ────────────────────────────────────────

  const publicDir = join(__dirname, "public");

  app.get("/*", async (c) => {
    const reqPath = c.req.path.replace(/^\//, "") || "index.html";
    const filePath = join(publicDir, reqPath);

    try {
      const s = await stat(filePath);
      if (s.isFile()) {
        const content = await readFile(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const mimeTypes: Record<string, string> = {
          html: "text/html",
          js: "application/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
          json: "application/json",
          woff2: "font/woff2",
          woff: "font/woff",
        };
        c.header("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
        return c.body(content);
      }
    } catch {
      // Fall through to SPA handler
    }

    // SPA fallback: serve index.html for all non-asset routes
    try {
      const html = await readFile(join(publicDir, "index.html"), "utf-8");
      return c.html(html);
    } catch {
      return c.text("Dashboard UI not built. Run: npm run build:ui", 404);
    }
  });

  return {
    app,
    plugin,
    store,
    messageBroker,
    telemetryBroker,
    securityBroker,
    cleanup: () => {
      clearInterval(telemetryInterval);
      messageBroker.close();
      telemetryBroker.close();
      securityBroker.close();
    },
  };
}

// ─── SSE Stream Helper ────────────────────────────────────────────

function streamSSE(_c: any, broker: SSEBroker): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          unsubscribe();
        }
      };
      const unsubscribe = broker.subscribe(send);

      // Send initial connection event
      send("event: connected\ndata: {}\n\n");
    },
    cancel() {
      // Client disconnected — cleanup handled by broker
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
