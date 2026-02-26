#!/usr/bin/env node
import { createRequire } from "node:module";
import * as p from "@clack/prompts";
import cacModule from "cac";
import { runAudit } from "./commands/audit.js";
import { runCerts } from "./commands/certs.js";
import { runFuzz } from "./commands/fuzz.js";
import { runGenerate } from "./commands/generate.js";
import { runLoadTest } from "./commands/load-test.js";
import { runMock } from "./commands/mock.js";
import { runSimulate } from "./commands/simulate.js";
import { runTest } from "./commands/test.js";
import { printBanner } from "./lib/banner.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

// Handle CJS/ESM interop — cac may export as { default: fn } or fn
const cac = typeof cacModule === "function" ? cacModule : cacModule?.default;
const cli = cac("ocpp");

// ── Banner ─────────────────────────────────────────────────────

cli.command("", "Interactive Menu").action(async () => {
  printBanner(pkg.version);

  async function mainMenu() {
    while (true) {
      const command = await p.select({
        message: "What would you like to do?",
        options: [
          {
            value: "test",
            label: "Run OCTT Compliance Tests",
            hint: "ocpp test",
          },
          {
            value: "audit",
            label: "Production Security Audit",
            hint: "ocpp audit",
          },
          {
            value: "generate",
            label: "Generate Types from Schema",
            hint: "ocpp generate",
          },
          {
            value: "mock",
            label: "Run Mock SSE Server",
            hint: "ocpp mock",
          },
          {
            value: "certs",
            label: "Generate TLS/mTLS Certificates",
            hint: "ocpp certs",
          },
          {
            value: "simulate",
            label: "Run Stateful Charge Point Simulator",
            hint: "ocpp simulate",
          },
          {
            value: "load-test",
            label: "Distributed Load Testing Engine",
            hint: "ocpp load-test",
          },
          {
            value: "fuzz",
            label: "Protocol Chaos Engine (Fuzzer)",
            hint: "ocpp fuzz",
          },
          {
            value: "quit",
            label: "Quit",
          },
        ],
      });

      if (p.isCancel(command) || command === "quit") {
        p.outro("Goodbye!");
        process.exit(0);
      }

      if (command === "test") {
        await runTest({});
      } else if (command === "audit") {
        await runAudit();
      } else if (command === "mock") {
        await runMock();
      } else if (command === "certs") {
        await runCerts();
      } else if (command === "simulate") {
        await runSimulate({});
      } else if (command === "load-test") {
        await runLoadTest({});
      } else if (command === "fuzz") {
        await runFuzz({});
      } else if (command === "generate") {
        await runGenerate({});
      }

      console.log("\n"); // Add some spacing before re-rendering the menu
    }
  }

  await mainMenu();
});

// ── Generate Command ───────────────────────────────────────────

cli
  .command("generate", "Generate TypeScript types from an OCPP JSON schema")
  .option("-s, --schema <url>", "Schema URL or local file path")
  .option("-n, --name <protocol>", "Subprotocol name (e.g. my-custom-protocol)")
  .option("-o, --out <dir>", "Output directory (default: ./@types/ocpp-ws-io)")
  .example("  ocpp generate")
  .example("  ocpp generate --schema ./my-schema.json --name my-protocol")
  .example(
    "  ocpp generate --schema https://ocpp-ws-io.rohittiwari.me/schema-example.json",
  )
  .action(async (options: { schema: string; name: string; out: string }) => {
    printBanner(pkg.version);
    await runGenerate({
      schema: options.schema || undefined,
      name: options.name || undefined,
      out: options.out || undefined,
    });
  });

// ── Test Command ───────────────────────────────────────────────

cli
  .command("test", "Run OCTT compliance tests against a running OCPP server")
  .option(
    "-e, --endpoint <url>",
    "WebSocket endpoint (e.g. ws://localhost:5000/ocpp)",
  )
  .option("-i, --identity <id>", "Charge point identity (default: CP001)")
  .option("-p, --protocol <proto>", "OCPP subprotocol (default: ocpp1.6)")
  .option("--suite <name>", "Test suite: all, transport, rpc, security, chaos")
  .option("--report <format>", "Export results to file (json | md | txt)")
  .option("--report-dir <dir>", "Custom directory to save the report")
  .example("  ocpp test")
  .example("  ocpp test --endpoint ws://localhost:5000/ocpp --suite rpc")
  .example("  ocpp test -e ws://localhost:5000/ocpp -p ocpp2.0.1 --report json")
  .action(
    async (options: {
      endpoint: string;
      identity: string;
      protocol: string;
      suite: string;
      report?: "json" | "md" | "txt";
      reportDir?: string;
    }) => {
      printBanner(pkg.version);
      await runTest({
        endpoint: options.endpoint || undefined,
        identity: options.identity || undefined,
        protocol: options.protocol || undefined,
        suite: options.suite || undefined,
        report: options.report,
        reportDir: options.reportDir,
      });
    },
  );

// ── Audit Command ──────────────────────────────────────────────

cli
  .command("audit", "Run the interactive production auditing wizard")
  .option(
    "-e, --endpoint <url>",
    "WebSocket endpoint (e.g. ws://localhost:5000/ocpp)",
  )
  .option("-i, --identity <id>", "Charge point identity (default: CP001)")
  .option("-p, --protocol <proto>", "OCPP subprotocol (default: ocpp1.6)")
  .example("  ocpp audit -e ws://localhost:5000/ocpp")
  .action(
    async (options: {
      endpoint?: string;
      identity?: string;
      protocol?: string;
    }) => {
      printBanner(pkg.version);
      await runAudit({
        endpoint: options.endpoint,
        identity: options.identity,
        protocol: options.protocol,
      });
    },
  );

