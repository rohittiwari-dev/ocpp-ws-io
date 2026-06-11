import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

describe("cross-node RPC correlation (H1)", () => {
  let serverA: OCPPServer;
  let serverB: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await serverA?.close({ force: true }).catch(() => {});
    await serverB?.close({ force: true }).catch(() => {});
  });

  async function setup() {
    const adapter = new InMemoryAdapter();
    serverA = new OCPPServer({});
    await serverA.setAdapter(adapter);
    const http = await serverA.listen(0);
    const port = (http.address() as AddressInfo).port;

    serverB = new OCPPServer({});
    await serverB.setAdapter(adapter);

    client = new OCPPClient({
      identity: "CP-REMOTE",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    return adapter;
  }

  test("returns the remote client's response", async () => {
    await setup();
    client.handle("Reset", () => ({ status: "Accepted" }));
    await client.connect();

    const res = await serverB.sendToClient("CP-REMOTE", "Reset", {
      type: "Soft",
    });
    expect(res).toEqual({ status: "Accepted" });
  });

  test("propagates remote handler errors", async () => {
    await setup();
    client.handle("Reset", () => {
      throw new Error("boom");
    });
    await client.connect();

    await expect(
      serverB.sendToClient("CP-REMOTE", "Reset", { type: "Soft" }),
    ).rejects.toMatchObject({ rpcErrorCode: "InternalError" });
  });

  test("rejects fast when presence points at a node that lacks the client", async () => {
    const adapter = await setup();
    await client.connect();
    // Stale registry: identity points at a live node (A) that doesn't have it
    await adapter.setPresence("GHOST", (serverA as any)._nodeId, 60);

    await expect(
      serverB.sendToClient("GHOST", "Reset", { type: "Soft" }),
    ).rejects.toThrow(/not found/i);
  });

  test("times out when the presence node is dead", async () => {
    const adapter = await setup();
    await client.connect();
    await adapter.setPresence("DEAD", "no-such-node", 60);

    await expect(
      serverB.sendToClient(
        "DEAD",
        "Reset",
        { type: "Soft" },
        { timeoutMs: 200 },
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  }, 5000);
});
