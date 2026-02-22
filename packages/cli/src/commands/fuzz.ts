import pc from "picocolors";
import WebSocket from "ws";

export async function fuzzCommand(options: {
  endpoint?: string;
  workers?: number;
}) {
  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: Protocol Security Fuzzer`));

  const targetUrl = options.endpoint || "ws://localhost:3000";
  const numWorkers = Number(options.workers || 5);

  console.log(pc.gray(`Target Endpoint: ${targetUrl}`));
  console.log(pc.gray(`Attack Threads: ${numWorkers}\n`));
  console.log(
    pc.red(`[WARNING] This will aggressively spam the target server.`),
  );

  let packetsFired = 0;
  let rejects = 0;
  let unexpectedDrops = 0;
  let activeThreads = numWorkers;

  // The arsenal of malformed protocol attacks
  const attackVectors = [
    // 1. Completely malformed JSON
    "{ unclosed: true, ",
    '[2, "msg1", ',
    // 2. Valid JSON, but wrong OCPP Type ID
    '[99, "msg1", "Heartbeat", {}]',
    // 3. String/Boolean instead of Array Tuple
    '"Just a string payload"',
    "true",
    // 4. Missing required payload indexes
    '[2, "msg2"]',
    // 5. Massive payload injection (Memory DOS)
    `[2, "msg3", "BootNotification", { "payload": "${"A".repeat(100000)}" }]`,
    // 6. Valid syntax, non-existent method
    '[2, "msg4", "ExecuteRogueCommand", {}]',
    // 7. Type-juggling attacks
    '[2, 12345, "Heartbeat", []]', // Integer Message ID instead of string
    // 8. SQL Injection attempts in raw strings
    '[2, "msg5", "BootNotification", { "chargePointVendor": "\'; DROP TABLE users; --" }]',
  ];

  for (let i = 0; i < numWorkers; i++) {
    spawnWorker(i);
  }

  function spawnWorker(id: number) {
    // Connect specifically bypassing the OCPPClient to manually throw raw strings
    const ws = new WebSocket(`${targetUrl}/CP-Fuzzer-${id}`);

    let isDead = false;

    ws.on("open", () => {
      // Fire endlessly
      const loop = () => {
        if (isDead || ws.readyState !== WebSocket.OPEN) return;

        // Send a batch then yield to allow event loop processing
        for (let i = 0; i < 50; i++) {
          const attack =
            attackVectors[Math.floor(Math.random() * attackVectors.length)];
          ws.send(attack);
          packetsFired++;
        }
        printStats();
        setImmediate(loop);
      };
      loop();
    });

    ws.on("message", (data) => {
      try {
        const tuple = JSON.parse(data.toString());
        if (tuple[0] === 4) {
          rejects++; // Properly guarded by server strict mode
        }
      } catch {
        // Ignored
      }
      printStats();
    });

    ws.on("close", (code) => {
      isDead = true;
      if (code !== 1000) {
        unexpectedDrops++;
      }
      activeThreads--;
      printStats();

      if (activeThreads === 0) {
        console.log(
          pc.yellow(
            `\nAll fuzzing threads collapsed. Server may have engaged Rate Limiting or died.`,
          ),
        );
        process.exit(0);
      }
    });

    ws.on("error", () => {
      isDead = true;
      activeThreads--;
    });
  }

  function printStats() {
    process.stdout.write(
      `\r${pc.blue(`Packets Sent: ${packetsFired}`)} | ${pc.green(
        `Graceful Schema Rejects: ${rejects}`,
      )} | ${pc.yellow(
        `Drops (Rate Limit/Crash): ${unexpectedDrops}`,
      )} | Threads: ${activeThreads}  `,
    );
  }

  process.on("SIGINT", () => {
    console.log(pc.magenta(`\n\nFuzzing cancelled.`));
    process.exit(0);
  });
}
