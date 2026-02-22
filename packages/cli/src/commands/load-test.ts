import { intro, log, outro, spinner } from "@clack/prompts";
import { OCPPClient } from "ocpp-ws-io";
import pc from "picocolors";

export async function loadTestCommand(options: {
  endpoint?: string;
  clients?: number;
  rampUp?: number;
}) {
  console.clear();
  intro(pc.inverse(` ⚡ Distributed Load Testing Engine `));

  const targetUrl = options.endpoint || "ws://localhost:3000";
  const numClients = Number(options.clients || 100);
  const rampUpMs = Number(options.rampUp || 10) * 1000;

  log.info(`Target Endpoint:           ${pc.blue(targetUrl)}`);
  log.info(`Total Simulated Clients:   ${pc.bold(numClients)}`);
  log.info(`Ramp-up Duration:          ${rampUpMs / 1000}s`);

  let connected = 0;
  let failed = 0;
  let messagesSent = 0;
  let bootAccepted = 0;

  const clients: OCPPClient[] = [];

  const loadSpinner = spinner();
  loadSpinner.start(pc.gray(`Spawning ${numClients} clients...`));

  const spawnInterval = rampUpMs / numClients;

  const updateSpinner = () => {
    loadSpinner.message(
      `${pc.green(`Connected: ${connected}`)} | ${pc.red(
        `Failed: ${failed}`,
      )} | ${pc.magenta(`Booted: ${bootAccepted}/${messagesSent}`)} | ${pc.gray(
        `Target: ${numClients}`,
      )}`,
    );
  };

  for (let i = 0; i < numClients; i++) {
    setTimeout(() => {
      const client = new OCPPClient({
        identity: `LoadTest-CP-${String(i + 1).padStart(5, "0")}`,
        endpoint: targetUrl,
        protocols: ["ocpp1.6"],
        reconnect: false, // Prevent reconnect storms
      });

      client.on("open", async () => {
        connected++;
        updateSpinner();

        try {
          const res: any = await client.call("ocpp1.6", "BootNotification", {
            chargePointModel: "CLI-LoadTester",
            chargePointVendor: "ocpp-ws-io",
          });
          messagesSent++;
          if (res.status === "Accepted") {
            bootAccepted++;
          }
        } catch (_err) {
          failed++;
        }

        updateSpinner();
      });

      client.on("error", () => {
        failed++;
        updateSpinner();
      });

      client.on("close", () => {
        connected--;
        updateSpinner();
      });

      client.connect();
      clients.push(client);
    }, i * spawnInterval);
  }

  // Graceful shutdown hook
  process.on("SIGINT", async () => {
    loadSpinner.stop(
      pc.yellow(`Stopping load test... triggering disconnect wave.`),
    );
    for (const c of clients) {
      c.close({ force: true }).catch(() => {});
    }
    outro("Load test finished. ⚡");
    process.exit(0);
  });
}
