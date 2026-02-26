import crypto from "node:crypto";
import * as p from "@clack/prompts";
import logUpdate from "log-update";
import pc from "picocolors";
import WebSocket from "ws";
import { generateReport } from "../lib/reporter.js";

export interface FuzzOptions {
  endpoint?: string;
  workers?: number;
  flood?: boolean;
  report?: "json" | "md" | "txt";
  reportDir?: string;
}

export async function runFuzz(options: FuzzOptions = {}): Promise<void> {
  return new Promise((resolve) => {
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

      let numWorkers = options.workers ? Number(options.workers) : undefined;
      if (!numWorkers) {
        const result = await p.text({
          message: "Number of concurrent fuzzing worker threads",
          initialValue: "5",
          validate: (val) => {
            if (!val?.trim() || Number.isNaN(Number(val)))
              return "Valid number is required";
          },
        });
        if (p.isCancel(result)) {
          p.cancel("Cancelled.");
          return resolve();
        }
        numWorkers = Number(result);
      }

      let isFlood = options.flood;
      if (isFlood === undefined) {
        const result = await p.confirm({
          message: "Enable Flood Mode (Blast anomalies with 0ms delay)?",
          initialValue: false,
        });
        if (p.isCancel(result)) {
          p.cancel("Cancelled.");
          return resolve();
        }
        isFlood = result as boolean;
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

      p.log.info(pc.cyan(`Target Endpoint: ${pc.white(endpoint)}`));
      p.log.info(pc.cyan(`Active Workers:  ${pc.white(numWorkers)}`));
      p.log.info(pc.cyan(`Flood Mode:      ${pc.white(String(isFlood))}`));
      console.log("");

      const state = {
        connectedWorkers: 0,
        anomaliesSent: 0,
        serverErrors: 0, // Server responds with CALLERROR (Type 4)
        serverDrops: 0, // Server forcibly closes socket
        serverTolerated: 0, // Server accepted or ignored cleanly
      };

      const startTime = Date.now();
      let isRunning = true;

      const renderDashboard = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (state.anomaliesSent / (Date.now() - startTime)) * 1000;

        const ui = `
${pc.bold(pc.bgRed(pc.white(" O C P P   C H A O S   E N G I N E ")))}  ${pc.dim(
          `⏱️ ${elapsed}s elapsed`,
        )}

  ${pc.cyan("●")} Active Workers:   ${pc.bold(state.connectedWorkers)}
  ${pc.yellow("●")} Anomalies Sent:   ${pc.bold(state.anomaliesSent)} ${pc.dim(
    `(${rate.toFixed(1)}/sec)`,
  )}

${pc.bold("  SERVER RESILIENCY ")}
  ${pc.green("✔")} Handled (CallError): ${pc.bold(state.serverErrors)}
  ${pc.red("✖")} Dropped (Disconnect): ${pc.bold(state.serverDrops)}
  ${pc.magenta("⚠")} Tolerated (Ignored):  ${pc.bold(state.serverTolerated)}

${pc.dim("Press Ctrl+C to terminate the chaos engine...")}
`;
        logUpdate(ui);
      };

      const intervalTimer = setInterval(renderDashboard, 100);

      const fuzzPayloads = [
        // 1. Invalid JSON Parsing
        (id: string) => `[2, "${id}", "BootNotification", {]`, // Truncated JSON
        (id: string) => `{[2, "${id}", "BootNotification", {}]}`, // Array enclosed in object
        (id: string) => `[2, "${id}", "BootNotification", "invalid"]`, // String instead of object payload
        // 2. Schema Validation Errors (Missing/Wrong Types)
        (id: string) =>
          JSON.stringify([
            2,
            id,
            "BootNotification",
            { chargePointVendor: 12345 },
          ]), // Vendor is number, missing model
        (id: string) =>
          JSON.stringify([
            2,
            id,
            "StartTransaction",
            { connectorId: "NotANumber", idTag: "BEEF" },
          ]), // String where number required
        (id: string) =>
          JSON.stringify([
            2,
            id,
            "Heartbeat",
            { rogueField: "This should be strictly rejected" },
          ]), // Additional properties
        // 3. Protocol Compliance (Bad IDs, Action)
        (id: string) => JSON.stringify([99, id, "BootNotification", {}]), // Invalid MessageTypeId (99)
        (id: string) => JSON.stringify([2, id, "FakeActionOcpp", {}]), // Not a real OCPP Action
        (id: string) => JSON.stringify([4, id, "NotImplemented", "Whoops", {}]), // Sending CallError as client randomly
        // 4. Targeted Payload Scrambling
        (id: string) => {
          const payload: Record<string, unknown> = {
            connectorId: 1,
            idTag: "DEADBEEF",
            meterStart: 0,
            timestamp: new Date().toISOString(),
          };
          // Randomly scramble one property to undefined/null/NaN
          const keys = Object.keys(payload);
          const randomKey = keys[Math.floor(Math.random() * keys.length)];
          const scramblers = [
            null,
            undefined,
            NaN,
            { nested: true },
            [1, 2, 3],
          ];
          payload[randomKey] =
            scramblers[Math.floor(Math.random() * scramblers.length)];
          return JSON.stringify([2, id, "StartTransaction", payload]);
        },
        // 5. Security Bypass / SQLi Vectors
        (id: string) =>
          JSON.stringify([2, id, "Authorize", { idTag: "' OR 1=1 --" }]),
        (id: string) =>
          JSON.stringify([
            2,
            id,
            "Authorize",
            { idTag: "admin'; DROP TABLE users--" },
          ]),
        (id: string) => JSON.stringify([2, id, "Authorize"]),
      ];

      const messageLog: unknown[] = [];

      const spawnWorker = (workerId: number) => {
        const identity = `Fuzzer-${workerId}`;
        const url = `${endpoint}/${identity}`;
        let ws = new WebSocket(url, ["ocpp1.6"]);
        let fuzzLoop: NodeJS.Timeout;

        const connectAndFuzz = () => {
          ws.on("open", () => {
            state.connectedWorkers++;

            // Fuzz Loop
            fuzzLoop = setInterval(
              () => {
                if (ws.readyState === WebSocket.OPEN && isRunning) {
                  const msgId = crypto.randomUUID();
                  const anomalyGenerator =
                    fuzzPayloads[
                      Math.floor(Math.random() * fuzzPayloads.length)
                    ];
                  const payload = anomalyGenerator(msgId);

                  ws.send(payload);
                  if (options.report) {
                    messageLog.push(payload);
                    if (messageLog.length > 100) messageLog.shift();
                  }
                  state.anomaliesSent++;
                }
              },
              isFlood ? 10 : 300,
            ); // 10ms for extreme flood blast, 300ms for heavy normal
          });

          ws.on("message", (raw) => {
            try {
              const parsed = JSON.parse(raw.toString());
              if (parsed[0] === 4) {
                // CALLERROR means the server successfully caught the bad payload and responded properly
                state.serverErrors++;
              } else {
                // Tolerated / Accepted / Valid response
                state.serverTolerated++;
              }
            } catch (_e) {
              // Unparseable response from server? Very rare.
            }
          });

          ws.on("close", () => {
            state.serverDrops++; // Drops represent strict WebSocket termination filters
            if (state.connectedWorkers > 0) state.connectedWorkers--;
            if (fuzzLoop) clearInterval(fuzzLoop);

            // Auto-reconnect worker to continue the assault
            if (isRunning) {
              ws.removeAllListeners();
              setTimeout(() => {
                if (isRunning) {
                  ws = new WebSocket(url, ["ocpp1.6"]);
                  connectAndFuzz();
                }
              }, 500); // Half second backoff
            }
          });

          ws.on("error", () => {
            // usually accompanied by a close event
          });
        };

        connectAndFuzz();
        return () => {
          if (fuzzLoop) clearInterval(fuzzLoop);
          ws.removeAllListeners();
          try {
            ws.close();
          } catch {}
        };
      };

      const cleanupFns: (() => void)[] = [];
      for (let i = 1; i <= numWorkers; i++) {
        cleanupFns.push(spawnWorker(i));
      }

      // Handle sudden exit
      const handleSigInt = async () => {
        isRunning = false;
        clearInterval(intervalTimer);
        logUpdate.clear();
        console.log(
          `\n${pc.bgRed(
            pc.white(" FUZZING TERMINATED "),
          )} Shutting down ${numWorkers} worker threads...`,
        );

        if (options.report) {
          await generateReport(
            {
              command: "fuzz",
              elapsedMs: Date.now() - startTime,
              metrics: state,
              metadata: {
                endpoint,
                numWorkers,
                isFlood,
              },
              messages: messageLog,
            },
            { format: options.report, dir: options.reportDir },
          );
        }

        for (const cleanup of cleanupFns) cleanup();

        // Clean up our SIGINT listener
        process.removeListener("SIGINT", handleSigInt);
        p.log.success("\nYielding back to interactive menu...\n");
        resolve();
      };

      process.on("SIGINT", handleSigInt);
    })();
  });
}
