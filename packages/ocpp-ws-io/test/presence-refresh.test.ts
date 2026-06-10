import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

class SpyAdapter extends InMemoryAdapter {
  setPresenceBatch = vi.fn(async () => {});
}

describe("presence heartbeat (C3)", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close({ force: true }).catch(() => {});
  });

  test("refreshes presence TTL periodically for connected clients", async () => {
    const adapter = new SpyAdapter();
    server = new OCPPServer({ presenceTtlSeconds: 1 }); // refresh every ~500ms
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    client = new OCPPClient({
      identity: "CP-PRESENCE",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    await client.connect();

    await new Promise((r) => setTimeout(r, 1300));

    expect(adapter.setPresenceBatch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = adapter.setPresenceBatch.mock.calls.at(-1)![0] as Array<{
      identity: string;
      ttl?: number;
    }>;
    expect(lastCall[0].identity).toBe("CP-PRESENCE");
    expect(lastCall[0].ttl).toBe(1);
  });
});
