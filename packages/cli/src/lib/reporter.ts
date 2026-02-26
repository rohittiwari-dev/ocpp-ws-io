import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";

export interface ReportConfig {
  format?: "json" | "md" | "txt";
  dir?: string;
}

export interface ReportData {
  command: "load-test" | "fuzz" | "simulate" | "test";
  elapsedMs: number;
  metrics: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  messages?: unknown[];
  testResults?: {
    passed: boolean;
    name: string;
    severity?: string;
    issue?: string;
  }[];
  logs?: { msg: string; type: string; timestamp: string }[];
}

export async function generateReport(
  data: ReportData,
  config?: ReportConfig,
): Promise<string | null> {
  if (!config || !config.format) return null;

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = config.dir
      ? path.resolve(config.dir)
      : path.join(process.cwd(), "reports");

    const extension = config.format;
    const filename = `ocpp-${data.command}-report-${timestamp}.${extension}`;
    const targetPath = path.join(outDir, filename);

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    let content = "";

    if (config.format === "json") {
      content = JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          command: data.command,
          elapsedSeconds: +(data.elapsedMs / 1000).toFixed(2),
          metrics: data.metrics,
          metadata: data.metadata,
          messages: data.messages,
          testResults: data.testResults,
          logs: data.logs,
        },
        null,
        2,
      );
    } else if (config.format === "md" || config.format === "txt") {
      const isMd = config.format === "md";
      content = `${isMd ? "# " : ""}OCPP-WS-IO Execution Report
${isMd ? "**" : ""}Command Run:${isMd ? "**" : ""} ocpp ${data.command}
${isMd ? "**" : ""}Generated At:${isMd ? "**" : ""} ${new Date().toISOString()}
${isMd ? "**" : ""}Elapsed Time:${isMd ? "**" : ""} ${(
        data.elapsedMs / 1000
      ).toFixed(2)}s

${isMd ? "## " : ""}Metrics Overview
`;
      for (const [key, val] of Object.entries(data.metrics)) {
        content += `- ${isMd ? "**" : ""}${key}${isMd ? "**" : ""}: ${val}\n`;
      }

      if (data.metadata) {
        content += `\n${isMd ? "## " : ""}Metadata & Context\n`;
        for (const [key, val] of Object.entries(data.metadata)) {
          content += `- ${isMd ? "**" : ""}${key}${isMd ? "**" : ""}: ${val}\n`;
        }
      }

      if (data.testResults && data.testResults.length > 0) {
        content += `\n${isMd ? "## " : ""}Test Results\n`;
        if (isMd) {
          content += `| Status | Test Name | Severity | Issue |\n`;
          content += `|---|---|---|---|\n`;
          for (const res of data.testResults) {
            content += `| ${res.passed ? "✅ Pass" : "❌ Fail"} | ${
              res.name
            } | ${res.severity || "-"} | ${res.issue || "-"} |\n`;
          }
        } else {
          for (const res of data.testResults) {
            content += `[${res.passed ? "PASS" : "FAIL"}] ${
              res.name
            } (Severity: ${res.severity || "-"}) - ${res.issue || "-"}\n`;
          }
        }
      }

      if (data.logs && data.logs.length > 0) {
        content += `\n${isMd ? "## " : ""}Simulator Logs\n`;
        for (const log of data.logs) {
          content += `[${log.timestamp}] ${log.type.toUpperCase()}: ${
            log.msg
          }\n`;
        }
      }

      if (data.messages && data.messages.length > 0) {
        content += `\n${isMd ? "## " : ""}Message Trace (Last ${
          data.messages.length
        })\n`;
        for (const msg of data.messages) {
          content += `${isMd ? "```json\n" : ""}${JSON.stringify(
            msg,
            null,
            2,
          )}${isMd ? "\n```" : ""}\n\n`;
        }
      }
    }

    fs.writeFileSync(targetPath, content, "utf-8");
    console.log(
      `\n${pc.bgGreen(
        pc.white(" 📄 REPORT SAVED "),
      )} Successfully wrote ${pc.cyan(filename)}`,
    );
    return targetPath;
  } catch (err) {
    console.log(
      `\n${pc.bgRed(pc.white(" ERROR "))} Failed to write report: ${
        (err as Error).message
      }`,
    );
    return null;
  }
}
