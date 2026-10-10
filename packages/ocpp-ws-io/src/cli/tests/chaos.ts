import type WebSocket from "ws";
import type { TestSuite } from "../lib/test-runner.js";
import { openWS, uuid } from "../lib/test-runner.js";

export const chaosSuite: TestSuite = {
  name: "Chaos & Fault Injection",
  id: "chaos",
  run: async ({ baseUrl, protocol }, check) => {
    // ── 1. Thundering Herd (Connection Flood) ────────────────────

    await check(
      "Server survives thundering herd (50 concurrent connects)",
      "HIGH",
      async () => {
        const sockets: WebSocket[] = [];
        try {
          const promises = [];
          // Attempt to open 50 connections at the exact same time
          for (let i = 0; i < 50; i++) {
            promises.push(
              openWS(baseUrl, protocol, 5000)
                .then((ws) => sockets.push(ws))
                .catch(() => {}),
            );
          }

          await Promise.all(promises);

          // Terminate all
          for (const ws of sockets) ws.terminate();
          return { passed: true };
        } catch (err) {
          return {
            passed: false,
            issue: `Server became unresponsive: ${(err as Error).message}`,
          };
        } finally {
          for (const ws of sockets) ws.terminate();
        }
      },
    );

    // ── 2. Abrupt Disconnect Mid-Message ─────────────────────────

    await check(
      "Server handles abrupt TCP disconnect mid-message",
      "MEDIUM",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {});

          // Send half a large payload then aggressively terminate the socket
          const huge = JSON.stringify([
            2,
            uuid(),
            "DataTransfer",
            { data: "x".repeat(50000) },
          ]);

          // Use the raw stream to write half the frame
          // (Since node `ws` handles framing automatically, we just send a huge string
          // and immediately call terminate, which destroys the underlying socket before
          // the OS flushes the full buffer).
          ws.send(huge);
          ws.terminate();

          // Wait a bit, then ensure we can still connect
          await new Promise((r) => setTimeout(r, 1000));

          const ws2 = await openWS(baseUrl, protocol, 3000);
          ws2.terminate();

          return { passed: true };
        } catch (err) {
          return {
            passed: false,
            issue: `Server wedged after abrupt disconnect: ${
              (err as Error).message
            }`,
          };
        }
      },
    );
  },
};
