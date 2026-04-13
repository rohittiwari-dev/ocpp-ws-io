import { createRouter, OCPPServer } from "ocpp-ws-io";

/// handler route

export const handlerRouteServer = async () => {
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });

  const v2Router = server.route("/api/v2/chargers/*");
  // Directly handle BootNotifications for ANY station connecting to /api/v2
  v2Router.handle("ocpp2.0.1", "BootNotification", async (ctx) => {
    console.log(`Booting station: ${ctx.client.identity}`);
    return {
      currentTime: new Date().toISOString(),
      interval: 300,
      status: "Accepted",
    };
  });
  // Directly handle incoming Heartbeats
  v2Router.handle("Heartbeat", () => ({
    currentTime: new Date().toISOString(),
  }));

  await server.listen(3000);
};

export const RouterLevelMiddleware = async () => {
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  const adminRouter = server
    .use(async (ctx) => {
      console.log(`[Admin Access Attempt] Identity: ${ctx.handshake.identity}`);
      if (ctx.handshake.identity.startsWith("SYS-")) {
        await ctx.next();
      } else {
        throw new Error("Unauthorized identity for admin endpoint");
      }
    })
    .route("/api/admin/*");
  adminRouter.on("client", (client) => {
    // Only SYS-* prefixed stations reach here
    client.handle("TriggerMessage", () => ({ status: "Accepted" }));
  });
  await server.listen(3000);
};

export const PathSpecificAuthentication = async () => {
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  // Allow Basic Auth for legacy route
  const legacyRouter = server
    .auth(async (ctx) => {
      if (ctx.handshake.headers.authorization) {
        ctx.accept({ session: { version: "v1" } });
      } else {
        ctx.reject(401, "Basic Auth Required");
      }
    })
    .route("/api/v1/*");

  // Enforce mTLS for modern route
  const modernRouter = server
    .auth(async (ctx) => {
      if (ctx.handshake.identity) {
        ctx.accept({ session: { version: "v2" } });
      } else {
        ctx.reject(403, "TLS Certificate Required");
      }
    })
    .route("/api/v2/*");

  legacyRouter.handle("ocpp1.6", "BootNotification", async (ctx) => {
    console.log(`Booting station: ${ctx.client.identity}`);
    return {
      currentTime: new Date().toISOString(),
      interval: 300,
      status: "Accepted",
    };
  });
  modernRouter.handle("ocpp2.0.1", "BootNotification", async (ctx) => {
    console.log(`Booting station: ${ctx.client.identity}`);
    return {
      currentTime: new Date().toISOString(),
      interval: 300,
      status: "Accepted",
    };
  });
  await server.listen(3000);
};

export const RouterLevelCors = async () => {
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  // 1. Lock down the Admin router to internal networks
  const adminRouter = server
    .cors({
      allowedIPs: ["10.0.0.0/8", "192.168.1.50"],
    })
    .route("/api/admin/*");

  // 2. Lock down a dashboard WebSocket to a specific web domain
  const dashboardRouter = server
    .cors({
      allowedOrigins: ["https://dashboard.example.com"],
    })
    .route("/api/dashboard");

  adminRouter.on("client", (client) => {
    // Only SYS-* prefixed stations reach here
    client.handle("TriggerMessage", () => ({ status: "Accepted" }));
  });

  dashboardRouter.on("client", (client) => {
    // Only SYS-* prefixed stations reach here
    client.handle("TriggerMessage", () => ({ status: "Accepted" }));
  });

  await server.listen(3000);
};

export const modularRouting = () => {
  // Create a standalone router independent of the server
  const adminRouter = createRouter("/api/admin/*");

  adminRouter.auth(async (ctx) => {
    if (ctx.handshake.headers.authorization !== "Bearer my-secret") {
      ctx.reject(401, "Unauthorized");
      return;
    }
    ctx.accept({ session: { role: "admin" } });
  });

  adminRouter.handle("BootNotification", () => ({
    status: "Accepted",
    interval: 10,
    currentTime: new Date().toISOString(),
  }));

  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  // Attach the externally defined router back to the main server!
  server.attachRouters(adminRouter);
  server.listen(3000);
};

export const catchAllFallbacks = async () => {
  const server = new OCPPServer({
    protocols: ["ocpp1.6"],
    logging: {
      enabled: true,
      prettify: true,
      prettifyMetadata: true,
      prettifySource: true,
    },
  });
  // Specific route
  server
    .route("/api/chargers")
    .auth(async (ctx) => {
      ctx.accept({ session: { role: "charger" } });
    })
    .on("client", (client) => {
      client.handle("BootNotification", () => ({
        status: "Accepted",
        currentTime: new Date().toISOString(),
      }));
    });

  // Catch-all (matches anything that didn't match above)
  const wildcardRouter = server.use(async (ctx) => {
    console.log(`[Catch-all] ${ctx.handshake.identity}`);
    ctx.next({
      chargePointID: "catch-all",
    });
  });

  wildcardRouter
    .auth((ctx) => ctx.accept({ session: { role: "charger" } }))
    .on("client", (client) => {
      console.log("[Catch-all] TriggerMessage", client.session);
      client.handle("TriggerMessage", () => ({ status: "Accepted" }));
    });

  server.listen(3000);
};
