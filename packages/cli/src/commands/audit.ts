import fs from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { TestResult } from "../lib/test-runner.js";
import { chaosSuite } from "../tests/chaos.js";
import { rpcSuite } from "../tests/rpc.js";
import { securitySuite } from "../tests/security.js";
import { transportSuite } from "../tests/transport.js";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface Checkpoint {
  id: string;
  desc: string;
  severity: Severity;
  autoTest?: string;
}

interface Domain {
  id: string;
  title: string;
  points: Checkpoint[];
}

const AUDIT_DOMAINS: Domain[] = [
  {
    id: "sec_arch",
    title: "§1 Security Architecture",
    points: [
      {
        id: "1.1.1",
        desc: "Threat model document exists and is < 12 months old",
        severity: "HIGH",
      },
      {
        id: "1.1.2",
        desc: "STRIDE analysis performed for OCPP WebSocket ingress",
        severity: "HIGH",
      },
      {
        id: "1.2.1",
        desc: "OCPP WebSocket port (443/wss) is the ONLY exposed port externally",
        severity: "HIGH",
      },
      {
        id: "1.2.2",
        desc: "Redis / database ports are NOT exposed to public internet",
        severity: "CRITICAL",
      },
      {
        id: "1.3.1",
        desc: "npm audit run in CI — zero CRITICAL/HIGH CVEs in production deps",
        severity: "CRITICAL",
      },
    ],
  },
  {
    id: "tls_cert",
    title: "§2 TLS & Certificate Lifecycle",
    points: [
      {
        id: "2.1.1",
        desc: "TLS 1.2 minimum enforced — TLS 1.0 / 1.1 disabled",
        severity: "CRITICAL",
      },
      {
        id: "2.1.2",
        desc: "Weak cipher suites disabled (RC4, DES, 3DES, EXPORT, NULL)",
        severity: "CRITICAL",
      },
      {
        id: "2.2.1",
        desc: "Certificate expiry monitored — alert at 30 days, critical at 7 days",
        severity: "CRITICAL",
      },
      {
        id: "2.2.2",
        desc: "Certificate private key is stored in secrets manager",
        severity: "CRITICAL",
      },
      {
        id: "2.4.1",
        desc: "CRL or OCSP revocation checked for mTLS CP certificates on connect",
        severity: "CRITICAL",
      },
    ],
  },
  {
    id: "auth_id",
    title: "§3 Authentication & Identity",
    points: [
      {
        id: "3.1.1",
        desc: "Every CP connection goes through server.auth() — no anonymous",
        severity: "CRITICAL",
      },
      {
        id: "3.1.2",
        desc: "CP passwords stored with bcrypt/argon2 — never plaintext",
        severity: "CRITICAL",
      },
      {
        id: "3.2.1",
        desc: "Authorize response validates token against live whitelist or OCPI",
        severity: "CRITICAL",
      },
      {
        id: "3.2.2",
        desc: "Blocked / expired / invalid tokens return correct status — not 'Accepted'",
        severity: "CRITICAL",
      },
      {
        id: "3.3.1",
        desc: "Session data from ctx.accept({session}) not accessible to other CPs",
        severity: "CRITICAL",
      },
    ],
  },
  {
    id: "msg_integrity",
    title: "§4 OCPP Message Integrity",
    points: [
      {
        id: "4.1.1",
        desc: "Malformed JSON does not crash the process — caught and CallError returned",
        severity: "CRITICAL",
        autoTest: "Server handles malformed JSON gracefully",
      },
      {
        id: "4.2.1",
        desc: "Every StartTransaction.req produces a unique transactionId",
        severity: "CRITICAL",
      },
      {
        id: "4.2.2",
        desc: "Every StopTransaction.req references a valid, open transactionId",
        severity: "CRITICAL",
      },
      {
        id: "4.3.1",
        desc: "TransactionEvent seqNo is monotonically increasing per transactionId",
        severity: "CRITICAL",
      },
      {
        id: "4.5.1",
        desc: "Duplicate transactionId across different reconnect cycles detected and rejected",
        severity: "CRITICAL",
      },
      {
        id: "4.6.1",
        desc: "Server rejects invalid message type",
        severity: "HIGH",
        autoTest: "Server rejects invalid message type",
      },
      {
        id: "4.6.2",
        desc: "Server rejects unknown action (NotImplemented)",
        severity: "HIGH",
        autoTest: "Server rejects unknown action (NotImplemented)",
      },
      {
        id: "4.6.3",
        desc: "Server enforces MessageId is a string",
        severity: "MEDIUM",
        autoTest: "Server enforces MessageId is a string",
      },
      {
        id: "4.6.4",
        desc: "Server ignores unmatched CALLRESULT gracefully",
        severity: "LOW",
        autoTest: "Server ignores unmatched CALLRESULT gracefully",
      },
      {
        id: "4.6.5",
        desc: "Server rejects missing payload in CALL",
        severity: "MEDIUM",
        autoTest: "Server rejects missing payload in CALL",
      },
      {
        id: "4.6.6",
        desc: "Server rejects non-object payload in CALL",
        severity: "HIGH",
        autoTest: "Server rejects non-object payload in CALL",
      },
    ],
  },
  {
    id: "data_billing",
    title: "§5 Data Integrity & Billing",
    points: [
      {
        id: "5.1.1",
        desc: "Every MeterValues.req persisted to database before responding",
        severity: "CRITICAL",
      },
      {
        id: "5.1.2",
        desc: "meterStart and meterStop are source-of-truth — not calculated from MeterValues",
        severity: "CRITICAL",
      },
      {
        id: "5.2.1",
        desc: "Daily reconciliation job sums all session energy == sum of meterStop - meterStart",
        severity: "CRITICAL",
      },
      {
        id: "5.2.2",
        desc: "Duplicate transaction billing detection schema in place",
        severity: "CRITICAL",
      },
    ],
  },
  {
    id: "infra_scaling",
    title: "§6 Infrastructure & Scaling",
    points: [
      {
        id: "6.1.1",
        desc: "Redis is NOT exposed on a public interface",
        severity: "CRITICAL",
      },
      {
        id: "6.1.2",
        desc: "Redis AUTH password configured — default no-auth mode disabled",
        severity: "CRITICAL",
      },
      {
        id: "6.2.1",
        desc: "DB not directly reachable from the public internet",
        severity: "CRITICAL",
      },
      {
        id: "6.2.2",
        desc: "Transactions table has insert-only policy — no DELETE of billing records",
        severity: "CRITICAL",
      },
      {
        id: "6.3.1",
        desc: "Secrets injected via Kubernetes Secrets or Vault — not baked into container",
        severity: "CRITICAL",
      },
      {
        id: "6.4.1",
        desc: "Server survives thundering herd (50 concurrent connects)",
        severity: "HIGH",
        autoTest: "Server survives thundering herd (50 concurrent connects)",
      },
      {
        id: "6.4.2",
        desc: "Server handles abrupt TCP disconnect mid-message",
        severity: "MEDIUM",
        autoTest: "Server handles abrupt TCP disconnect mid-message",
      },
    ],
  },
  {
    id: "code_review",
    title: "§7 Code-Level Review Criteria",
    points: [
      {
        id: "7.1.1",
        desc: "Every .handle() callback wrapped in try/catch — no unhandled throws crash server",
        severity: "CRITICAL",
      },
      {
        id: "7.1.2",
        desc: "Database writes inside handlers are awaited — no fire-and-forget DB writes",
        severity: "CRITICAL",
      },
      {
        id: "7.2.1",
        desc: "Event listeners removed on disconnect — no .on() accumulation per session",
        severity: "CRITICAL",
      },
      {
        id: "7.3.1",
        desc: "No shared mutable state across concurrent CP connections",
        severity: "CRITICAL",
      },
      {
        id: "7.3.2",
        desc: "No unhandled promise rejections — caught and logged",
        severity: "CRITICAL",
      },
    ],
  },
  {
    id: "compliance",
    title: "§8 Compliance & Regulatory",
    points: [
      {
        id: "8.1.1",
        desc: "Data Processing Agreement (DPA) signed with all sub-processors",
        severity: "CRITICAL",
      },
      {
        id: "8.2.1",
        desc: "CP hardware carries a legally calibrated meter (PTB / MID approved) if EU",
        severity: "CRITICAL",
      },
      {
        id: "8.3.1",
        desc: "CSMS is NOT in PCI scope — payment tokenization happens at PSP layer",
        severity: "CRITICAL",
      },
    ],
  },
  {
    id: "ops_audit",
    title: "§9 Operational Audit",
    points: [
      {
        id: "9.1.1",
        desc: "All security events logged with timestamp, identity, IP, event type",
        severity: "CRITICAL",
      },
      {
        id: "9.1.2",
        desc: "Log retention: billing-related logs retained >= statutory requirement",
        severity: "CRITICAL",
      },
      {
        id: "9.2.1",
        desc: "Alert: Any CRITICAL security event (tamper, replay, invalid firmware)",
        severity: "CRITICAL",
      },
      {
        id: "9.3.1",
        desc: "Server rejects deeply nested JSON objects",
        severity: "HIGH",
        autoTest: "Server rejects deeply nested JSON objects",
      },
      {
        id: "9.3.2",
        desc: "Server withstands massive JSON arrays",
        severity: "HIGH",
        autoTest: "Server withstands massive JSON arrays",
      },
      {
        id: "9.3.3",
        desc: "Server handles Null Byte injection gracefully",
        severity: "MEDIUM",
        autoTest: "Server handles Null Byte injection gracefully",
      },
      {
        id: "9.3.4",
        desc: "Server survives rapid heartbeat flood",
        severity: "HIGH",
        autoTest: "Server survives rapid heartbeat flood",
      },
    ],
  },
  {
    id: "tenant_iso",
    title: "§10 Multi-Tenant Isolation (If Applicable)",
    points: [
      {
        id: "10.1.1",
        desc: "Every DB query scoped to tenantId",
        severity: "CRITICAL",
      },
      {
        id: "10.1.2",
        desc: "Tenant ID cannot be overridden by CP identity string",
        severity: "CRITICAL",
      },
      {
        id: "10.2.1",
        desc: "All management API endpoints require valid JWT with tenantId claim",
        severity: "CRITICAL",
      },
    ],
  },
  {
    id: "incident_resp",
    title: "§11 Incident Response Readiness",
    points: [
      {
        id: "11.2.1",
        desc: "Able to determine exact sequence of events for any disputed transaction",
        severity: "CRITICAL",
      },
    ],
  },
];

