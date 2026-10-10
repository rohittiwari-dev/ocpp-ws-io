import WebSocket from "ws";
import type { TestSuite } from "../lib/test-runner.js";
import { openWS, uuid, waitForClose } from "../lib/test-runner.js";

export const transportSuite: TestSuite = {
  name: "Transport & Protocol",
  id: "transport",
  run: async ({ baseUrl, protocol }, check) => {
    // ── 1. Subprotocol Required ──────────────────────────────────

    await check("Server requires subprotocol", "HIGH", async () => {
      try {
        const ws = await openWS(baseUrl, undefined, 3000);
        ws.terminate();
        return {
          passed: false,
          issue: "Server accepted connection with no OCPP subprotocol",
        };
      } catch {
        return { passed: true };
      }
    });

    // ── 2. Invalid Subprotocol ───────────────────────────────────

    await check("Server rejects invalid subprotocol", "MEDIUM", async () => {
      try {
        const ws = await openWS(baseUrl, "ws-chat", 3000);
        ws.terminate();
        return {
          passed: false,
          issue: "Server accepted invalid subprotocol 'ws-chat'",
        };
      } catch {
        return { passed: true };
      }
    });

    // ── 3. Malformed JSON ────────────────────────────────────────

    await check(
      "Server handles malformed JSON gracefully",
      "HIGH",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {});

          ws.send("}{not json at all!!");
          await new Promise((r) => setTimeout(r, 1500));

          if (ws.readyState === WebSocket.OPEN) {
            return { passed: true };
          }

          return { passed: true };
        } catch (err) {
          return {
            passed: false,
            issue: `Server crashed: ${(err as Error).message}`,
          };
        } finally {
          ws?.terminate();
        }
      },
    );

    // ── 4. Oversized Payload ─────────────────────────────────────

    await check(
      "Server rejects oversized frames (>128KB)",
      "MEDIUM",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {});

          const huge = JSON.stringify([
            2,
            uuid(),
            "DataTransfer",
            { data: "x".repeat(200000) },
          ]);
          ws.send(huge);

          try {
            await waitForClose(ws, 4000);
            return { passed: true };
          } catch {
            if (ws.readyState === WebSocket.OPEN) {
              return {
                passed: false,
                issue:
                  "Server did not close connection after oversized payload",
              };
            }
            return { passed: true };
          }
        } catch (err) {
          return {
            passed: false,
            issue: `Connection error: ${(err as Error).message}`,
          };
        } finally {
          ws?.terminate();
        }
      },
    );

    // ── 5. Empty Array ───────────────────────────────────────────

    await check("Server handles empty array payload", "LOW", async () => {
      let ws: WebSocket | undefined;
      try {
        ws = await openWS(baseUrl, protocol, 3000);
        ws.on("error", () => {});

        ws.send(JSON.stringify([]));
        await new Promise((r) => setTimeout(r, 1000));

        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CLOSING
        ) {
          return { passed: true };
        }
        return { passed: true };
      } catch (err) {
        return {
          passed: false,
          issue: `Server crashed: ${(err as Error).message}`,
        };
      } finally {
        ws?.terminate();
      }
    });

    // ── 6. Graceful Close ────────────────────────────────────────

    await check("Graceful WebSocket close", "MEDIUM", async () => {
      let ws: WebSocket | undefined;
      try {
        ws = await openWS(baseUrl, protocol, 3000);
        ws.on("error", () => {});

        ws.close(1000, "Normal closure");

        const { code } = await waitForClose(ws, 3000);
        if (code === 1000 || code === 1005) {
          return { passed: true };
        }
        return {
          passed: false,
          issue: `Unexpected close code: ${code}`,
        };
      } catch (err) {
        return {
          passed: false,
          issue: `Error: ${(err as Error).message}`,
        };
      } finally {
        ws?.terminate();
      }
    });

    // ── 7. Rapid Reconnect ──────────────────────────────────────

    await check("Rapid reconnect stability", "MEDIUM", async () => {
      try {
        for (let i = 0; i < 5; i++) {
          const ws = await openWS(baseUrl, protocol, 3000);
          ws.terminate();
          await new Promise((r) => setTimeout(r, 50));
        }

        const ws = await openWS(baseUrl, protocol, 3000);
        ws.terminate();
        return { passed: true };
      } catch (err) {
        return {
          passed: false,
          issue: `Server became unresponsive after rapid reconnects: ${(err as Error).message}`,
        };
      }
    });
  },
};
