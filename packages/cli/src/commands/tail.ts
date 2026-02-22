import pc from "picocolors";
import { createClient } from "redis";

export async function tailCommand(options: {
  identity?: string;
  method?: string;
  redis?: string;
}) {
  const redisUrl = options.redis || "redis://localhost:6379";
  const idFilter = options.identity;
  const methodFilter = options.method;

  console.log(pc.cyan(`\n⚡ ocpp-cli: Network Sniffer (tail)`));

  const filters: string[] = [];
  if (idFilter) filters.push(`Identity: ${pc.yellow(idFilter)}`);
  if (methodFilter) filters.push(`Method: ${pc.yellow(methodFilter)}`);

  if (filters.length > 0) {
    console.log(pc.gray(`Filters active | ${filters.join(" | ")}`));
  } else {
    console.log(pc.yellow(`No filters set. Tailing all cluster traffic.`));
  }

  console.log(pc.gray(`Connecting to Redis Pub/Sub: ${redisUrl}...\n`));

  const subscriber = createClient({ url: redisUrl });

  try {
    await subscriber.connect();

    // Subscribe to all incoming and outgoing stream channels handled by RedisAdapter
    await subscriber.pSubscribe("ocpp:stream:*", (message) => {
      try {
        const payload = JSON.parse(message);

        // Extract routing metadata from RedisAdapter's PubSub format
        const { identity, isOutbound, rawData } = payload;

        if (idFilter && identity !== idFilter) return;

        // Parse the raw OCPP tuple for method filtering
        let ocppType = 0;
        let messageId = "???";
        let method = "Unknown";
        let ocppData: any = {};

        try {
          const tuple = JSON.parse(rawData);
          ocppType = tuple[0];
          messageId = tuple[1];
          if (ocppType === 2) {
            method = tuple[2];
            ocppData = tuple[3];
          } else if (ocppType === 3) {
            ocppData = tuple[2];
            method = "(Response)";
          } else if (ocppType === 4) {
            method = `(Error: ${tuple[2]})`;
            ocppData = tuple[4];
          }
        } catch {
          // Not valid JSON array, ignore formatting.
        }

        if (methodFilter && method !== methodFilter) return;

        const direction = isOutbound ? pc.blue("[OUT]") : pc.cyan("[IN] ");
        const time = new Date().toISOString().split("T")[1].replace("Z", "");

        console.log(
          `${pc.gray(time)} ${direction} ${pc.magenta(identity)} → ${pc.green(
            method,
          )} ${pc.gray(`(${messageId})`)}`,
        );

        // Only print full JSON if we are explicitly filtering, otherwise terminal gets flooded
        if (idFilter || methodFilter) {
          console.log(`${pc.gray(JSON.stringify(ocppData, null, 2))}\n`);
        }
      } catch (_err) {
        // Drop malformed
      }
    });

    console.log(pc.green(`✔ Connected and tailing... (Press Ctrl+C to exit)`));
    console.log(
      pc.gray(`══════════════════════════════════════════════════════════════`),
    );
  } catch (error: any) {
    console.error(pc.red(`\nFailed to subscribe to Redis: ${error.message}`));
    process.exit(1);
  }
}
