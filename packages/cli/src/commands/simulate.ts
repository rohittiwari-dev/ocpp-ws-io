import * as readline from "node:readline";
import * as p from "@clack/prompts";
import logUpdate from "log-update";
import pc from "picocolors";
import { generateReport } from "../lib/reporter.js";
import { SimulatorEngine } from "../simulator/Engine.js";

export interface SimulateOptions {
  endpoint?: string;
  identity?: string;
  idTag?: string;
  protocol?: string;
  report?: "json" | "md" | "txt";
  reportDir?: string;
}

export async function runSimulate(
  options: SimulateOptions = {},
): Promise<void> {
  console.clear();
  p.intro(pc.bgMagenta(pc.white(" VIRTUAL CHARGE POINT (SIMULATOR) ")));

  // ── Prompts ──────────────────────────────────────────────────

  let endpoint: string;
  if (options.endpoint) {
    endpoint = options.endpoint;
  } else {
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
      return;
    }
    endpoint = result as string;
  }

  let identity: string;
  if (options.identity) {
    identity = options.identity;
  } else {
    const result = await p.text({
      message: "Charge point identity (URL path suffix)",
      initialValue: "Simulator001",
      validate: (val) => {
        if (!val?.trim()) return "Identity is required";
      },
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    identity = result as string;
  }

  let protocol: string;
  if (options.protocol) {
    protocol = options.protocol;
  } else {
    const result = await p.text({
      message: "OCPP subprotocol to use for this simulation",
      initialValue: "ocpp1.6",
      validate: (val) => {
        if (!val?.trim()) return "Protocol is required";
      },
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    protocol = result as string;
  }

  let idTag: string;
  if (options.idTag) {
    idTag = options.idTag;
  } else {
    const result = await p.text({
      message: "Default ID Tag to use for authorization",
      initialValue: "SIM-USER-001",
      validate: (val) => {
        if (!val?.trim()) return "ID Tag is required";
      },
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    idTag = result as string;
  }

  let reportFormat = options.report;
  if (!reportFormat) {
    const wantsReport = await p.confirm({
      message: "Do you want to save a report file?",
      initialValue: false,
    });
    if (p.isCancel(wantsReport)) {
      p.cancel("Cancelled.");
      return;
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
        return;
      }
      reportFormat = formatResult as "json" | "md" | "txt";
    }
  }

  // Update options so that generateReport uses it later
  options.report = reportFormat;

  const engine = new SimulatorEngine({
    endpoint,
    identity,
    idTag,
    protocol,
  });

  // Setup UI State tracking
  const allLogs: { msg: string; type: string; timestamp: string }[] = [];
  const logs: { msg: string; type: string; timestamp: string }[] = [];
  let metrics = {
    power: 0,
    voltage: 240,
    current: 0,
    temp: 30,
    soc: 45,
    energy: 0,
  };

  const addLog = (msg: string, type: string) => {
    const logEntry = { msg, type, timestamp: new Date().toLocaleTimeString() };
    allLogs.push(logEntry);
    logs.unshift(logEntry);
    if (logs.length > 5) logs.pop();
    renderDashboard();
  };

  engine.on("log", addLog);
  engine.on("metrics", (m) => {
    metrics = m;
    renderDashboard();
  });

  const renderDashboard = () => {
    const statusColor =
      engine.connectorState === "Available"
        ? pc.green
        : engine.connectorState === "Charging"
          ? pc.magenta
          : engine.connectorState === "Preparing"
            ? pc.yellow
            : pc.red;

    const authLabel = engine.activeIdTag
      ? pc.blue(`[Auth: ${engine.activeIdTag}]`)
      : pc.dim("[No Auth]");
    const txLabel = engine.activeTransactionId
      ? pc.cyan(`[Tx: ${engine.activeTransactionId}]`)
      : pc.dim("[No Tx]");

    const ui = `
${pc.bold(pc.bgMagenta(pc.white(" INTERACTIVE CONTROLS ")))}
${pc.magenta("  [A] ")} ${pc.dim("Authorize Badge")}    |  ${pc.magenta(
      "  [I] ",
    )} ${pc.dim("Change ID Tag")}
${pc.magenta("  [T] ")} ${pc.dim("Start Transaction")}  |  ${pc.magenta(
      "  [E] ",
    )} ${pc.dim("Stop/End Transaction")}
${pc.magenta("  [B] ")} ${pc.dim("BootNotification")}   |  ${pc.magenta(
      "  [H] ",
    )} ${pc.dim("Heartbeat")}
${pc.magenta("  [U] ")} ${pc.dim("Update Status")}      |  ${pc.magenta("  [X] ")} ${pc.dim("Extended Events")}
${pc.magenta("  [D] ")} ${pc.dim("DataTransfer")}       |  ${pc.magenta(
      "  [S] ",
    )} ${pc.dim("Toggle Faulted")}
${pc.red("  [Q] ")} ${pc.dim("Quit Simulator")}

${pc.bold("  HARDWARE METRICS ")} ${pc.dim("─────────────────────────")}
  ⚡ Power:   ${pc.yellow(
    (metrics.power / 1000).toFixed(2),
  )} kW    🔌 Voltage: ${pc.yellow(metrics.voltage.toFixed(1))} V
  🔋 Energy:  ${pc.cyan(
    metrics.energy.toFixed(2),
  )} Wh   ⚡ Current: ${pc.yellow(metrics.current.toFixed(1))} A
  🌡️ Temp:    ${pc.red(metrics.temp.toFixed(1))} °C      🚗 SoC:     ${pc.green(
    metrics.soc.toFixed(1),
  )} %

${pc.bold("  CONNECTOR STATE ")} ${pc.dim("─────────────────────────")}
  Status: ${statusColor(pc.bold(engine.connectorState))} ${authLabel} ${txLabel}

${pc.bold("  LOGS ")} ${pc.dim("────────────────────────────────────")}
${logs
  .map((l) => {
    const c =
      l.type === "error"
        ? pc.red
        : l.type === "success"
          ? pc.green
          : l.type === "warn"
            ? pc.yellow
            : pc.blue;
    return `  ${pc.dim(l.timestamp)} ${c("│")} ${c(l.msg)}`;
  })
  .join("\n")}
`;
    logUpdate(ui);
  };

  // Start the simulation engine
  addLog("Engine starting...", "info");
  const startTime = Date.now();
  await engine.start();
  renderDashboard();

  return new Promise<void>((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = async () => {
      engine.stop();
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.stdin.removeListener("keypress", handleKeypress);
      process.off("SIGINT", handleSigInt);
      logUpdate.clear();

      if (options.report) {
        await generateReport(
          {
            command: "simulate",
            elapsedMs: Date.now() - startTime,
            metrics: {
              finalState: engine.connectorState,
              finalVoltage: `${metrics.voltage.toFixed(1)} V`,
              finalPower: `${(metrics.power / 1000).toFixed(2)} kW`,
              finalEnergy: `${metrics.energy.toFixed(2)} Wh`,
              finalSoc: `${metrics.soc.toFixed(1)} %`,
              totalLogs: logs.length,
            },
            metadata: {
              endpoint,
              identity,
              protocol,
            },
            logs: allLogs,
          },
          { format: options.report, dir: options.reportDir },
        );
      }

      p.log.success("\nSimulator stopped. Returning to menu.");
      resolve();
    };

    const handleSigInt = () => {
      cleanup();
    };

    const handleKeypress = async (str: string, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        return;
      }

      const lower = str?.toLowerCase();

      // Temporarily pause UI rendering and TTY if we need to prompt
      const pauseDashboard = () => {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("keypress", handleKeypress);
      };

      const resumeDashboard = () => {
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("keypress", handleKeypress);
        renderDashboard();
      };

      try {
        if (lower === "q") {
          cleanup();
        } else if (lower === "a") {
          await engine.authorize(engine.activeIdTag || idTag);
        } else if (lower === "t") {
          await engine.startTransaction();
        } else if (lower === "e") {
          await engine.stopTransaction();
        } else if (lower === "m") {
          await engine.triggerMeterValues();
        } else if (lower === "h") {
          await engine.sendHeartbeat();
        } else if (lower === "b") {
          await engine.sendBootNotification();
        } else if (lower === "s") {
          const nextState =
            engine.connectorState === "Available" ? "Faulted" : "Available";
          await engine.updateConnectorState(nextState);
        } else if (lower === "i") {
          pauseDashboard();
          const pTag = await p.text({
            message: "Enter new ID Tag to use for Auth and Transactions",
            initialValue: engine.activeIdTag || idTag,
          });
          if (!p.isCancel(pTag) && pTag) {
            engine.activeIdTag = pTag as string;
            addLog(`Active ID Tag changed to ${pTag}`, "info");
          }
          resumeDashboard();
        } else if (lower === "u") {
          pauseDashboard();
          const pStatus = await p.select({
            message: "Select new Connector Status",
            options: [
              { value: "Available", label: "Available" },
              { value: "Preparing", label: "Preparing" },
              { value: "Charging", label: "Charging" },
              { value: "SuspendedEV", label: "SuspendedEV" },
              { value: "SuspendedEVSE", label: "SuspendedEVSE" },
              { value: "Finishing", label: "Finishing" },
              { value: "Reserved", label: "Reserved" },
              { value: "Unavailable", label: "Unavailable" },
              { value: "Faulted", label: "Faulted" },
            ],
          });
          if (!p.isCancel(pStatus) && pStatus) {
            await engine.updateConnectorState(pStatus as any);
          }
          resumeDashboard();
        } else if (lower === "d") {
          pauseDashboard();
          const pVendorId = await p.text({ message: "VendorId", initialValue: "OCPP-WS-IO" });
          if (!p.isCancel(pVendorId)) {
            const pMessageId = await p.text({ message: "MessageId (Optional)" });
            const pData = await p.text({ message: "Data Payload (Optional String JSON)" });
            if (!p.isCancel(pMessageId) && !p.isCancel(pData)) {
              await engine.sendDataTransfer(
                pVendorId as string,
                pMessageId ? (pMessageId as string) : undefined,
                pData ? (pData as string) : undefined
              );
            }
          }
          resumeDashboard();
        } else if (lower === "x") {
          pauseDashboard();
          const eventType = await p.select({
            message: "Select an Extended Event to dispatch globally",
            options: [
              { value: "FirmwareStatusNotification", label: "FirmwareStatusNotification" },
              { value: "DiagnosticsStatusNotification", label: "DiagnosticsStatusNotification" },
              { value: "CustomMeterValues", label: "Send Custom MeterValues" }
            ],
          });

          if (!p.isCancel(eventType)) {
            if (eventType === "FirmwareStatusNotification") {
              const fStatus = await p.select({
                message: "Select Firmware Status",
                options: [
                  { value: "Downloaded", label: "Downloaded" },
                  { value: "DownloadFailed", label: "DownloadFailed" },
                  { value: "Downloading", label: "Downloading" },
                  { value: "Idle", label: "Idle" },
                  { value: "InstallationFailed", label: "InstallationFailed" },
                  { value: "Installing", label: "Installing" },
                  { value: "Installed", label: "Installed" }
                ]
              });
              if (!p.isCancel(fStatus) && fStatus) {
                await engine.sendFirmwareStatusNotification(fStatus as string);
              }
            } else if (eventType === "DiagnosticsStatusNotification") {
              const dStatus = await p.select({
                message: "Select Diagnostics Status",
                options: [
                  { value: "Idle", label: "Idle" },
                  { value: "Uploaded", label: "Uploaded" },
                  { value: "UploadFailed", label: "UploadFailed" },
                  { value: "Uploading", label: "Uploading" }
                ]
              });
              if (!p.isCancel(dStatus) && dStatus) {
                await engine.sendDiagnosticsStatusNotification(dStatus as string);
              }
            } else if (eventType === "CustomMeterValues") {
               const pValW = await p.text({ message: "Enter Custom Active Power (W) to emit", initialValue: "5000" });
               const pValWh = await p.text({ message: "Enter Custom Energy (Wh) to emit", initialValue: engine.meterWh.toString() });
               if (!p.isCancel(pValW) && !p.isCancel(pValWh)) {
                 await engine.triggerCustomMeterValues(Number(pValW), Number(pValWh));
               }
            }
          }
          resumeDashboard();
        }
      } catch (e) {
        addLog(`Action failed: ${(e as { message: string }).message}`, "error");
      }
    };

    process.stdin.on("keypress", handleKeypress);
    process.on("SIGINT", handleSigInt);
  });
}
