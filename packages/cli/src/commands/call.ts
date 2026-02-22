import { OCPPClient } from "ocpp-ws-io";
import pc from "picocolors";

export async function callCommand(
  method: string,
  payloadStr: string,
  options: { endpoint?: string; identity?: string },
) {
  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: One-off Command Engine`));

  const targetUrl = options.endpoint || "ws://localhost:3000";
  const id = options.identity || "CLI-Agent";

  console.log(pc.gray(`Target: ${targetUrl}`));
  console.log(pc.gray(`Identity: ${id}\n`));

  let payload = {};
  if (payloadStr) {
    try {
      payload = JSON.parse(payloadStr);
    } catch (err: any) {
      console.error(pc.red(`Error parsing JSON payload: ${err.message}`));
      console.log(pc.yellow(`Example syntax: ocpp call Heartbeat "{}"`));
      process.exit(1);
    }
  }

  const client = new OCPPClient({
    identity: id,
    endpoint: targetUrl,
    protocols: ["ocpp1.6"],
    reconnect: false,
  });

  client.on("open", async () => {
    console.log(pc.green(`✔ Connected to target.`));
    console.log(
      pc.magenta(`→ Sending ${method}: `) + pc.gray(JSON.stringify(payload)),
    );

    try {
      const response = await client.call("ocpp1.6", method as any, payload, {
        timeoutMs: 10000,
      });
      console.log(pc.green(`\n← [SUCCESS] Response:`));
      console.dir(response, { depth: null, colors: true });
    } catch (err: any) {
      console.log(pc.red(`\n← [ERROR] Call failed:`));
      console.error(pc.red(err.message));
    }

    console.log(pc.gray(`\nDisconnecting...`));
    await client.close();
    process.exit(0);
  });

  client.on("error", (err: any) => {
    console.error(pc.red(`\nSocket Error: ${err.message}`));
  });

  client.connect();
}
