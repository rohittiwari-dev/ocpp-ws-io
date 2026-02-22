import { OCPPClient } from "ocpp-ws-io";
import pc from "picocolors";

export async function loadTestCommand(options: {
  endpoint?: string;
  clients?: number;
  rampUp?: number;
}) {
  console.log(pc.cyan(`\n⚡ ocpp-cli: Distributed Load Testing\n`));

  const targetUrl = options.endpoint || "ws://localhost:3000";
  const numClients = Number(options.clients || 100);
  const rampUpMs = Number(options.rampUp || 10) * 1000;

  console.log(pc.gray(`Target Endpoint: ${targetUrl}`));
  console.log(pc.gray(`Total Simulated Clients: ${numClients}`));
  console.log(pc.gray(`Ramp-up Duration: ${rampUpMs / 1000}s\n`));

  let connected = 0;
  let failed = 0;
  let messagesSent = 0;
  let bootAccepted = 0;

  const clients: OCPPClient[] = [];

  console.log(pc.yellow(`Spawning ${numClients} clients...`));

  const spawnInterval = rampUpMs / numClients;

  for (let i = 0; i < numClients; i++) {
    setTimeout(() => {
      const client = new OCPPClient({
        identity: `LoadTest-CP-${String(i + 1).padStart(5, "0")}`,
        endpoint: targetUrl,
        protocols: ["ocpp1.6"],
        reconnect: false, // Don't muddy the waters with reconnect bursts
      });

      client.on("open", async () => {
        connected++;
        printStats();

        try {
          // Immediately fire a BootNotification
          const res = await client.call("BootNotification", {
            chargePointModel: "CLI-LoadTester",
            chargePointVendor: "ocpp-ws-io",
          });
          messagesSent++;
          if ((res as any).status === "Accepted") {
            bootAccepted++;
          }
        } catch (_err) {
          failed++;
        }

        printStats();
      });

      client.on("error", () => {
        failed++;
        printStats();
      });

      client.on("close", () => {
        connected--;
        printStats();
      });

      client.connect();
      clients.push(client);
    }, i * spawnInterval);
  }

  function printStats() {
    process.stdout.write(
      `\r${pc.green(`Connected: ${connected}`)} | ${pc.red(
        `Failed: ${failed}`,
      )} | ${pc.blue(`Booted: ${bootAccepted}/${messagesSent}`)} | ${pc.gray(
        `Target: ${numClients}`,
      )}`,
    );
  }

  // Graceful shutdown hook
  process.on("SIGINT", async () => {
    console.log(
      pc.yellow(
        `\n\nStopping load test... triggering massive disconnect wave.`,
      ),
    );
    for (const c of clients) {
      c.close({ force: true }).catch(() => {});
    }
    process.exit(0);
  });
}
