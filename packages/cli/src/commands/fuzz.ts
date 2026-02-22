import { intro, log, outro, spinner } from "@clack/prompts";
import pc from "picocolors";
import WebSocket from "ws";

export async function fuzzCommand(options: {
  endpoint?: string;
  workers?: number;
}) {
  console.clear();
  intro(pc.inverse(pc.red(` ⚡ Protocol Security Fuzzer `)));

  const targetUrl = options.endpoint || "ws://localhost:3000";
  const numWorkers = Number(options.workers || 5);

  log.info(`Target Endpoint: ${pc.blue(targetUrl)}`);
  log.info(`Attack Threads:  ${pc.bold(numWorkers)}`);
  log.warn(
    pc.yellow(`[WARNING] This will aggressively spam the target server.`),
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

  const attackSpinner = spinner();
  attackSpinner.start(pc.gray(`Engaging payload launchers...`));

  for (let i = 0; i < numWorkers; i++) {
    spawnWorker(i);
  }

  function updateSpinner() {
    attackSpinner.message(
      `${pc.blue(`Packets Sent: ${packetsFired}`)} | ${pc.green(
        `Graceful Schema Rejects: ${rejects}`,
      )} | ${pc.magenta(
        `Drops (Rate Limit/Crash): ${unexpectedDrops}`,
      )} | Threads: ${activeThreads}  `,
    );
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
        updateSpinner();
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
      updateSpinner();
    });

    ws.on("close", (code) => {
      isDead = true;
      if (code !== 1000) {
        unexpectedDrops++;
      }
      activeThreads--;
      updateSpinner();

      if (activeThreads === 0) {
        attackSpinner.stop(pc.red(`All fuzzing threads collapsed.`));
        log.warn(pc.yellow(`Server may have engaged Rate Limiting or died.`));
        outro(`Fuzzing complete.`);
        process.exit(0);
      }
    });

    ws.on("error", () => {
      isDead = true;
      activeThreads--;
    });
  }

  process.on("SIGINT", () => {
    attackSpinner.stop(pc.yellow(`Fuzzing cancelled.`));
    outro(`Fuzzing aborted.`);
    process.exit(0);
  });
}
