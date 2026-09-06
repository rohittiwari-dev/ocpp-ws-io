import { afterEach, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import { OCPPServer } from "../src/server.js";
import { OCPPClient } from "../src/client.js";

// _cleanup() never touched _offlineQueue or _outboundBuffer:
//
// - offline-queue entries hold the caller's resolve/reject, so a terminal close
//   stranded those promises forever. They never resolve, never reject and never
//   time out, because the call timeout is only armed once a call is sent.
// - buffered frames survived into the next connect() and were replayed stale,
//   and nothing bounded the array during a long disconnect.

describe("client close settles queued work", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  });

  function makeClient(port: number) {
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP001",
      protocols: ["ocpp1.6"],
      reconnect: false,
      offlineQueue: true,
    });
    clients.push(client);
    return client;
  }

  test("close() rejects offline-queued calls instead of stranding them", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const client = makeClient(port);
    // Never connected, so the call lands in the offline queue.
    const pending = client.call("Heartbeat", {});
    const settled = pending.then(
      () => "resolved",
      () => "rejected",
    );

    await client.close();

    const outcome = await Promise.race([
      settled,
      new Promise((r) => setTimeout(() => r("stranded"), 1000)),
    ]);
    expect(outcome).toBe("rejected");
  });

  test("close() clears the outbound buffer so nothing replays on reconnect", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    servers.push(server);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const client = makeClient(port);
    await client.connect();

    const buffer = (client as unknown as { _outboundBuffer: string[] })
      ._outboundBuffer;
    buffer.push('[2,"stale","Heartbeat",{}]');

    await client.close();
    expect(buffer.length).toBe(0);
  });

  test("the outbound buffer is bounded while CONNECTING", async () => {
    const client = new OCPPClient({
      endpoint: "ws://127.0.0.1:1",
      identity: "CP001",
      protocols: ["ocpp1.6"],
      reconnect: false,
    });
    clients.push(client);

    const internals = client as unknown as {
      _state: number;
      _outboundBuffer: string[];
      _bufferOutbound(m: string): void;
    };
    for (let i = 0; i < 1500; i++) internals._bufferOutbound(`frame-${i}`);

    expect(internals._outboundBuffer.length).toBe(1000);
    // Oldest dropped, newest kept.
    expect(internals._outboundBuffer.at(-1)).toBe("frame-1499");
    expect(internals._outboundBuffer[0]).toBe("frame-500");
  });
});
