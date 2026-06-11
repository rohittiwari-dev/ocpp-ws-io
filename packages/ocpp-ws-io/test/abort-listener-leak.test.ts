import { getEventListeners } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

describe("abort listener cleanup (H8)", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close({ force: true }).catch(() => {});
  });

  test("listeners are removed from a shared signal when calls resolve", async () => {
    server = new OCPPServer({});
    server.on("client", (c) => c.handle("Echo", ({ params }) => params));
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    client = new OCPPClient({
      identity: "CP-ABORT",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    await client.connect();

    const ac = new AbortController();
    for (let i = 0; i < 5; i++) {
      await client.call("Echo", { i }, { signal: ac.signal });
    }
    expect(getEventListeners(ac.signal, "abort").length).toBe(0);
  });
});
