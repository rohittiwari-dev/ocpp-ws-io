import * as readline from "node:readline/promises";
import { OCPPClient } from "ocpp-ws-io";
import pc from "picocolors";

export async function simulateCommand(options: {
  identity?: string;
  endpoint?: string;
}) {
  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: Interactive Simulator\n`));
  const id = options.identity || "Simulated-CP-01";

  let wsUrl: URL;
  try {
    wsUrl = new URL(options.endpoint || "ws://localhost:3000");
  } catch (_err) {
    console.error(pc.red(`Error: Invalid endpoint URL '${options.endpoint}'`));
    process.exit(1);
  }

  console.log(pc.gray(`Identity: ${id}`));
  console.log(pc.gray(`Endpoint: ${wsUrl.toString()}\n`));

  const client = new OCPPClient({
    identity: id,
    endpoint: wsUrl.toString(),
    protocols: ["ocpp1.6"],
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let isIntentionalClose = false;

  client.on("open", async () => {
    console.log(pc.green(`✔ Connected to CSMS!`));
    await promptUser();
  });

  client.on("close", () => {
    console.log(pc.red(`✖ Disconnected from CSMS.`));
    if (!isIntentionalClose) {
      console.log(pc.yellow(`Attempting to reconnect...`));
    }
  });

  client.on("error", (err: unknown) => {
    console.log(
      pc.red(
        `✖ Connection error: ${(err as Error).message || "Unknown error"}`,
      ),
    );
  });

  async function promptUser() {
    while (true) {
      console.log(
        pc.gray(
          `\nOptions: [B]ootNotification, [H]eartbeat, [S]tatusNotification, [Q]uit`,
        ),
      );
      const answer = await rl.question("> ");
      const cmd = answer.trim().toUpperCase();

      if (cmd === "Q") {
        isIntentionalClose = true;
        console.log(pc.yellow("Exiting simulation..."));
        rl.close();
        await client.close();
        process.exit(0);
      }

      try {
        if (cmd === "B") {
          console.log(pc.gray("Sending BootNotification..."));
          const res = await client.call("BootNotification", {
            chargePointModel: "CLI-Simulator",
            chargePointVendor: "ocpp-ws-io",
          });
          console.log(pc.green("✔ BootNotification Accepted:"), res);
        } else if (cmd === "H") {
          console.log(pc.gray("Sending Heartbeat..."));
          const res = await client.call("Heartbeat", {});
          console.log(pc.green("✔ Heartbeat Accepted:"), res);
        } else if (cmd === "S") {
          console.log(pc.gray("Sending StatusNotification..."));
          const res = await client.call("StatusNotification", {
            connectorId: 1,
            errorCode: "NoError",
            status: "Available",
          });
          console.log(pc.green("✔ StatusNotification Accepted:"), res);
        } else {
          console.log(pc.red("Unknown command."));
        }
      } catch (err: any) {
        console.log(pc.red(`✖ Command failed: ${err.message}`));
      }
    }
  }

  console.log(pc.gray("Connecting..."));
  client.connect();
}
