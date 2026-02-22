#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";
import pc from "picocolors";
import { auditCommand } from "./commands/audit.js";
import { callCommand } from "./commands/call.js";
import { certsCommand } from "./commands/certs.js";
import { fuzzCommand } from "./commands/fuzz.js";
import { generateCommand } from "./commands/generate.js";
import { initCommand } from "./commands/init.js";
import { loadTestCommand } from "./commands/load-test.js";
import { mockCommand } from "./commands/mock.js";
import { otaCommand } from "./commands/ota.js";
import { parseCommand } from "./commands/parse.js";
import { proxyCommand } from "./commands/proxy.js";
import { replayCommand } from "./commands/replay.js";
import { sdkCommand } from "./commands/sdk.js";
import { simulateCommand } from "./commands/simulate.js";
import { tailCommand } from "./commands/tail.js";
import { topCommand } from "./commands/top.js";
import { virtualStationCommand } from "./commands/virtual-station.js";
import { runDashboard } from "./dashboard.js";

// Get version from package.json safely
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let version = "1.0.0";
try {
  const pkgPath = join(__dirname, "../package.json");
  const pkgContent = readFileSync(pkgPath, "utf-8");
  version = JSON.parse(pkgContent).version;
} catch (_e) {
  // Ignore
}

const cli = cac("ocpp");

// ─── Command: generate ──────────────────────────────────────────────────────

cli
  .command(
    "generate",
    "Generate TypeScript declaration files from Custom JSON Schemas",
  )
  .option("-s, --schemas <dir>", "Directory containing JSON schema files")
  .option("-o, --out <dir>", "Output directory for the generated .d.ts files")
  .option(
    "-p, --protocol <name>",
    "Generate an index.ts mapping the schemas to an ocpp-ws-io protocol (e.g. vendor-proto)",
  )
  .action(generateCommand);

// ─── Command: init ─────────────────────────────────────────────────────────

cli
  .command("init [dir]", "Scaffold a new production-ready ocpp-ws-io project")
  .action(initCommand);

// ─── Command: simulate ─────────────────────────────────────────────────────

cli
  .command("simulate", "Interactive terminal-based Charge Point simulator")
  .option("-i, --identity <id>", "Identity of the simulated Charge Point", {
    default: "Simulated-CP-01",
  })
  .option("-e, --endpoint <ws>", "WebSocket endpoint of the CSMS server", {
    default: "ws://localhost:3000",
  })
  .option("-p, --protocol <ver>", "OCPP Protocol (e.g. ocpp1.6, ocpp2.0.1)", {
    default: "ocpp1.6",
  })
  .action(simulateCommand);

cli
  .command(
    "virtual-station",
    "Stateful, automated Virtual Charge Point simulator",
  )
  .option("-i, --identity <id>", "Identity of the simulated Charge Point", {
    default: "VS-001",
  })
  .option("-e, --endpoint <ws>", "WebSocket endpoint of the CSMS server", {
    default: "ws://localhost:3000",
  })
  .option(
    "-p, --protocol <ver>",
    "OCPP Protocol to simulate (e.g. ocpp1.6, ocpp2.0.1)",
    { default: "ocpp1.6" },
  )
  .action(virtualStationCommand);

cli
  .command("call <method> [payload]", "Send a one-off JSON payload to a CSMS")
  .option("-i, --identity <id>", "Identity of the Caller", {
    default: "CLI-Agent",
  })
  .option("-e, --endpoint <ws>", "Endpoint of the CSMS server", {
    default: "ws://localhost:3000",
  })
  .action(callCommand);

// ─── Commands: Advanced Modules (Stubs) ────────────────────────────────────

cli
  .command("load-test", "Distributed Load Testing Engine")
  .option("-e, --endpoint <ws>", "Target CSMS", {
    default: "ws://localhost:3000",
  })
  .option("-c, --clients <num>", "Concurrent connections", { default: 100 })
  .option("-r, --ramp-up <s|m>", "Seconds to ramp", { default: 10 })
  .action(loadTestCommand);

cli
  .command("top", "Live Cluster Dashboard (Redis TUI)")
  .option("-r, --redis <url>", "Redis connection URL", {
    default: "redis://localhost:6379",
  })
  .action(topCommand);

