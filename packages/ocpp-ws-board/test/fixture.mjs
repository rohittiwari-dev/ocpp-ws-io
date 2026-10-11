import { once } from "node:events";
import { createServer } from "node:http";
import { OCPPClient, OCPPServer } from "ocpp-ws-io";
import { expressAdapter } from "../dist/index.js";

/** Synthetic records exist only in this test fixture, never in the shipped UI. */
export async function startFixture() {
  const board = expressAdapter({
    basePath: "/ops/board",
    auth: {
      mode: "custom",
      validate: (credentials) =>
        credentials.username === "preview" && credentials.password === "preview"
          ? { name: "Synthetic preview" }
          : false,
    },
  });
  const core = new OCPPServer({
    protocols: ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"],
    logging: false,
  });
  core.plugin(board.plugin);
  const coreHttp = await core.listen(0);
  const client = new OCPPClient({
    identity: "Harbor-01",
    protocols: ["ocpp1.6"],
    endpoint: `ws://127.0.0.1:${coreHttp.address().port}`,
    logging: false,
    reconnect: false,
  });
  client.handle("TriggerMessage", () => ({ status: "Accepted" }));
  await client.connect();
  await board.plugin.flush();
  const names = [
    "Riverside-02",
    "Northgate-03",
    "Parkside-04",
    "Terminal-05",
    "Westhaven-06",
    "Meridian-07",
    "Oakfield-08",
    "Central-09",
    "Southbank-10",
    "Greenway-11",
    "Lakeside-12",
    "Station-13",
    "Station-14",
    "Station-15",
    "Station-16",
  ];
  for (const [index, identity] of names.entries())
    await board.store.addConnection({
      identity,
      remoteAddress: `10.42.0.${index + 12}`,
      protocol: ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"][index % 3],
      status: index % 5 === 0 ? "offline" : "online",
      securityProfile: index % 4,
      connectedAt: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
      sessionData: { fixture: true },
      errorCount: index % 4 === 0 ? index + 1 : 0,
    });
  for (let index = 0; index < 28; index++)
    await board.store.addMessage({
      id: `fixture-${index}`,
      identity: index % 2 ? "Harbor-01" : "Riverside-02",
      direction: index % 2 ? "OUT" : "IN",
      type: index % 7 === 0 ? "CALLERROR" : index % 2 ? "CALLRESULT" : "CALL",
      method: ["Heartbeat", "StatusNotification", "MeterValues"][index % 3],
      messageId: `exchange-${Math.floor(index / 2)}`,
      timestamp: new Date(Date.now() - index * 10000).toISOString(),
      latencyMs: index % 2 ? 24 + index : undefined,
      params: { status: "Accepted", fixture: true },
      protocol: "ocpp1.6",
      source: "ocpp-ws-io",
    });
  await board.store.addSecurityEvent({
    id: "security-fixture",
    category: "AUTH_FAILED",
    identity: "Northgate-03",
    message: "Authentication failed",
    severity: "high",
    details: { fixture: true },
    timestamp: new Date().toISOString(),
  });
  await board.store.addError({
    id: "error-fixture",
    category: "BAD_MESSAGE",
    identity: "Harbor-01",
    message: "Malformed OCPP frame",
    timestamp: new Date().toISOString(),
  });
  await board.store.addSystemEvent({
    id: "system-fixture",
    type: "BACKPRESSURE",
    identity: "Harbor-01",
    message: "Send buffer: 524288 bytes",
    details: { bufferedAmount: 524288 },
    timestamp: new Date().toISOString(),
  });
  const http = createServer((req, res) => {
    if (req.url?.startsWith("/ops/board"))
      req.url = req.url.slice("/ops/board".length) || "/";
    void board.handler(req, res);
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  return {
    url: `http://127.0.0.1:${http.address().port}/ops/board`,
    board,
    close: async () => {
      await client.close({ force: true });
      await core.close({ force: true });
      board.cleanup();
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    },
  };
}
