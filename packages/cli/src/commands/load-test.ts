import crypto from "node:crypto";
import * as p from "@clack/prompts";
import logUpdate from "log-update";
import pc from "picocolors";
import WebSocket from "ws";
import { generateReport } from "../lib/reporter.js";

export interface LoadTestOptions {
  endpoint?: string;
  clients?: number;
  rampUp?: number; // seconds
  mode?: "heartbeat" | "authorize-spam";
  protocol?: string;
  report?: "json" | "md" | "txt";
  reportDir?: string;
}

export async function runLoadTest(
  options: LoadTestOptions = {},
): Promise<void> {
  return new Promise<void>((resolve) => {
    (async () => {
      let endpoint = options.endpoint;
      if (!endpoint) {
        const result = await p.text({
          message: "Server WebSocket endpoint",
          initialValue: "ws://localhost:5000/ocpp",
          validate: (val) => {
            if (!val?.trim()) return "Endpoint is required";
            if (!val.startsWith("ws://") && !val.startsWith("wss://"))
              return "Must start with ws:// or wss://";
          },
        });
        if (p.isCancel(result)) {
          p.cancel("Cancelled.");
          return resolve();
        }
        endpoint = result as string;
      }

      let numClients = options.clients ? Number(options.clients) : undefined;
      if (!numClients) {
        const result = await p.text({
          message: "Number of concurrent simulated clients",
          initialValue: "100",
          validate: (val) => {
            if (!val?.trim() || Number.isNaN(Number(val)))
              return "Valid number is required";
          },
        });
        if (p.isCancel(result)) {
          p.cancel("Cancelled.");
          return resolve();
        }
        numClients = Number(result);
      }

      let rampUpSeconds = options.rampUp ? Number(options.rampUp) : undefined;
      if (!rampUpSeconds) {
        const result = await p.text({
          message: "Ramp-up time in seconds (staggered connect)",
          initialValue: "10",
          validate: (val) => {
            if (!val?.trim() || Number.isNaN(Number(val)))
              return "Valid number is required";
          },
        });
        if (p.isCancel(result)) {
          p.cancel("Cancelled.");
          return resolve();
        }
        rampUpSeconds = Number(result);
      }

      let reportFormat = options.report;
      if (!reportFormat) {
        const wantsReport = await p.confirm({
          message: "Do you want to save a report file?",
          initialValue: false,
        });
        if (p.isCancel(wantsReport)) {
          p.cancel("Cancelled.");
          return resolve();
        }

        if (wantsReport) {
          const formatResult = await p.select({
            message: "Select report format",
            options: [
              { value: "json", label: "JSON" },
              { value: "md", label: "Markdown" },
              { value: "txt", label: "Text" },
            ],
          });
          if (p.isCancel(formatResult)) {
            p.cancel("Cancelled.");
            return resolve();
          }
          reportFormat = formatResult as "json" | "md" | "txt";
        }
      }

      // Update options so that generateReport uses it later
      options.report = reportFormat;

      const mode = options.mode || "heartbeat";
      const protocol = options.protocol || "ocpp1.6";

      p.log.info(pc.cyan(`Target Endpoint: ${pc.white(endpoint)}`));
      p.log.info(pc.cyan(`Total Clients:   ${pc.white(numClients)}`));
      p.log.info(pc.cyan(`Ramp-up Time:    ${pc.white(rampUpSeconds)}s`));
      p.log.info(pc.cyan(`Attack Mode:     ${pc.white(mode)}`));
      p.log.info(pc.cyan(`Subprotocol:     ${pc.white(protocol)}`));
      console.log("");

      const state = {
        pending: numClients,
        connecting: 0,
        connected: 0,
        failed: 0,
        dropped: 0,
        booted: 0,
        heartbeats: 0,
        authorizes: 0,
      };

      const startTime = Date.now();
      const messageLog: unknown[] = [];

      const renderDashboard = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const ui = `
${pc.bold(pc.bgBlue(pc.white(" DISTRIBUTED LOAD TEST ")))}  ${pc.dim(
          `⏱️ ${elapsed}s elapsed`,
        )}

  ${pc.yellow("●")} Pending:    ${pc.bold(state.pending)}
  ${pc.cyan("●")} Connecting: ${pc.bold(state.connecting)}
  ${pc.green("●")} Connected:  ${pc.bold(state.connected)}
  ${pc.magenta("●")} Booted:     ${pc.bold(state.booted)}
${
  mode === "heartbeat"
    ? `  ${pc.blue("●")} Heartbeats: ${pc.bold(state.heartbeats)}`
    : `  ${pc.red("●")} Authorize Spam: ${pc.bold(state.authorizes)}`
}
  ${pc.red("●")} Failed:     ${pc.bold(state.failed)}
  ${pc.red("●")} Dropped:    ${pc.bold(state.dropped)}

${pc.dim("Press Ctrl+C to terminate the load test...")}
`;
        logUpdate(ui);
      };

      const intervalTimer = setInterval(renderDashboard, 100);

      // Minimal WS Client for overhead reduction
      const spawnClient = (clientId: number) => {
        state.pending--;
        state.connecting++;

        const identity = `LoadTester-${clientId}`;
        const url = `${endpoint}/${identity}`;
        const ws = new WebSocket(url, [protocol]);
        let actionTimer: NodeJS.Timeout;

        // We don't use real promises here to avoid massive memory heap overhead
        const sendMessage = (action: string, payload: unknown) => {
          if (ws.readyState === WebSocket.OPEN) {
            const msgId = crypto.randomUUID();
            const rawMsg = [2, msgId, action, payload];
            ws.send(JSON.stringify(rawMsg));

            if (options.report) {
              messageLog.push(rawMsg);
              if (messageLog.length > 100) messageLog.shift();
            }
          }
        };

        ws.on("open", () => {
          state.connecting--;
          state.connected++;

          // Send BootNotification immediately on connect
          if (protocol.startsWith("ocpp2")) {
            sendMessage("BootNotification", {
              chargingStation: {
                model: "LoadTester",
                vendorName: "OCPP-WS-CLI",
              },
              reason: "PowerUp",
            });
          } else {
            sendMessage("BootNotification", {
              chargePointVendor: "OCPP-WS-CLI",
              chargePointModel: "LoadTester",
            });
          }

          // Randomly drop sockets simulation (5% chance every 30 seconds)
          setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && Math.random() < 0.05) {
              try {
                ws.terminate();
              } catch {}
            }
          }, 30000);
        });

        ws.on("message", (raw) => {
          try {
            const parsed = JSON.parse(raw.toString());
            if (parsed[0] === 3) {
              // CallResult
              const payload = parsed[2];
              if (
                payload &&
                payload.status === "Accepted" &&
                payload.interval
              ) {
                // First accepted boot notification response
                if (!actionTimer) {
                  state.booted++;

                  if (mode === "heartbeat") {
                    actionTimer = setInterval(() => {
                      sendMessage("Heartbeat", {});
                      state.heartbeats++;
                    }, payload.interval * 1000);
                  } else if (mode === "authorize-spam") {
                    actionTimer = setInterval(() => {
                      if (protocol.startsWith("ocpp2")) {
                        sendMessage("Authorize", {
                          idToken: {
                            idToken: `BID-${clientId}-${crypto
                              .randomUUID()
                              .substring(0, 4)}`,
                            type: "ISO14443",
                          },
                        });
                      } else {
                        sendMessage("Authorize", {
                          idTag: `BID-${clientId}-${crypto
                            .randomUUID()
                            .substring(0, 4)}`,
                        });
                      }
                      state.authorizes++;
                    }, 500); // Blast an authorize every 500ms
                  }
                }
              }
            }
          } catch (_e) {
            // Drop bad packets
          }
        });

        ws.on("close", () => {
          state.connected--;
          state.dropped++;
          if (actionTimer) clearInterval(actionTimer);

          // Attempt reconnect if we simulate random drops
          setTimeout(() => {
            if (state.connected < numClients && state.connecting < numClients) {
              // rudimentary pool logic
              // clients.push(spawnClient(clientId)); (omitted endless loops)
            }
          }, 5000);
        });

        ws.on("error", () => {
          // Errors usually mean connection refused, timeout, or DNS failure
          state.failed++;
          if (state.connecting > 0) state.connecting--;
        });

        return ws;
      };

      // Ramp-up logic
      const delayMs = (rampUpSeconds * 1000) / numClients;
      const clients: WebSocket[] = [];

      for (let i = 1; i <= numClients; i++) {
        setTimeout(() => {
          clients.push(spawnClient(i));
        }, i * delayMs);
      }

      // Handle sudden exit
      const handleSigInt = async () => {
        clearInterval(intervalTimer);
        logUpdate.clear();
        console.log(
          `\n${pc.bgRed(pc.white(" TEST TERMINATED "))} Shutting down ${
            clients.length
          } connections...`,
        );

        if (options.report) {
          await generateReport(
            {
              command: "load-test",
              elapsedMs: Date.now() - startTime,
              metrics: state,
              metadata: {
                endpoint,
                numClients,
                rampUpSeconds,
                mode,
                protocol,
              },
              messages: messageLog,
            },
            { format: options.report, dir: options.reportDir },
          );
        }

        clients.forEach((ws) => {
          ws.removeAllListeners();
          try {
            ws.close();
          } catch {}
        });

        // Clean up our SIGINT listener
        process.removeListener("SIGINT", handleSigInt);
        p.log.success("\nYielding back to interactive menu...\n");
        resolve();
      };

      process.on("SIGINT", handleSigInt);
    })();
  });
}