cli
  .command("tail", "WebSocket Network Sniffer / Stream Tailing")
  .option("-i, --identity <id>", "Filter by CP identity")
  .option("-m, --method <name>", "Filter by OCPP method")
  .option("-r, --redis <url>", "Redis connection URL", {
    default: "redis://localhost:6379",
  })
  .action(tailCommand);

cli
  .command("certs", "Local TLS Certificate Authority Manager")
  .option("-t, --type <ca|server|client>", "Type of certificate to generate", {
    default: "server",
  })
  .option("-i, --identity <id>", "Common Name identity (e.g. CP-001)")
  .option("-o, --out <dir>", "Output directory", { default: "./certs" })
  .action(certsCommand);

cli
  .command("mock", "Mock API Server Generator for Frontend Teams")
  .option("-p, --port <num>", "HTTP SSE port", { default: 8080 })
  .option("-r, --rate <ms>", "Event interval speed", { default: 1000 })
  .action(mockCommand);

cli
  .command("parse <payload>", "Payload Translator and Validater")
  .option("-p, --protocol <ver>", "OCPP Protocol (e.g. 1.6)")
  .option("-m, --method <name>", "Expected method context")
  .action(parseCommand);

cli
  .command("ota [dir]", "Local Firmware Hosting Server")
  .option("-p, --port <num>", "HTTP hosting port", { default: 4000 })
  .action(otaCommand);

cli
  .command("fuzz", "Protocol Fuzzing & Security Tester")
  .option("-e, --endpoint <ws>", "Target CSMS URL", {
    default: "ws://localhost:3000",
  })
  .option("-w, --workers <num>", "Concurrent attack threads", { default: 5 })
  .action(fuzzCommand);

cli
  .command("replay <file>", "Network Frame Replay Engine")
  .option("-t, --target <ws>", "Target CSMS URL", {
    default: "ws://localhost:3000",
  })
  .action(replayCommand);

// ─── Commands: Enterprise Expansion ─────────────────────────────────────────

cli
  .command("audit", "CSMS Compliance Auditor")
  .option("-e, --endpoint <ws>", "Target CSMS URL", {
    default: "ws://localhost:3000",
  })
  .option("-g, --generate-report", "Export results to Markdown")
  .action(auditCommand);

cli
  .command("proxy", "Reverse Proxy Interceptor (MITM)")
  .option("-l, --listen <num>", "Local WebSocket port", { default: 8080 })
  .option("-t, --target <ws>", "Remote target CSMS URL")
  .action(proxyCommand);

cli
  .command("sdk", "TypeScript API SDK Generator")
  .option("-s, --schemas <dir>", "JSON schemas folder", {
    default: "./schemas",
  })
  .option("-o, --out <path>", "Output TypeScript file path", {
    default: "./src/generated/sdk.ts",
  })
  .action(sdkCommand);

// ─── Help & Version ─────────────────────────────────────────────────────────

cli.help();
cli.version(version);

// ─── Global Error Handlers ──────────────────────────────────────────────────

function handleGlobalError(err: unknown) {
  console.error();
  console.error(pc.bgRed(pc.white(" ⚡ CRITICAL ERROR ")));
  console.error(pc.red("─".repeat(50)));

  if (err instanceof Error) {
    console.error(pc.red(`Message: ${err.message}`));
    if (err.stack) {
      console.error(pc.gray(err.stack.split("\n").slice(1).join("\n")));
    }
  } else {
    console.error(pc.red(String(err)));
  }

  console.error(pc.red("─".repeat(50)));
  process.exit(1);
}

process.on("unhandledRejection", handleGlobalError);
process.on("uncaughtException", handleGlobalError);

// ─── Executor ─────────────────────────────────────────────────────────────

async function main() {
  cli.help();
  cli.version(version);

  const parsed = cli.parse(process.argv, { run: false });

  // If no command is provided, launch the beautiful dashboard
  if (!cli.matchedCommandName && parsed.args.length === 0) {
    await runDashboard();
    return;
  }

  try {
    await cli.runMatchedCommand();
  } catch (err: any) {
    handleGlobalError(err);
  }
}

main();
