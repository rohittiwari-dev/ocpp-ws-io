import type { OCPPServer } from "ocpp-ws-io";

/**
 * Configures connection validation and Authentication.
 */
export function setupAuthHandler(server: OCPPServer) {
  server.auth((ctx) => {
    console.log(`[AUTH] Incoming connection from: ${ctx.handshake.identity}`);

    // Example: Block stations that aren't registered
    if (!ctx.handshake.identity.startsWith("EVSE-")) {
      console.warn(
        `[AUTH] Rejecting invalid station ID: ${ctx.handshake.identity}`,
      );
      return ctx.reject(401, "Station ID must start with EVSE-");
    }

    // Attach custom session data for handlers to use later
    return ctx.accept({
      session: {
        role: "charging-station",
        connectedAt: Date.now(),
      },
    });
  });
}
