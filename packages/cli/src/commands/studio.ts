import { exec } from "node:child_process";
import { platform } from "node:os";
import * as p from "@clack/prompts";
import pc from "picocolors";

const SIMULATOR_URL = "https://ocpp.rohittiwari.me";

export async function runStudio(): Promise<void> {
  console.clear();
  p.intro(
    pc.bgMagenta(pc.white(" 🖥️  OCPP STUDIO — Visual Charge Point Simulator ")),
  );

  p.log.message(
    pc.dim(
      `  Opens the hosted OCPP Visual Simulator at\n  ${pc.cyan(SIMULATOR_URL)}\n  No local setup required — runs entirely in the cloud.`,
    ),
  );

  const plat = platform();
  const cmd =
    plat === "win32"
      ? `start "" "${SIMULATOR_URL}"`
      : plat === "darwin"
        ? `open "${SIMULATOR_URL}"`
        : `xdg-open "${SIMULATOR_URL}"`;

  exec(cmd, (err) => {
    if (err) {
      p.log.warn(
        pc.yellow(
          `Could not open the browser automatically.\n  Visit ${pc.underline(pc.cyan(SIMULATOR_URL))} manually.`,
        ),
      );
    }
  });

  p.outro(
    pc.green("Launching OCPP Studio in your browser...") +
      `\n\n  ${pc.bold("→")} ${pc.underline(pc.cyan(SIMULATOR_URL))}\n`,
  );
}
