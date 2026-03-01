import crypto from "node:crypto";
import * as p from "@clack/prompts";
import logUpdate from "log-update";
import pc from "picocolors";
import WebSocket from "ws";
import { generateReport } from "../lib/reporter.js";

export interface BenchOptions {
  endpoint?: string;
  duration?: number; // seconds
  concurrency?: number; // parallel clients
  protocol?: string;
  report?: "json" | "md" | "txt";
  reportDir?: string;
}

// ── Percentile helpers ─────────────────────────────────────────

function insertSorted(arr: number[], val: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < val) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, val);
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Main ───────────────────────────────────────────────────────

export async function runBench(options: BenchOptions = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    (async () => {
      // ── Gather options interactively if missing ──

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

      let duration = options.duration ? Number(options.duration) : undefined;
      if (!duration) {
        const result = await p.text({
          message: "Benchmark duration in seconds",
          initialValue: "30",
          validate: (val) => {
            if (!val?.trim() || Number.isNaN(Number(val)))
              return "Valid number is required";
          },
        });
        if (p.isCancel(result)) {
          p.cancel("Cancelled.");
          return resolve();
        }
        duration = Number(result);
      }

      let concurrency = options.concurrency
        ? Number(options.concurrency)
        : undefined;
      if (!concurrency) {
        const result = await p.text({
          message: "Number of parallel benchmark clients",
          initialValue: "1",
          validate: (val) => {
            if (!val?.trim() || Number.isNaN(Number(val)))
              return "Valid number is required";
          },
        });
        if (p.isCancel(result)) {
          p.cancel("Cancelled.");
          return resolve();
        }
        concurrency = Number(result);
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

      options.report = reportFormat;

      const protocol = options.protocol || "ocpp1.6";

      p.log.info(pc.cyan(`Target Endpoint: ${pc.white(endpoint)}`));
      p.log.info(pc.cyan(`Duration:        ${pc.white(duration)}s`));
      p.log.info(
        pc.cyan(`Concurrency:     ${pc.white(concurrency)} client(s)`),
      );
      p.log.info(pc.cyan(`Subprotocol:     ${pc.white(protocol)}`));
      console.log("");

      // ── Benchmark state ──

      const state = {
        connecting: 0,
        connected: 0,
        booted: 0,
        failed: 0,
        sent: 0,
        received: 0,
        errors: 0,
        timedOut: 0,
      };

      const latencies: number[] = []; // kept sorted via insertSorted
      const connectTimes: number[] = [];
      const startTime = Date.now();
      const endTime = startTime + duration * 1000;
      let benchDone = false;

      // ── Live dashboard ──

      const renderDashboard = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const remaining = Math.max(0, (endTime - Date.now()) / 1000).toFixed(0);
        const throughput =
          state.received > 0
            ? (state.received / ((Date.now() - startTime) / 1000)).toFixed(1)
            : "0";

        const p50 = percentile(latencies, 50).toFixed(1);
        const p95 = percentile(latencies, 95).toFixed(1);
        const p99 = percentile(latencies, 99).toFixed(1);
        const avg =
          latencies.length > 0
            ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(
                1,
              )
            : "0";

        const ui = `
${pc.bold(pc.bgMagenta(pc.white(" ⚡ OCPP BENCHMARK ")))}  ${pc.dim(
          `⏱️  ${elapsed}s elapsed · ${remaining}s remaining`,
        )}

  ${pc.green("●")} Connected:   ${pc.bold(state.connected)} / ${concurrency}
  ${pc.magenta("●")} Booted:      ${pc.bold(state.booted)}
  ${pc.cyan("●")} Sent:        ${pc.bold(state.sent)}
  ${pc.blue("●")} Received:    ${pc.bold(state.received)}
  ${pc.red("●")} Errors:      ${pc.bold(state.errors)}
  ${pc.yellow("●")} Timed out:   ${pc.bold(state.timedOut)}

  ${pc.bold("Throughput:")}   ${pc.green(`${throughput} msg/s`)}
  ${pc.bold("Latency:")}
    ${pc.dim("avg")}  ${avg}ms    ${pc.dim("p50")}  ${p50}ms
    ${pc.dim("p95")}  ${p95}ms    ${pc.dim("p99")}  ${p99}ms

${pc.dim("Benchmark will auto-stop. Press Ctrl+C to abort early.")}
`;
        logUpdate(ui);
      };

      const dashboardTimer = setInterval(renderDashboard, 150);

      // ── Pending call tracking (for latency measurement) ──

      const pendingCalls = new Map<string, number>(); // msgId → sentAt (hrtime ms)

      // ── Spawn a benchmark client ──

      const activeClients: WebSocket[] = [];

      const spawnClient = (clientId: number): Promise<void> => {
        return new Promise<void>((clientResolve) => {
          state.connecting++;
          const identity = `Bench-${clientId}`;
          const url = `${endpoint}/${identity}`;
          const connectStart = performance.now();
          const ws = new WebSocket(url, [protocol]);
          activeClients.push(ws);

          let heartbeatTimer: NodeJS.Timeout | null = null;

          const sendHeartbeat = () => {
            if (ws.readyState !== WebSocket.OPEN || benchDone) return;
            const msgId = crypto.randomUUID();
            const msg = JSON.stringify([2, msgId, "Heartbeat", {}]);
            pendingCalls.set(msgId, performance.now());
            ws.send(msg);
            state.sent++;
          };

          ws.on("open", () => {
            state.connecting--;
            state.connected++;
            const connectTime = performance.now() - connectStart;
            insertSorted(connectTimes, connectTime);

            // Send BootNotification
            const bootId = crypto.randomUUID();
            pendingCalls.set(bootId, performance.now());
            if (protocol.startsWith("ocpp2")) {
              ws.send(
                JSON.stringify([
                  2,
                  bootId,
                  "BootNotification",
                  {
                    chargingStation: {
                      model: "Benchmark",
                      vendorName: "OCPP-WS-CLI",
                    },
                    reason: "PowerUp",
                  },
                ]),
              );
            } else {
              ws.send(
                JSON.stringify([
                  2,
                  bootId,
                  "BootNotification",
                  {
                    chargePointVendor: "OCPP-WS-CLI",
                    chargePointModel: "Benchmark",
                  },
                ]),
              );
            }
            state.sent++;
          });

          ws.on("message", (raw) => {
            try {
              const parsed = JSON.parse(raw.toString());
              if (parsed[0] === 3) {
                // CallResult
                const msgId = parsed[1] as string;
                const sentAt = pendingCalls.get(msgId);
                if (sentAt !== undefined) {
                  const latency = performance.now() - sentAt;
                  insertSorted(latencies, latency);
                  pendingCalls.delete(msgId);
                  state.received++;
                }

                // If BootNotification accepted, start heartbeat loop
                const payload = parsed[2];
                if (
                  payload?.status === "Accepted" &&
                  !heartbeatTimer &&
                  !benchDone
                ) {
                  state.booted++;
                  // Tight heartbeat loop — send as fast as the server replies
                  sendHeartbeat();
                  heartbeatTimer = setInterval(() => {
                    if (benchDone) {
                      if (heartbeatTimer) clearInterval(heartbeatTimer);
                      return;
                    }
                    sendHeartbeat();
                  }, 10); // ~100 msg/s per client
                }
              } else if (parsed[0] === 4) {
                // CallError
                const msgId = parsed[1] as string;
                pendingCalls.delete(msgId);
                state.errors++;
              }
            } catch {
              state.errors++;
            }
          });

          ws.on("error", () => {
            state.failed++;
            if (state.connecting > 0) state.connecting--;
            clientResolve();
          });

          ws.on("close", () => {
            if (state.connected > 0) state.connected--;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            clientResolve();
          });
        });
      };

      // ── Spawn all clients ──

      const clientPromises: Promise<void>[] = [];
      for (let i = 1; i <= concurrency; i++) {
        clientPromises.push(spawnClient(i));
      }

      // ── Wait for benchmark duration ──

      const finishBench = async () => {
        if (benchDone) return;
        benchDone = true;
        clearInterval(dashboardTimer);
        renderDashboard(); // final render
        logUpdate.clear();

        // Gracefully close all clients
        for (const ws of activeClients) {
          ws.removeAllListeners();
          try {
            ws.close();
          } catch {}
        }

        // Wait a bit for close handlers
        await new Promise((r) => setTimeout(r, 500));

        // ── Print final summary ──

        const totalElapsed = (Date.now() - startTime) / 1000;
        const throughput =
          state.received > 0 ? (state.received / totalElapsed).toFixed(1) : "0";

        const p50 = percentile(latencies, 50).toFixed(2);
        const p95 = percentile(latencies, 95).toFixed(2);
        const p99 = percentile(latencies, 99).toFixed(2);
        const avg =
          latencies.length > 0
            ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(
                2,
              )
            : "0";
        const min = latencies.length > 0 ? latencies[0].toFixed(2) : "0";
        const max =
          latencies.length > 0
            ? latencies[latencies.length - 1].toFixed(2)
            : "0";
        const avgConnect =
          connectTimes.length > 0
            ? (
                connectTimes.reduce((a, b) => a + b, 0) / connectTimes.length
              ).toFixed(2)
            : "0";

        const errorRate =
          state.sent > 0 ? ((state.errors / state.sent) * 100).toFixed(1) : "0";

        console.log(`
${pc.bold(pc.bgMagenta(pc.white(" ⚡ BENCHMARK RESULTS ")))}

${pc.bold("Overview")}
  Duration:          ${pc.white(`${totalElapsed.toFixed(1)}s`)}
  Clients:           ${pc.white(String(concurrency))}
  Protocol:          ${pc.white(protocol)}
  Messages Sent:     ${pc.white(String(state.sent))}
  Messages Received: ${pc.white(String(state.received))}
  Errors:            ${
    state.errors > 0 ? pc.red(String(state.errors)) : pc.green("0")
  }
  Error Rate:        ${
    Number(errorRate) > 5 ? pc.red(`${errorRate}%`) : pc.green(`${errorRate}%`)
  }

${pc.bold("Throughput")}
  ${pc.green(`${throughput} msg/s`)}

${pc.bold("Connection Time")}
  avg: ${pc.white(`${avgConnect}ms`)}

${pc.bold("Latency (round-trip)")}
  ┌──────────┬────────────┐
  │ ${pc.dim("Metric")}   │ ${pc.dim("Value")}      │
  ├──────────┼────────────┤
  │ min      │ ${pc.white(min.padStart(7))} ms │
  │ avg      │ ${pc.white(avg.padStart(7))} ms │
  │ p50      │ ${pc.white(p50.padStart(7))} ms │
  │ p95      │ ${pc.white(p95.padStart(7))} ms │
  │ p99      │ ${pc.white(p99.padStart(7))} ms │
  │ max      │ ${pc.white(max.padStart(7))} ms │
  └──────────┴────────────┘
`);

        // ── Report ──

        if (options.report) {
          await generateReport(
            {
              command: "bench",
              elapsedMs: Date.now() - startTime,
              metrics: {
                messagesSent: state.sent,
                messagesReceived: state.received,
                errors: state.errors,
                errorRate: `${errorRate}%`,
                throughputMsgPerSec: throughput,
                latencyMinMs: min,
                latencyAvgMs: avg,
                latencyP50Ms: p50,
                latencyP95Ms: p95,
                latencyP99Ms: p99,
                latencyMaxMs: max,
                avgConnectTimeMs: avgConnect,
                concurrency,
                durationSeconds: totalElapsed.toFixed(1),
              },
              metadata: {
                endpoint,
                protocol,
                concurrency,
                durationSeconds: duration,
              },
            },
            { format: options.report, dir: options.reportDir },
          );
        }

        process.removeListener("SIGINT", handleSigInt);
        p.log.success("\nBenchmark complete.\n");
        resolve();
      };

      const benchTimer = setTimeout(finishBench, duration * 1000);

      const handleSigInt = async () => {
        clearTimeout(benchTimer);
        await finishBench();
      };

      process.on("SIGINT", handleSigInt);
    })();
  });
}
