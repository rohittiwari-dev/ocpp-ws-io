import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { unchecked } from "ocpp-ws-io";
import type {
  BoardEnvironment,
  CommandRecord,
  CommandRequest,
} from "../types/operations.js";
import {
  clearSessionCookieHeader,
  createAuthLayer,
  parseSessionCookie,
  sessionCookieHeader,
} from "./auth.js";
import { createIntegrations } from "./integrations.js";
import { createBoardPlugin, jsonValue } from "./plugin.js";
import { SSEBroker } from "./sse.js";
import { CompressedMemoryStore } from "./store.js";
import type {
  BoardOptions,
  BoardStorageAdapter,
  JsonValue,
  LoginCredentials,
  StoreOptions,
} from "./types.js";

function isBoardStorageAdapter(
  candidate: StoreOptions | BoardStorageAdapter,
): candidate is BoardStorageAdapter {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "getMessages" in candidate &&
    typeof candidate.getMessages === "function"
  );
}

export function createBoard(options: BoardOptions) {
  const basePath =
    options.basePath && options.basePath !== "/"
      ? `/${options.basePath.split("/").filter(Boolean).join("/")}`
      : "";
  const store = !options.store
    ? new CompressedMemoryStore()
    : isBoardStorageAdapter(options.store)
      ? options.store
      : new CompressedMemoryStore(options.store);
  const auth = createAuthLayer(options.auth);
  const integrations = createIntegrations(store);
  const messageBroker = new SSEBroker(options.sseHeartbeatMs);
  const telemetryBroker = new SSEBroker(options.sseHeartbeatMs);
  const securityBroker = new SSEBroker(options.sseHeartbeatMs);
  const commands: CommandRecord[] = [];
  let sampling = false;
  const telemetryInterval = setInterval(async () => {
    if (sampling) return;
    sampling = true;
    try {
      telemetryBroker.emit("telemetry", await store.getTelemetry());
    } catch {
      telemetryBroker.emit("unavailable", {
        error: "Telemetry storage unavailable",
      });
    } finally {
      sampling = false;
    }
  }, 2000);
  telemetryInterval.unref();
  const plugin = createBoardPlugin(store, {
    onMessage: (message) => messageBroker.emit("message", message),
    onSecurityEvent: (event) => securityBroker.emit("security", event),
  });
  const app = new Hono<BoardEnvironment>();
  app.onError((error, c) =>
    c.json({ error: error.message || "Board request failed" }, 500),
  );
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("origin");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      origin &&
      origin !==
        (options.publicOrigin
          ? new URL(options.publicOrigin).origin
          : new URL(c.req.url).origin)
    ) {
      return c.json({ error: "Cross-origin mutations are not allowed" }, 403);
    }
    await next();
  });
  const requireAuth: MiddlewareHandler<BoardEnvironment> = async (c, next) => {
    if (!auth.requiresAuth()) {
      c.set("user", { name: "Local operator" });
      return next();
    }
    const id = parseSessionCookie(c.req.header("cookie"));
    const session = id ? auth.getSession(id) : undefined;
    if (!session)
      return c.json({ error: "Session expired. Sign in again." }, 401);
    c.set("user", session.user);
    await next();
  };
  app.post("/api/auth/login", async (c) => {
    let body: LoginCredentials;
    try {
      body = await c.req.json<LoginCredentials>();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      [body.token, body.username, body.password].some(
        (value) => value !== undefined && typeof value !== "string",
      )
    )
      return c.json({ error: "Invalid credentials format" }, 400);
    const user = await auth.authenticate(body);
    if (!user)
      return c.json({ success: false, error: "Invalid credentials" }, 401);
    c.header("Set-Cookie", sessionCookieHeader(auth.createSession(user)));
    return c.json({ success: true, user: { name: user.name } });
  });
  app.get("/api/auth/session", (c) => {
    if (!auth.requiresAuth())
      return c.json({
        authenticated: true,
        user: { name: "Local operator" },
        authMode: "disabled",
      });
    const id = parseSessionCookie(c.req.header("cookie"));
    const session = id ? auth.getSession(id) : undefined;
    return c.json({
      authenticated: Boolean(session),
      user: session?.user,
      authMode: auth.getAuthMode(),
    });
  });
  app.post("/api/auth/logout", (c) => {
    const id = parseSessionCookie(c.req.header("cookie"));
    if (id) auth.destroySession(id);
    c.header("Set-Cookie", clearSessionCookieHeader());
    return c.json({ success: true });
  });
  app.use("/api/*", requireAuth);
  app.get("/api/overview", async (c) => c.json(await store.getOverview()));
  app.get("/api/connections", async (c) => {
    await plugin.flush();
    return c.json(await store.getConnections());
  });
  app.get("/api/connections/:identity", async (c) => {
    const identity = c.req.param("identity");
    const connection = await store.getConnection(identity);
    if (!connection) return c.json({ error: "Station record not found" }, 404);
    return c.json({
      ...connection,
      messages: await store.getMessages({ identity, limit: 100 }),
    });
  });
  async function closeClient(identity: string, reason: string) {
    const client = plugin.serverRef?.getLocalClient(identity);
    if (!client) return false;
    await client.close({ code: 1000, reason, force: true });
    await plugin.flush();
    return true;
  }
  app.post("/api/connections/:identity/disconnect", async (c) => {
    const identity = c.req.param("identity");
    if (!(await closeClient(identity, "Board operator disconnect")))
      return c.json(
        {
          error: "No local connection. Remote-node disconnect is unavailable.",
        },
        409,
      );
    return c.json({ success: true, disconnected: true });
  });
  app.post("/api/connections/:identity/reconnect", (c) =>
    c.json(
      {
        success: false,
        error:
          "A physical station must reconnect itself. The board does not impersonate stations. Use Reset on an online station if supported.",
      },
      409,
    ),
  );
  const purge: MiddlewareHandler<BoardEnvironment> = async (c) => {
    const identity = c.req.param("identity") ?? "";
    if (!(await store.getConnection(identity)))
      return c.json({ error: "Station record not found" }, 404);
    const disconnected = await closeClient(identity, "Board operator purge");
    const record = await store.getConnection(identity);
    if (!disconnected && record?.status === "online")
      return c.json(
        {
          error:
            "Disconnect the station on its owning node before removing its record.",
        },
        409,
      );
    await store.purgeConnection(identity);
    return c.json({ success: true, disconnected });
  };
  app.post("/api/connections/:identity/purge", purge);
  app.delete("/api/connections/:identity", purge);
  app.get("/api/messages", async (c) =>
    c.json(
      await store.getMessages({
        limit: bounded(c.req.query("limit"), 100, 1000),
        offset: bounded(c.req.query("offset"), 0, 1_000_000),
        identity: c.req.query("identity"),
        method: c.req.query("method"),
        direction: c.req.query("direction"),
      }),
    ),
  );
  app.get("/api/messages/stream", () => streamSSE(messageBroker));
  app.get("/api/telemetry", async (c) => c.json(await store.getTelemetry()));
  app.get("/api/telemetry/history", async (c) =>
    c.json(await store.getTelemetryHistory()),
  );
  app.get("/api/telemetry/stream", () => streamSSE(telemetryBroker));
  app.get("/api/security-events", async (c) =>
    c.json({
      events: await store.getSecurityEvents({
        limit: bounded(c.req.query("limit"), 100, 1000),
        offset: bounded(c.req.query("offset"), 0, 1_000_000),
        category: c.req.query("category"),
        identity: c.req.query("identity"),
      }),
      totalCount: await store.getSecurityEventCount(),
    }),
  );
  app.get("/api/security-events/stream", () => streamSSE(securityBroker));
  app.get("/api/errors", async (c) =>
    c.json({
      errors: await store.getErrors({
        limit: bounded(c.req.query("limit"), 100, 1000),
        offset: bounded(c.req.query("offset"), 0, 1_000_000),
        category: c.req.query("category"),
        identity: c.req.query("identity"),
      }),
      totalCount: await store.getErrorCount(),
    }),
  );
  app.get("/api/system-events", async (c) =>
    c.json(
      await store.getSystemEvents({
        limit: bounded(c.req.query("limit"), 100, 1000),
        offset: bounded(c.req.query("offset"), 0, 1_000_000),
        type: c.req.query("type"),
      }),
    ),
  );
  app.get("/api/smart-charge", (c) =>
    c.json({
      connected: store.smartChargeConnected ?? false,
      sessions: store.smartChargeSessions
        ? [...store.smartChargeSessions.values()]
        : [],
      engineConfig: store.smartChargeConfig ?? {},
      dispatchErrors: store.dispatchErrors ?? [],
    }),
  );
  app.get("/api/proxy", async (c) => {
    const events = await store.getProxyEvents();
    return c.json({
      connected: store.proxyConnected ?? false,
      events,
      totalTranslations: events.length,
      translationErrors: events.filter((event) => event.error).length,
    });
  });
  app.get("/api/server", async (c) => {
    const server = plugin.serverRef;
    return c.json({
      attached: Boolean(server),
      state: server?.state ?? "DETACHED",
      stats: server?.stats() ?? null,
      adapterMetrics: server ? jsonValue(await server.adapterMetrics()) : null,
      protocols: [
        ...new Set(
          [...(server?.clients ?? [])]
            .map((client) => client.protocol)
            .filter(Boolean),
        ),
      ],
      commandsEnabled: options.commandsEnabled !== false && Boolean(server),
    });
  });
  app.get("/api/commands", (c) => c.json(commands));
  app.post("/api/commands", async (c) => {
    if (options.commandsEnabled === false)
      return c.json({ error: "Commands are disabled for this board" }, 403);
    const server = plugin.serverRef;
    if (!server)
      return c.json({ error: "Board plugin is not attached to a server" }, 503);
    let body: JsonValue;
    try {
      body = await c.req.json<JsonValue>();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.identity !== "string" ||
      !body.identity.trim() ||
      typeof body.method !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(body.method) ||
      !body.params ||
      typeof body.params !== "object" ||
      Array.isArray(body.params) ||
      typeof body.protocol !== "string" ||
      typeof body.timeoutMs !== "number" ||
      !Number.isInteger(body.timeoutMs) ||
      body.timeoutMs < 1000 ||
      body.timeoutMs > 120000
    )
      return c.json(
        {
          error:
            "Provide a station, action, protocol, JSON object and timeout from 1000 to 120000 ms",
        },
        400,
      );
    const client = server.getLocalClient(body.identity);
    if (!client)
      return c.json({ error: "Station is not connected on this node" }, 409);
    if (client.protocol !== body.protocol)
      return c.json(
        { error: "Station protocol changed. Refresh before sending." },
        409,
      );
    if (commands.filter((command) => command.status === "pending").length >= 20)
      return c.json(
        { error: "Too many pending commands. Wait for a response." },
        429,
      );
    const request: CommandRequest = {
      identity: body.identity,
      method: body.method,
      protocol: body.protocol,
      timeoutMs: body.timeoutMs,
      params: body.params,
    };
    const record: CommandRecord = {
      ...request,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      status: "pending",
      operator: c.get("user").name,
    };
    commands.unshift(record);
    if (commands.length > 200) {
      const index = commands
        .map((entry) => entry.status !== "pending")
        .lastIndexOf(true);
      if (index >= 0) commands.splice(index, 1);
    }
    const start = Date.now();
    try {
      record.result = jsonValue(
        await server.sendToClient(
          request.identity,
          unchecked(request.method),
          request.params,
          { timeoutMs: request.timeoutMs },
        ),
      );
      record.status = "succeeded";
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : "Command failed";
    }
    record.durationMs = Date.now() - start;
    return c.json(record);
  });
  app.all("/api/*", (c) => c.json({ error: "API route not found" }, 404));
  const publicDir = resolve(__dirname, "public");
  app.get("/*", async (c) => {
    const filePath = resolve(
      publicDir,
      (basePath && c.req.path.startsWith(`${basePath}/`)
        ? c.req.path.slice(basePath.length)
        : c.req.path
      ).replace(/^\//, "") || "index.html",
    );
    if (!filePath.startsWith(publicDir + sep)) return c.text("Not found", 404);
    const mime: Record<string, string> = {
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
    try {
      if ((await stat(filePath)).isFile() && !filePath.endsWith("index.html")) {
        c.header(
          "Content-Type",
          mime[filePath.split(".").pop() ?? ""] ?? "application/octet-stream",
        );
        return c.body(await readFile(filePath));
      }
    } catch {
      /* SPA routes are handled below. */
    }
    if (/\.(js|css|woff2?|png|svg|ico)$/.test(c.req.path))
      return c.text("Asset not found", 404);
    try {
      const html = await readFile(join(publicDir, "index.html"), "utf-8");
      const safeBase = basePath
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;");
      return c.html(
        html.replace(
          "<head>",
          `<head><base href="${safeBase}/"><meta name="ocpp-board-base" content="${safeBase}">`,
        ),
      );
    } catch {
      return c.text(
        "Board UI not built. Run npm run build:ui in ocpp-ws-board.",
        404,
      );
    }
  });
  return {
    app,
    plugin,
    store,
    messageBroker,
    telemetryBroker,
    securityBroker,
    connectSmartCharge: integrations.connectSmartCharge,
    connectProxy: integrations.connectProxy,
    proxyMiddleware: integrations.proxyMiddleware,
    cleanup: () => {
      integrations.cleanup();
      auth.cleanup();
      clearInterval(telemetryInterval);
      messageBroker.close();
      telemetryBroker.close();
      securityBroker.close();
    },
  };
}
function bounded(value: string | undefined, fallback: number, max: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(max, Math.floor(parsed)))
    : fallback;
}
function streamSSE(broker: SSEBroker): Response {
  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      unsubscribe = broker.subscribe((data) => {
        if ((controller.desiredSize ?? 0) < -100) {
          unsubscribe();
          controller.close();
          return;
        }
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          unsubscribe();
        }
      });
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
