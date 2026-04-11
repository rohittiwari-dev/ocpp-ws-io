import { OCPPServer } from "ocpp-ws-io";
import { setupAuthHandler } from "./handlers/auth.js";
import { setupCoreHandlers } from "./handlers/core.js";
import { setupSmartCharging } from "./handlers/smart-charging.js";

/**
 * Initializes and configures the OCPPServer.
 * This file acts as the central hub for our WebSocket endpoints.
 */
export function createOCPPServer(): OCPPServer {
  const server = new OCPPServer({
    callTimeoutMs: 15_000,
    pingIntervalMs: 30_000,
    deferPingsOnActivity: true, // Optimizes network bridging
  });

  // 1. Setup Auth
  setupAuthHandler(server);

  // 2. Setup Message Handlers
  setupCoreHandlers(server);

  // 3. Setup Smart Charging Dynamic Engine
  setupSmartCharging(server);

  return server;
}
