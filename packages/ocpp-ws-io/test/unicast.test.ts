import { describe, expect, test, vi, type Mock } from "vitest";
import { InMemoryAdapter } from "../src/adapters/adapter";
import { OCPPServer } from "../src/server";
import { OCPPServerClient } from "../src/server-client";
import { WebSocket } from "ws";

describe("Unicast Routing (Phase 1)", () => {
  test("Server B should route message to Client connected to Server A", async () => {
    // 1. Setup shared network
    const network = new InMemoryAdapter();

    // 2. Setup Node A
    const serverA = new OCPPServer();
    serverA.setAdapter(network);
    await serverA.listen(0);
    const portA = (
      serverA["_httpServers"].values().next().value as any
    ).address().port;

    // 3. Setup Node B
    const serverB = new OCPPServer();
    serverB.setAdapter(network); // Shares the same "Redis"
    // serverB doesn't need to listen to receive connections for this test
    // await serverB.listen(0);

    // 4. Connect Client to Node A
    const clientIdentity = "CP-Unicast-1";
    const ws = new WebSocket(`ws://localhost:${portA}/${clientIdentity}`, [
      "ocpp1.6",
    ]);

    await new Promise<void>((resolve) => {
      ws.on("open", resolve);
    });

    // Wait for presence to be set (async)
    await new Promise((r) => setTimeout(r, 100));

    // Verify Presence in Registry
    // Verify Presence in Registry
    const presenceNodeId = await network.getPresence(clientIdentity);
    console.log("Presence Node ID:", presenceNodeId);
    // @ts-ignore - access private _nodeId for testing
    expect(presenceNodeId).toBe(serverA["_nodeId"]);

    // 5. Mock Client Call on Node A
    let clientHandlerSpy = vi.fn();
    // We need to grab the server-side client instance on Node A
    const clientA = Array.from(serverA.clients).find(
      (c) => c.identity === clientIdentity,
    );
    console.log("Client A found:", !!clientA);
    expect(clientA).toBeDefined();

    // Mock the raw socket send to verify it receives traffic
    // Or better, just wait for response?
    // sendToClient calls client.call(). We can spy on client.call
    if (clientA) {
      vi.spyOn(clientA, "call").mockImplementation(async (method, params) => {
        console.log(`[MOCK] client.call called with ${method}`, params);
        return { status: "Accepted" };
      });
    }

    // 6. Node B sends to Client
    // We expect Node B to look up presence -> find Node A -> publish to Node A
    console.log("Node B sending to client...");
    await serverB.sendToClient(clientIdentity, "GetDiagnostics", {
      location: "remote",
    });
    console.log("Node B sent.");

    // 7. Verify Node A received and handled it
    // 7. Verify Node A received and handled it
    const start = Date.now();
    let called = false;
    while (Date.now() - start < 2000) {
      const mockCall = clientA?.call as unknown as Mock;
      if (mockCall && mockCall.mock && mockCall.mock.calls.length > 0) {
        called = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(called).toBe(true);
    expect(clientA?.call).toHaveBeenCalledWith("GetDiagnostics", {
      location: "remote",
    });

    console.log("Verification passed.");

    // Cleanup
    ws.terminate();
    await new Promise((r) => {
      if (ws.readyState === ws.CLOSED) r(null);
      else ws.on("close", r);
    });

    // Force close server connections
    for (const server of serverA["_httpServers"]) {
      if ("closeAllConnections" in server) {
        (server as any).closeAllConnections();
      }
    }

    await serverA.close();
    await serverB.close();
  }, 10000); // 10s timeout
});
