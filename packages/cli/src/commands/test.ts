import * as p from "@clack/prompts";
import pc from "picocolors";
import { generateReport } from "../lib/reporter.js";
import {
  printSummary,
  type Severity,
  type TestResult,
  type TestSuite,
} from "../lib/test-runner.js";
import { chaosSuite } from "../tests/chaos.js";
import { rpcSuite } from "../tests/rpc.js";
import { securitySuite } from "../tests/security.js";
import { transportSuite } from "../tests/transport.js";

const AVAILABLE_SUITES: TestSuite[] = [
  transportSuite,
  rpcSuite,
  securitySuite,
  chaosSuite,
];

interface TestOptions {
  endpoint?: string;
  identity?: string;
  protocol?: string;
  suite?: string;
  report?: "json" | "md" | "txt";
  reportDir?: string;
}

export async function runTest(options: TestOptions): Promise<void> {
  p.intro(pc.bgMagenta(pc.white(" 🔍 OCPP Compliance Test Suite ")));

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
      initialValue: "CP001",
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
      message: "OCPP subprotocol to use for valid connections",
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

  let selectedSuites: TestSuite[] = [];
  if (options.suite) {
    if (options.suite === "all") {
      selectedSuites = AVAILABLE_SUITES;
    } else {
      const match = AVAILABLE_SUITES.find((s) => s.id === options.suite);
      if (!match) {
        p.log.error(`Unknown suite: ${options.suite}`);
        process.exit(1);
      }
      selectedSuites = [match];
    }
  } else {
    const result = await p.select({
      message: "Which test suite would you like to run?",
      options: [
        { value: "all", label: "All Suites" },
        ...AVAILABLE_SUITES.map((s) => ({ value: s.id, label: s.name })),
      ],
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }

    if (result === "all") {
      selectedSuites = AVAILABLE_SUITES;
    } else {
      selectedSuites = AVAILABLE_SUITES.filter((s) => s.id === result);
    }
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

  const baseUrl = `${endpoint}/${identity}`;

  p.log.info(
    `Testing ${pc.cyan(baseUrl)} with protocol ${pc.cyan(protocol)} (Suites: ${selectedSuites.map((s) => s.id).join(", ")})`,
  );

  // ── Test Execution ───────────────────────────────────────────

  const results: TestResult[] = [];

  async function check(
    name: string,
    severity: Severity,
    fn: () => Promise<{ passed: boolean; issue?: string }>,
  ): Promise<void> {
    const spinner = p.spinner();
    spinner.start(name);
    const start = Date.now();

    try {
      const result = await fn();
      const durationMs = Date.now() - start;

      results.push({
        name,
        passed: result.passed,
        severity,
        issue: result.issue,
        durationMs,
      });

      if (result.passed) {
        spinner.stop(`${pc.green("✔")} ${name}`);
      } else {
        spinner.stop(`${pc.red("✖")} ${name}`);
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      results.push({
        name,
        passed: false,
        severity,
        issue: `Unexpected error: ${(err as Error).message}`,
        durationMs,
      });
      spinner.stop(`${pc.red("✖")} ${name}`);
    }
  }

  const ctx = { baseUrl, protocol };

  for (const suite of selectedSuites) {
    p.note("", pc.bold(pc.magenta(`Suite: ${suite.name}`)));
    await suite.run(ctx, check);
  }

  // ── Summary ──────────────────────────────────────────────────

  printSummary(results);

  const passed = results.filter((r) => r.passed).length;
  const failedHigh = results.filter((r) => !r.passed && r.severity === "HIGH");

  if (options.report) {
    const totalDuration = results.reduce((acc, r) => acc + r.durationMs, 0);
    await generateReport(
      {
        command: "test",
        elapsedMs: totalDuration,
        metrics: {
          totalTestsRun: results.length,
          testsPassed: passed,
          testsFailed: results.length - passed,
          highSeverityFailures: failedHigh.length,
        },
        metadata: {
          endpoint,
          identity,
          protocol,
          suitesRun: selectedSuites.map((s) => s.id).join(", "),
        },
        testResults: results,
      },
      { format: options.report, dir: options.reportDir },
    );
  }

  p.outro(
    failedHigh.length > 0
      ? pc.red(`${failedHigh.length} critical issue(s) found`)
      : pc.green("✔ All compliance checks passed!"),
  );
}
