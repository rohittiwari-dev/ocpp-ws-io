import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { OCPPClient } from "ocpp-ws-io";
import pc from "picocolors";

export async function replayCommand(
  logFile: string,
  options: { target?: string },
) {
  console.clear();
  intro(pc.inverse(` ⚡ Network Frame Replay Engine `));

  if (!logFile) {
    log.error(pc.red(`Error: Please specify an incident log file.`));
    log.message(
      pc.gray(
        `Example: ocpp replay ./incidents/crash.json --target ws://localhost:3000`,
      ),
    );
    process.exit(1);
  }

  const targetUrl = options.target || "ws://localhost:3000";
  const filePath = resolve(process.cwd(), logFile);

  log.info(`Target CSMS:  ${pc.blue(targetUrl)}`);
  log.info(`Loading File: ${pc.bold(filePath)}`);

  let frames: any[] = [];
  try {
    const data = await fs.readFile(filePath, "utf-8");
    frames = JSON.parse(data);

    // Simplistic structure assumption for the sake of CLI demo:
    // [{ method: "...", delayMs: 100, payload: {...} }]
    if (!Array.isArray(frames))
      throw new Error("Log file must be a JSON array of event frames.");
  } catch (err: any) {
    log.error(pc.red(`Failed to parse replay file: ${err.message}`));
    process.exit(1);
  }

  log.success(pc.blue(`Loaded ${frames.length} frames for playback.`));

  const client = new OCPPClient({
    identity: `Replay-Agent`,
    endpoint: targetUrl,
    protocols: ["ocpp1.6"],
    reconnect: false,
    strictMode: false, // We need to ensure we can replay malformed payloads exactly as they were!
  });

  const replaySpinner = spinner();
  replaySpinner.start(pc.gray(`Connecting to target CSMS sandbox...`));

  client.on("open", async () => {
    replaySpinner.stop(
      pc.green(`Connected to CSMS. Beginning playback sequence...`),
    );

    for (const frame of frames) {
      const delayMs = frame.delayMs ?? frame.delay ?? 0;
      if (delayMs > 0) {
        log.step(pc.gray(`⏳ Waiting ${delayMs}ms...`));
        await new Promise((r) => setTimeout(r, delayMs));
      }

      try {
        log.message(
          pc.magenta(`→ Sending ${frame.method || "raw payload"}: `) +
            pc.gray(JSON.stringify(frame.payload)),
        );

        // Version-aware call per API; cast for malformed replay payloads
        const res = await client.call(
          "ocpp1.6",
          frame.method as any,
          frame.payload,
          { timeoutMs: 15000 },
        );
        log.success(pc.green(`  ← [OK] `) + pc.gray(JSON.stringify(res)));
      } catch (err: any) {
        log.error(pc.red(`  ← [ERROR] `) + pc.gray(err.message));
      }
    }

    outro(pc.cyan(`Playback sequence complete. ✨`));
    await new Promise((r) => setTimeout(r, 1000)); // drain
    await client.close();
    process.exit(0);
  });

  client.on("error", (err: any) => {
    replaySpinner.stop(pc.red(`Socket Error during playback.`));
    log.error(pc.red(err.message));
    process.exit(1);
  });

  client.connect();
}
