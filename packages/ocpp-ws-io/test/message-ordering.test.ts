import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

describe("inbound message ordering (H6)", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close({ force: true }).catch(() => {});
  });

  test("a slow async onBeforeReceive does not reorder messages", async () => {
    const received: string[] = [];
    let delayed = false;

    server = new OCPPServer({});
    server.plugin({
      name: "slow-first",
      async onBeforeReceive() {
        if (!delayed) {
          delayed = true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return undefined;
      },
    });
    server.on("client", (c) =>
      c.handle((method) => {
        received.push(method);
        return {};
      }),
    );

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;
    client = new OCPPClient({
      identity: "CP-ORDER",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    await client.connect();

    client.sendRaw(JSON.stringify([2, "m1", "First", {}]));
    client.sendRaw(JSON.stringify([2, "m2", "Second", {}]));

    await new Promise((r) => setTimeout(r, 400));
    expect(received).toEqual(["First", "Second"]);
  });
});
