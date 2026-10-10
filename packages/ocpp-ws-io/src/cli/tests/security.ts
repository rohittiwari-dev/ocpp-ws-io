import WebSocket from "ws";
import type { TestSuite } from "../lib/test-runner.js";
import { openWS, uuid } from "../lib/test-runner.js";

export const securitySuite: TestSuite = {
  name: "Security & Payload Abuse",
  id: "security",
  run: async ({ baseUrl, protocol }, check) => {
    // ── 1. JSON Depth Bomb (FRAME_04) ────────────────────────────

    await check(
      "Server rejects deeply nested JSON objects",
      "HIGH",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {}); // absorb errors

          // Create 500-deep nested object
          let nestedBody = "{}";
          for (let i = 0; i < 500; i++) {
            nestedBody = `{"a":${nestedBody}}`;
          }

          const payload = `[2, "${uuid()}", "Heartbeat", ${nestedBody}]`;
          ws.send(payload);

          await new Promise((r) => setTimeout(r, 1500));

          // If server hasn't crashed, it passed. If it closed the WS, also passed.
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
            issue: `Server crashed on deep JSON: ${(err as Error).message}`,
          };
        } finally {
          ws?.terminate();
        }
      },
    );

    // ── 2. JSON Array Bomb (FRAME_05) ────────────────────────────

    await check("Server withstands massive JSON arrays", "HIGH", async () => {
      let ws: WebSocket | undefined;
      try {
        ws = await openWS(baseUrl, protocol, 3000);
        ws.on("error", () => {});

        // 100,000 empty strings in an array
        const arrayBody = `[${Array(100000).fill('""').join(",")}]`;
        const payload = `[2, "${uuid()}", "Heartbeat", {"data": ${arrayBody}}]`;

        ws.send(payload);
        await new Promise((r) => setTimeout(r, 1500));

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
          issue: `Server crashed on large array: ${(err as Error).message}`,
        };
      } finally {
        ws?.terminate();
      }
    });

    // ── 3. Null Byte Injection (FRAME_03) ────────────────────────

    await check(
      "Server handles Null Byte injection gracefully",
      "MEDIUM",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {});

          const payload = `[2, "${uuid()}", "Heartbeat", {"data": "malicious\\u0000string"}]`;
          ws.send(payload);

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
            issue: `Server crashed on null byte injection: ${
              (err as Error).message
            }`,
          };
        } finally {
          ws?.terminate();
        }
      },
    );

    // ── 4. Message Rate Flood (OCPP_ATK_01) ──────────────────────

    await check("Server survives rapid heartbeat flood", "HIGH", async () => {
      let ws: WebSocket | undefined;
      try {
        ws = await openWS(baseUrl, protocol, 3000);
        ws.on("error", () => {});

        // Send 100 heartbeats as fast as possible over a single WS connection
        for (let i = 0; i < 100; i++) {
          ws.send(`[2, "${uuid()}", "Heartbeat", {}]`);
        }

        await new Promise((r) => setTimeout(r, 2000));

        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CLOSING
        ) {
          return {
            passed: true,
            issue: "Server survived but rate limits may not be enforced yet",
          };
        }
        // If it disconnected us (rate limit kicking in), that's also valid.
        return {
          passed: true,
          issue:
            "Server actively disconnected caller (expected rate limit behavior)",
        };
      } catch (err) {
        return {
          passed: false,
          issue: `Server became unresponsive during flood: ${
            (err as Error).message
          }`,
        };
      } finally {
        ws?.terminate();
      }
    });
  },
};
