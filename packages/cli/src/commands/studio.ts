import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";

const SIMULATOR_REPO =
  "https://github.com/rohittiwari-dev/ocpp-ws-simulator.git";
const SIMULATOR_REPO_SHORT = "rohittiwari-dev/ocpp-ws-simulator";

export interface StudioOptions {
  dir?: string;
  skipInstall?: boolean;
  skipDev?: boolean;
}

export async function runStudio(options: StudioOptions = {}): Promise<void> {
  console.clear();
  p.intro(
    pc.bgMagenta(pc.white(" 🖥️  OCPP STUDIO — Visual Charge Point Simulator ")),
  );

  p.log.message(
    pc.dim(
      `  Fetches ${pc.cyan(
        SIMULATOR_REPO_SHORT,
      )} and starts the Next.js dev server.\n  No monorepo setup required — completely standalone.`,
    ),
  );

  // ── Check git is available ────────────────────────────────────
  try {
    execSync("git --version", { stdio: "ignore" });
  } catch (_err) {
    p.log.error("Git is not installed or not in your PATH.");
    p.log.error(
      pc.dim("Install Git from https://git-scm.com/downloads and try again."),
    );
    p.outro(pc.red("Aborted."));
    return;
  }

  // ── Target directory ──────────────────────────────────────────
  let targetDir: string;
  if (options.dir) {
    targetDir = options.dir;
  } else {
    const result = await p.text({
      message: "Where should we clone the simulator?",
      initialValue: "./ocpp-ws-simulator",
      validate: (val) => {
        if (!val?.trim()) return "Directory path is required";
      },
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    targetDir = result as string;
  }

  const absDir = path.resolve(process.cwd(), targetDir);

  // ── Guard: already exists ─────────────────────────────────────
  if (fs.existsSync(absDir)) {
    const entries = fs.readdirSync(absDir);
    if (entries.length > 0) {
      // Directory exists and is non-empty — check if it looks like the simulator
      const isSimulator =
        fs.existsSync(path.join(absDir, "package.json")) &&
        fs.existsSync(path.join(absDir, "next.config.ts"));

      if (isSimulator) {
        p.log.warn(
          `${pc.yellow(
            absDir,
          )} already contains the simulator — skipping clone.`,
        );
      } else {
        p.log.error(
          `${pc.red(
            absDir,
          )} exists and is not empty. Choose a different directory.`,
        );
        p.outro(pc.red("Aborted."));
        return;
      }
    } else {
      // Empty dir — clone into it
      await cloneRepo(absDir);
    }
  } else {
    await cloneRepo(absDir);
  }

  // ── npm install ───────────────────────────────────────────────
  if (!options.skipInstall) {
    p.log.message(pc.cyan("Installing dependencies..."));
    try {
      execSync("npm install", { cwd: absDir, stdio: "inherit" });
      p.log.success(pc.green("Dependencies installed."));
    } catch {
      p.log.error(pc.red("npm install failed."));
      p.outro(pc.red("Aborted."));
      return;
    }
  }

  // ── .env hint ────────────────────────────────────────────────
  const envExample = path.join(absDir, ".env.example");
  const envFile = path.join(absDir, ".env");
  if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
    p.note(
      `Copy ${pc.cyan(".env.example")} → ${pc.cyan(
        ".env",
      )} to configure auth:\n` +
        pc.dim(`  cd ${targetDir} && cp .env.example .env`),
      "Optional: Authentication",
    );
  }

  // ── Start dev server ──────────────────────────────────────────
  let startNow: boolean;
  if (options.skipDev) {
    startNow = false;
  } else {
    const result = await p.confirm({
      message: "Start the dev server now?",
      initialValue: true,
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    startNow = result as boolean;
  }

  if (!startNow) {
    p.outro(
      pc.green("All set! Run the simulator anytime with:") +
        `\n\n  ${pc.cyan(`cd ${targetDir} && npm run dev`)}\n\n` +
        `  Then open ${pc.underline("http://localhost:3000")} in your browser.`,
    );
    return;
  }

  p.outro(
    pc.green("Starting OCPP Studio...") +
      `\n\n  ${pc.bold("→")} Open ${pc.underline(
        pc.cyan("http://localhost:3000"),
      )} in your browser.\n` +
      `  ${pc.dim("Press Ctrl+C to stop the server.")}\n`,
  );

  // Spawn dev server — attached, inherits stdio so Next.js output streams live
  const devProcess = spawn("npm", ["run", "dev"], {
    cwd: absDir,
    stdio: "inherit",
    shell: true,
  });

  // Forward SIGINT so Ctrl+C cleans up Next.js properly
  process.on("SIGINT", () => {
    devProcess.kill("SIGINT");
    process.exit(0);
  });

  await new Promise<void>((resolve) => {
    devProcess.on("close", () => resolve());
  });
}

// ── Helpers ───────────────────────────────────────────────────

async function cloneRepo(absDir: string): Promise<void> {
  p.log.message(pc.cyan(`Cloning ${SIMULATOR_REPO_SHORT}...`));
  try {
    execSync(`git clone --depth 1 ${SIMULATOR_REPO} "${absDir}"`, {
      stdio: "inherit",
    });
    p.log.success(pc.green(`Cloned into ${pc.cyan(absDir)}`));
  } catch (err) {
    p.log.error(pc.red("git clone failed."));
    p.log.error((err as Error).message);
    p.log.error(
      pc.dim("Make sure you have internet access and Git installed."),
    );
    p.outro(pc.red("Aborted."));
    throw err; // bubble up so caller can return
  }
}
