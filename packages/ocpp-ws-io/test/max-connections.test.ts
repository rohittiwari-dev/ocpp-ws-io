import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

describe("maxConnections (M12)", () => {
  let server: OCPPServer;
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients) await c.close({ force: true }).catch(() => {});
    clients.length = 0;
    await server?.close({ force: true }).catch(() => {});
  });

  test("rejects the upgrade with 503 once the cap is reached", async () => {
    server = new OCPPServer({ maxConnections: 1 });
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const c1 = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    clients.push(c1);
    await c1.connect();

    const c2 = new OCPPClient({
      identity: "CP-2",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    clients.push(c2);
    await expect(c2.connect()).rejects.toMatchObject({ statusCode: 503 });
  });
});