// ── Mock Server Command ────────────────────────────────────────

cli
  .command(
    "mock",
    "Run an HTTP Server-Sent Events (SSE) stream of mock OCPP data",
  )
  .option("-p, --port <port>", "Port to run the server on (default: 8080)")
  .option("-r, --rate <rate>", "Event generation rate in ms (default: 500)")
  .example("  ocpp mock --port 8080 --rate 500")
  .action(async (options: { port?: string; rate?: string }) => {
    printBanner(pkg.version);
    const port = options.port ? parseInt(options.port, 10) : undefined;
    const rate = options.rate ? parseInt(options.rate, 10) : undefined;
    await runMock({ port, rate });
  });

// ── Certs Command ──────────────────────────────────────────────

cli
  .command("certs", "Generate local TLS/mTLS certificates using OpenSSL")
  .option("-t, --type <type>", "Type of cert to generate: ca | server | client")
  .option(
    "-i, --identity <id>",
    "Identity / Common Name (CN) for the certificate",
  )
  .option(
    "-o, --out <dir>",
    "Output directory for the certificates (default: ./certs)",
  )
  .example("  ocpp certs --type ca")
  .example("  ocpp certs --type server --identity localhost")
  .example("  ocpp certs --type client --identity CP-001")
  .action(
    async (options: {
      type?: "ca" | "server" | "client";
      identity?: string;
      out?: string;
    }) => {
      printBanner(pkg.version);
      await runCerts({
        type: options.type,
        identity: options.identity,
        out: options.out,
      });
    },
  );

// ── Simulate Command ───────────────────────────────────────────

cli
  .command("simulate", "Run an interactive, automated Charge Point Simulator")
  .option(
    "-e, --endpoint <url>",
    "WebSocket endpoint (e.g. ws://localhost:5000/ocpp)",
  )
  .option(
    "-i, --identity <id>",
    "Charge point identity (default: Simulator001)",
  )
  .option("-p, --protocol <proto>", "OCPP subprotocol (default: ocpp1.6)")
  .option("--report <format>", "Export metrics on exit (json | md | txt)")
  .option("--report-dir <dir>", "Custom directory to save the report")
  .example("  ocpp simulate -e ws://localhost:5000/ocpp -i SIM001")
  .action(
    async (options: {
      endpoint?: string;
      identity?: string;
      protocol?: string;
      report?: "json" | "md" | "txt";
      reportDir?: string;
    }) => {
      printBanner(pkg.version);
      await runSimulate({
        endpoint: options.endpoint,
        identity: options.identity,
        protocol: options.protocol,
        report: options.report,
        reportDir: options.reportDir,
      });
    },
  );

// ── Load Test Command ──────────────────────────────────────────

cli
  .command(
    "load-test",
    "A distributed load testing engine capable of simulating thousands of concurrent Charge Point connections",
  )
  .option(
    "-e, --endpoint <url>",
    "The WebSocket URL of your CSMS server. (default: ws://localhost:3000)",
  )
  .option(
    "-c, --clients <num>",
    "Number of concurrent simulated clients. (default: 100)",
  )
  .option(
    "-r, --ramp-up <seconds>",
    "Time in seconds to ramp up connections (staggered connect). (default: 10)",
  )
  .option("--report <format>", "Export load test statistics (json | md | txt)")
  .option("--report-dir <dir>", "Custom directory to save the report")
  .example("  ocpp load-test -e ws://localhost:5000/ocpp -c 1000 -r 20")
  .action(
    async (options: {
      endpoint?: string;
      clients?: number;
      rampUp?: number; // camelCase due to cac parsing `--ramp-up`
      report?: "json" | "md" | "txt";
      reportDir?: string;
    }) => {
      printBanner(pkg.version);
      await runLoadTest({
        endpoint: options.endpoint,
        clients: options.clients,
        rampUp: options.rampUp,
        report: options.report,
        reportDir: options.reportDir,
      });
    },
  );

// ── Fuzz Command ───────────────────────────────────────────────

cli
  .command(
    "fuzz",
    "A protocol fuzzer that sends malformed, invalid, or unexpected payloads",
  )
  .option(
    "-e, --endpoint <url>",
    "The WebSocket URL of your CSMS server. (default: ws://localhost:3000)",
  )
  .option(
    "-w, --workers <num>",
    "Number of concurrent fuzzing worker threads. (default: 5)",
  )
  .option("-f, --flood", "Enable Flood Mode (Blast anomalies with 0ms delay)")
  .option("--report <format>", "Export chaos engine results (json | md | txt)")
  .option("--report-dir <dir>", "Custom directory to save the report")
  .example("  ocpp fuzz -e ws://localhost:5000/ocpp -w 10 --flood")
  .action(
    async (options: {
      endpoint?: string;
      workers?: number;
      flood?: boolean;
      report?: "json" | "md" | "txt";
      reportDir?: string;
    }) => {
      printBanner(pkg.version);
      await runFuzz({
        endpoint: options.endpoint,
        workers: options.workers,
        flood: options.flood,
        report: options.report,
        reportDir: options.reportDir,
      });
    },
  );

// ── Parse & Run ────────────────────────────────────────────────

cli.help();
cli.version(pkg.version);

cli.parse();
