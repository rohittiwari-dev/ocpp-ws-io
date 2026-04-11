import type { IncomingMessage, ServerResponse } from "node:http";
import type { OCPPServer } from "ocpp-ws-io";

/**
 * Handles traditional HTTP REST calls natively, without relying on Honso or Express.
 */
export async function handleRestApi(
  req: IncomingMessage,
  res: ServerResponse,
  ocppServer: OCPPServer,
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // Endpoint: GET /api/stations
  if (req.method === "GET" && url.pathname === "/api/stations") {
    res.writeHead(200, { "Content-Type": "application/json" });
    const clients = Array.from(ocppServer.clients).map((c) => ({
      identity: c.identity,
      ip: c.session?.ipAddress || "Unknown",
      connectedAt: c.session?.connectedAt || Date.now(),
    }));
    res.end(JSON.stringify(clients));
    return true; // Handled
  }

  // Endpoint: POST /api/stations/:id/trigger
  if (
    req.method === "POST" &&
    url.pathname.startsWith("/api/stations/") &&
    url.pathname.endsWith("/trigger")
  ) {
    const parts = url.pathname.split("/");
    const targetIdentity = parts[3]; // /api/stations/[targetIdentity]/trigger

    const client = Array.from(ocppServer.clients).find(
      (c) => c.identity === targetIdentity,
    );
    if (!client) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Station not connected" }));
      return true;
    }

    try {
      // Trigger a remote action: requesting the station to send a BootNotification
      const response = await client.call("TriggerMessage", {
        requestedMessage: "BootNotification",
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, response }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Trigger failed", details: String(err) }),
      );
    }
    return true; // Handled
  }

  return false; // Not handled
}
