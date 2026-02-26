import pc from "picocolors";
import WebSocket from "ws";

// ── Types ──────────────────────────────────────────────────────

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export interface TestResult {
  name: string;
  passed: boolean;
  severity?: Severity;
  issue?: string;
  durationMs: number;
}

export interface TestContext {
  baseUrl: string;
  protocol: string;
}

export type CheckFn = (
  name: string,
  severity: Severity,
  fn: () => Promise<{ passed: boolean; issue?: string }>,
) => Promise<void>;

export interface TestSuite {
  name: string;
  id: string; // e.g. 'transport', 'rpc', 'security'
  run: (ctx: TestContext, check: CheckFn) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Open a WebSocket and wait for the "open" event.
 * Rejects on error or timeout.
 */
export function openWS(
  url: string,
  protocol?: string,
  timeoutMs = 5000,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = protocol ? new WebSocket(url, [protocol]) : new WebSocket(url);

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Connection timed out"));
    }, timeoutMs);

    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Wait for the next WebSocket message.
 */
export function waitForMessage(
  ws: WebSocket,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Message timeout"));
    }, timeoutMs);

    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

/**
 * Wait for a WebSocket close event.
 */
export function waitForClose(
  ws: WebSocket,
  timeoutMs = 5000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Close timeout"));
    }, timeoutMs);

    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason?.toString() ?? "" });
    });
  });
}

/**
 * Generate a simple unique ID for OCPP message IDs.
 */
export function uuid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Summary ────────────────────────────────────────────────────

export function printSummary(results: TestResult[]): void {
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  const issues = results.filter((r) => r.issue);

  console.log();

  // Score bar
  const total = results.length;
  const score = passed.length;
  const pct = Math.round((score / total) * 100);
  const barLen = 30;
  const filled = Math.round((score / total) * barLen);
  const bar =
    pc.green("█".repeat(filled)) + pc.dim("░".repeat(barLen - filled));

  console.log(`  ${bar} ${pc.bold(`${pct}%`)} (${score}/${total} passed)`);
  console.log();

  // Results table
  for (const r of results) {
    const icon = r.passed ? pc.green("✔") : pc.red("✖");
    const severity = r.severity
      ? r.passed
        ? pc.dim(`[${r.severity}]`)
        : severityColor(r.severity)(`[${r.severity}]`)
      : "";
    const duration = pc.dim(`${r.durationMs}ms`);
    console.log(`  ${icon} ${r.name} ${severity} ${duration}`);
    if (r.issue && !r.passed) {
      console.log(`    ${pc.dim("→")} ${pc.yellow(r.issue)}`);
    }
  }

  console.log();

  // Issue summary
  if (issues.length > 0 && failed.length > 0) {
    const high = failed.filter((r) => r.severity === "HIGH").length;
    const med = failed.filter((r) => r.severity === "MEDIUM").length;
    const low = failed.filter((r) => r.severity === "LOW").length;
    const parts: string[] = [];
    if (high) parts.push(pc.red(`${high} HIGH`));
    if (med) parts.push(pc.yellow(`${med} MEDIUM`));
    if (low) parts.push(pc.dim(`${low} LOW`));
    console.log(`  ⚠ ${parts.join(", ")} issue(s) found`);
    console.log();
  }
}

function severityColor(s: Severity) {
  switch (s) {
    case "HIGH":
      return pc.red;
    case "MEDIUM":
      return pc.yellow;
    case "LOW":
      return pc.dim;
  }
}
