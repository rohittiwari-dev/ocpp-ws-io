import pc from "picocolors";
import { createClient } from "redis";

export async function topCommand(options: { redis?: string }) {
  const redisUrl = options.redis || "redis://localhost:6379";

  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: Live Cluster Dashboard (top)`));
  console.log(pc.gray(`Connecting to Redis: ${redisUrl}...\n`));

  const client = createClient({ url: redisUrl });

  try {
    await client.connect();

    console.clear();

    // Fallback UI loop every second
    setInterval(async () => {
      try {
        // Collect basic metrics - This relies on the new `adapterMetrics()` functionality
        // that we discussed adding to the RedisAdapter, but we can query raw metrics here.
        const keys = await client.keys("ocpp:stats:*");

        console.clear();
        console.log(pc.cyan(`⚡ ocpp-ws-cli | Live Cluster Dashboard`));
        console.log(
          pc.gray(`═════════════════════════════════════════════════`),
        );
        console.log(`Connected to: ${pc.blue(redisUrl)}\n`);

        let totalSessions = 0;
        let totalConnections = 0;

        for (const key of keys) {
          const data = await client.get(key);
          if (data) {
            try {
              const parsed = JSON.parse(data);
              totalSessions += parsed.activeSessions || 0;
              totalConnections += parsed.connectedClients || 0;
            } catch {
              // Ignore malformed JSON in stats keys
            }
          }
        }

        // Approximate the number of connected clients by counting session keys if stats aren't available yet
        if (keys.length === 0) {
          const sessionKeys = await client.keys("ocpp:sessions:*");
          totalSessions = sessionKeys.length;
          console.log(
            pc.yellow(
              `⚠️ Detailed node stats not found. Assuming single-node operation.`,
            ),
          );
        }

        console.log(
          `${pc.bold("Active Server Nodes:")}   ${pc.green(
            keys.length.toString(),
          )}`,
        );
        console.log(
          `${pc.bold("Active TCP Sockets:")}    ${pc.blue(
            totalConnections.toString(),
          )}`,
        );
        console.log(
          `${pc.bold("Active OCPP Sessions:")}  ${pc.magenta(
            totalSessions.toString(),
          )}\n`,
        );

        // Read memory info
        const info = await client.info("memory");
        const match = info.match(/used_memory_human:(.*)/);
        if (match) {
          console.log(
            `${pc.bold("Redis Memory Used:")}   ${pc.yellow(match[1].trim())}`,
          );
        }

        console.log(pc.gray(`\nPress Ctrl+C to exit...`));
      } catch (err: any) {
        console.error(pc.red(`Metrics error: ${err.message}`));
      }
    }, 1000);
  } catch (error: any) {
    console.error(pc.red(`\nFailed to connect to Redis: ${error.message}`));
    process.exit(1);
  }
}
