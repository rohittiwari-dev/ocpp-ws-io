import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { OCPPClient } from "ocpp-ws-io";
import pc from "picocolors";

export async function replayCommand(
  logFile: string,
  options: { target?: string },
) {
  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: Network Frame Replay Engine`));

  if (!logFile) {
    console.error(pc.red(`Error: Please specify an incident log file.`));
    console.log(
      pc.gray(
        `Example: ocpp replay ./incidents/crash.json --target ws://localhost:3000`,
      ),
    );
    process.exit(1);
  }

  const targetUrl = options.target || "ws://localhost:3000";
  const filePath = resolve(process.cwd(), logFile);

  console.log(pc.gray(`Loading frames: ${filePath}`));
  console.log(pc.gray(`Replay target:  ${targetUrl}\n`));

  let frames: any[] = [];
  try {
    const data = await fs.readFile(filePath, "utf-8");
    frames = JSON.parse(data);

    // Simplistic structure assumption for the sake of CLI demo:
    // [{ method: "...", delayMs: 100, payload: {...} }]
    if (!Array.isArray(frames))
      throw new Error("Log file must be a JSON array of event frames.");
  } catch (err: any) {
    console.error(pc.red(`Failed to parse replay file: ${err.message}`));
    process.exit(1);
  }

  console.log(pc.blue(`✔ Loaded ${frames.length} frames for playback.`));

  const client = new OCPPClient({
    identity: `Replay-Agent`,
    endpoint: targetUrl,
    protocols: ["ocpp1.6"],
    reconnect: false,
    strictMode: false, // We need to ensure we can replay malformed payloads exactly as they were!
  });

  client.on("open", async () => {
    console.log(
      pc.green(`✔ Connected to target CSMS sandbox. Beginning playback...\n`),
    );

    for (const frame of frames) {
      if (frame.delayMs) {
        console.log(pc.gray(`⏳ Waiting ${frame.delayMs}ms...`));
        await new Promise((r) => setTimeout(r, frame.delayMs));
      }

      try {
        console.log(
          pc.magenta(`→ Sending ${frame.method || "raw payload"}: `) +
            pc.gray(JSON.stringify(frame.payload)),
        );

        // Cast around strict types to allow sending potentially broken/malformed replay data directly
        client
          .call(frame.method as any, frame.payload)
          .then((res) => {
            console.log(pc.green(`  ← [OK] `) + pc.gray(JSON.stringify(res)));
          })
          .catch((err) => {
            console.log(pc.red(`  ← [ERROR] `) + pc.gray(err.message));
          });
      } catch (sendErr: any) {
        console.log(pc.red(`✖ Frame failed: ${sendErr.message}`));
      }
    }

    console.log(pc.cyan(`\n✨ Playback sequence complete.`));
    await new Promise((r) => setTimeout(r, 1000)); // drain
    client.close();
  });

  client.on("error", (err: any) => {
    console.log(pc.red(`\nSocket Error during playback: ${err.message}`));
  });

  client.connect();
}