type Answer = "PASS" | "FAIL" | "NA";

export interface AuditOptions {
  endpoint?: string;
  identity?: string;
  protocol?: string;
}

export async function runAudit(options: AuditOptions = {}): Promise<void> {
  p.intro(pc.bgBlue(pc.white(" 🛡️ OCPP Production Auditor ")));

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

  const baseUrl = `${endpoint}/${identity}`;

  const domainSelection = await p.multiselect({
    message:
      "Select audit domains to cover (Space to select, Enter to confirm):",
    options: AUDIT_DOMAINS.map((d) => ({ value: d.id, label: d.title })),
    required: true,
  });

  if (p.isCancel(domainSelection)) {
    p.cancel("Audit cancelled.");
    return;
  }

  const selectedDomainIds = domainSelection as string[];
  const domainsToAudit = AUDIT_DOMAINS.filter((d) =>
    selectedDomainIds.includes(d.id),
  );

  // ── Automated Testing ────────────────────────────────────────

  const autoSpinner = p.spinner();
  autoSpinner.start(
    "Running automated Security, Chaos, RPC, and Transport checks...",
  );

  const autoResults: TestResult[] = [];
  const suitesToRun = [transportSuite, rpcSuite, securitySuite, chaosSuite];

  for (const suite of suitesToRun) {
    await suite.run({ baseUrl, protocol }, async (name, severity, fn) => {
      try {
        const res = await fn();
        autoResults.push({
          name,
          passed: res.passed,
          severity,
          issue: res.issue,
          durationMs: 0,
        });
      } catch (err) {
        autoResults.push({
          name,
          passed: false,
          severity,
          issue: (err as Error).message,
          durationMs: 0,
        });
      }
    });
  }

  autoSpinner.stop(pc.green("✔ Automated checks complete"));

  const answers: Record<string, Answer> = {};

  for (const domain of domainsToAudit) {
    p.note("", pc.bold(pc.blue(domain.title)));

    for (const point of domain.points) {
      if (point.autoTest) {
        const autoRes = autoResults.find((r) => r.name === point.autoTest);
        if (autoRes) {
          answers[point.id] = autoRes.passed ? "PASS" : "FAIL";
          const resColor = autoRes.passed ? pc.green : pc.red;
          const status = autoRes.passed ? "PASS" : "FAIL";
          p.log.step(`${pc.dim("[AUTO]")} ${point.desc} — ${resColor(status)}`);
          continue;
        }
      }

      let color = pc.green;
      if (point.severity === "CRITICAL") color = pc.red;
      if (point.severity === "HIGH") color = pc.yellow;

      const answer = await p.select({
        message: `${color(`[${point.severity}]`)} ${point.desc}`,
        options: [
          { value: "PASS", label: "PASS" },
          { value: "FAIL", label: "FAIL" },
          { value: "NA", label: "N/A" },
        ],
      });

      if (p.isCancel(answer)) {
        p.cancel("Audit cancelled mid-way.");
        return;
      }

      answers[point.id] = answer as Answer;
    }
  }

  // Generate Report
  const s = p.spinner();
  s.start("Generating compliance report...");

  let reportMd = `# OCPP Production Audit Report\n\n`;
  reportMd += `Generated: ${new Date().toISOString()}\n\n`;
  reportMd += `## Executive Summary\n\n`;

  let totalCriticalFails = 0;
  let _totalHighFails = 0;

  for (const domain of domainsToAudit) {
    reportMd += `### ${domain.title}\n\n`;
    reportMd += `| ID | Severity | Checkpoint | Result |\n`;
    reportMd += `|---|---|---|---|\n`;

    for (const point of domain.points) {
      const result = answers[point.id];
      const emoji = result === "PASS" ? "✅" : result === "FAIL" ? "❌" : "⏭️";

      reportMd += `| ${point.id} | ${point.severity} | ${point.desc} | ${emoji} ${result} |\n`;

      if (result === "FAIL") {
        if (point.severity === "CRITICAL") totalCriticalFails++;
        if (point.severity === "HIGH") _totalHighFails++;
      }
    }
    reportMd += `\n`;
  }

  reportMd += `## Conclusion\n\n`;
  if (totalCriticalFails > 0) {
    reportMd += `**🚨 SYSTEM IS NOT PRODUCTION READY.**\n\nThere are **${totalCriticalFails} CRITICAL** failures that must be mitigated before go-live.\n`;
  } else {
    reportMd += `**✅ SYSTEM APPROVED FOR PRODUCTION.**\n\nZero CRITICAL failures detected.\n`;
  }

  const outPath = path.resolve(process.cwd(), "audit-report.md");
  await fs.writeFile(outPath, reportMd, "utf-8");

  s.stop(pc.green(`Report saved to ${outPath}`));

  p.outro(
    totalCriticalFails > 0
      ? pc.red(
          `Audit complete! ${totalCriticalFails} CRITICAL failures found. Check audit-report.md`,
        )
      : pc.green(`Audit complete! You are production ready!`),
  );
}
