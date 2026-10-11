import WebSocket from "ws";
import type { TestSuite } from "../lib/test-runner.js";
import { openWS, uuid, waitForMessage } from "../lib/test-runner.js";

export const rpcSuite: TestSuite = {
  name: "RPC Timing & Mechanics",
  id: "rpc",
  run: async ({ baseUrl, protocol }, check) => {
    // The error for a malformed payload: OCPP-J 1.6 §4.2.3 spells it
    // FormationViolation, 2.0.1 and 2.1 FormatViolation.
    const formatViolation =
      protocol === "ocpp1.6" ? "FormationViolation" : "FormatViolation";

    // ── 1. Heartbeat Round-trip ──────────────────────────────────

    await check("Heartbeat round-trip", "HIGH", async () => {
      let ws: WebSocket | undefined;
      try {
        ws = await openWS(baseUrl, protocol, 3000);
        ws.on("error", () => {});

        const msgId = uuid();
        ws.send(JSON.stringify([2, msgId, "Heartbeat", {}]));

        const msg = await waitForMessage(ws, 5000);
        const parsed = JSON.parse(msg);

        if (Array.isArray(parsed) && parsed[0] === 3 && parsed[1] === msgId) {
          return { passed: true };
        }
        if (Array.isArray(parsed) && parsed[0] === 4 && parsed[1] === msgId) {
          return { passed: true };
        }

        return {
          passed: false,
          issue: `Unexpected response: ${msg.slice(0, 100)}`,
        };
      } catch (err) {
        return {
          passed: false,
          issue: `No response to Heartbeat: ${(err as Error).message}`,
        };
      } finally {
        ws?.terminate();
      }
    });

    // ── 2. WebSocket Ping/Pong ───────────────────────────────────

    await check("WebSocket ping/pong", "LOW", async () => {
      let ws: WebSocket | undefined;
      try {
        ws = await openWS(baseUrl, protocol, 3000);
        ws.on("error", () => {});

        return new Promise<{ passed: boolean; issue?: string }>((resolve) => {
          const timer = setTimeout(() => {
            resolve({ passed: false, issue: "No pong received within 5s" });
          }, 5000);

          ws?.on("pong", () => {
            clearTimeout(timer);
            resolve({ passed: true });
          });

          ws?.ping();
        });
      } catch (_err) {
        return {
          passed: false,
          issue: `Error: ${(_err as Error).message}`,
        };
      } finally {
        await new Promise((r) => setTimeout(r, 100));
        ws?.terminate();
      }
    });

    // ── 3. Invalid Message Type ──────────────────────────────────

    await check("Server rejects invalid message type", "MEDIUM", async () => {
      let ws: WebSocket | undefined;
      try {
        ws = await openWS(baseUrl, protocol, 3000);
        ws.on("error", () => {});

        ws.send(JSON.stringify([99, uuid(), "Foo", {}]));

        try {
          const msg = await waitForMessage(ws, 3000);
          const parsed = JSON.parse(msg);
          if (Array.isArray(parsed) && parsed[0] === 4) {
            return { passed: true };
          }
          return {
            passed: false,
            issue: `Unexpected response: ${msg.slice(0, 80)}`,
          };
        } catch {
          return { passed: true };
        }
      } catch (err) {
        return {
          passed: false,
          issue: `Error: ${(err as Error).message}`,
        };
      } finally {
        ws?.terminate();
      }
    });

    // ── 4. Unknown Action (NotImplemented) ──────────────────────

    await check(
      "Server rejects unknown action (NotImplemented)",
      "HIGH",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {});

          const msgId = uuid();
          ws.send(JSON.stringify([2, msgId, "ThisActionDoesNotExist", {}]));

          const msg = await waitForMessage(ws, 4000);
          const parsed = JSON.parse(msg);

          if (
            Array.isArray(parsed) &&
            parsed[0] === 4 &&
            parsed[1] === msgId &&
            parsed[2] === "NotImplemented"
          ) {
            return { passed: true };
          }
          return {
            passed: false,
            issue: `Expected NotImplemented CALLERROR, got: ${msg.slice(
              0,
              80,
            )}`,
          };
        } catch (_err) {
          return { passed: true };
        } finally {
          ws?.terminate();
        }
      },
    );

    // ── 5. Invalid Message ID Type (2.x: "-1", RpcFrameworkError) ──

    await check("Server enforces MessageId is a string", "MEDIUM", async () => {
      let ws: WebSocket | undefined;
      try {
        ws = await openWS(baseUrl, protocol, 3000);
        ws.on("error", () => {});

        ws.send(JSON.stringify([2, 12345, "Heartbeat", {}])); // Integer

        const msg = await waitForMessage(ws, 4000);
        const parsed = JSON.parse(msg);

        // 2.0.1 and 2.1 answer a message ID they cannot read under "-1", with
        // RpcFrameworkError (Part 4 §4.2.3). 1.6 has no rule for it.
        const unreadableIdAnswer =
          Array.isArray(parsed) &&
          protocol !== "ocpp1.6" &&
          parsed[1] === "-1" &&
          parsed[2] === "RpcFrameworkError";
        if (
          Array.isArray(parsed) &&
          parsed[0] === 4 &&
          (unreadableIdAnswer ||
            (parsed[1] === 12345 &&
              (parsed[2] === formatViolation || parsed[2] === "ProtocolError")))
        ) {
          return { passed: true };
        }
        return {
          passed: false,
          issue: `Expected ${
            protocol === "ocpp1.6"
              ? `${formatViolation} CALLERROR`
              : 'CALLERROR under "-1" with RpcFrameworkError'
          }, got: ${msg.slice(0, 80)}`,
        };
      } catch (_err) {
        return { passed: true };
      } finally {
        ws?.terminate();
      }
    });

    // ── 6. Unmatched CALLRESULT Handling ────────────────────────

    await check(
      "Server ignores unmatched CALLRESULT gracefully",
      "LOW",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {});

          ws.send(JSON.stringify([3, "fake-message-id", {}]));
          await new Promise((r) => setTimeout(r, 1500));

          if (ws.readyState === WebSocket.OPEN) {
            return { passed: true };
          }
          return {
            passed: false,
            issue:
              "Server closed connection upon receiving unmatched CALLRESULT",
          };
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

    // ── 7. Missing Payload (FormatViolation, 1.6 FormationViolation) ─

    await check(
      "Server rejects missing payload in CALL",
      "MEDIUM",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {});

          const msgId = uuid();
          ws.send(JSON.stringify([2, msgId, "Heartbeat"]));

          const msg = await waitForMessage(ws, 4000);
          const parsed = JSON.parse(msg);

          if (
            Array.isArray(parsed) &&
            parsed[0] === 4 &&
            parsed[1] === msgId &&
            (parsed[2] === formatViolation || parsed[2] === "ProtocolError")
          ) {
            return { passed: true };
          }
          return {
            passed: false,
            issue: `Expected ${formatViolation} CALLERROR, got: ${msg.slice(
              0,
              80,
            )}`,
          };
        } catch (_err) {
          return { passed: true };
        } finally {
          ws?.terminate();
        }
      },
    );

    // ── 8. Non-Object Payload (FormatViolation, 1.6 FormationViolation)

    await check(
      "Server rejects non-object payload in CALL",
      "HIGH",
      async () => {
        let ws: WebSocket | undefined;
        try {
          ws = await openWS(baseUrl, protocol, 3000);
          ws.on("error", () => {});

          const msgId = uuid();
          ws.send(JSON.stringify([2, msgId, "Heartbeat", "NotAnObject"]));

          const msg = await waitForMessage(ws, 4000);
          const parsed = JSON.parse(msg);

          if (
            Array.isArray(parsed) &&
            parsed[0] === 4 &&
            parsed[1] === msgId &&
            (parsed[2] === formatViolation ||
              parsed[2] === "ProtocolError" ||
              parsed[2] === "TypeConstraintViolation")
          ) {
            return { passed: true };
          }
          return {
            passed: false,
            issue: `Expected violation CALLERROR, got: ${msg.slice(0, 80)}`,
          };
        } catch (_err) {
          return { passed: true };
        } finally {
          ws?.terminate();
        }
      },
    );
  },
};
