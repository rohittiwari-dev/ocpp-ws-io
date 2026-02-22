import * as http from "node:http";
import { intro, log, outro, spinner } from "@clack/prompts";
import pc from "picocolors";

export async function mockCommand(options: { port?: number; rate?: number }) {
  const port = Number(options.port || 8080);
  const msInterval = Number(options.rate || 1000);

  console.clear();
  intro(pc.inverse(` ⚡ Mock API Server `));
  log.info(`Port:         ${pc.blue(port)}`);
  log.info(`Message Rate: 1 event every ${msInterval}ms\n`);

  const serverSpinner = spinner();
  serverSpinner.start(pc.gray(`Starting HTTP Server...`));

  const server = http.createServer((req, res) => {
    // Allow CORS for frontend dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      res.write(
        `data: ${JSON.stringify({
          type: "connected",
          message: "Mock Server Ready",
        })}\n\n`,
      );

      const timer = setInterval(() => {
        const events = [
          {
            method: "BootNotification",
            data: { chargePointModel: "X1", status: "Accepted" },
          },
          {
            method: "Heartbeat",
            data: { currentTime: new Date().toISOString() },
          },
          {
            method: "StatusNotification",
            data: { connectorId: 1, status: "Charging", errorCode: "NoError" },
          },
          {
            method: "MeterValues",
            data: {
              connectorId: 1,
              meterValue: [
                {
                  timestamp: new Date().toISOString(),
                  sampledValue: [{ value: String(Math.random() * 100) }],
                },
              ],
            },
          },
        ];

        const evt = events[Math.floor(Math.random() * events.length)];

        log.step(pc.dim(`Sent ${evt.method} event...`));
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      }, msInterval);

      req.on("close", () => {
        clearInterval(timer);
        log.warn(pc.yellow(`Client disconnected from /events stream.`));
      });
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Not Found", message: "Use /events for SSE" }),
      );
    }
  });

  server.listen(port, () => {
    serverSpinner.stop(
      pc.green(`Mock Server listening at http://localhost:${port}`),
    );
    log.message(
      pc.blue(`  → Connect frontend to: http://localhost:${port}/events`),
    );
  });

  process.on("SIGINT", () => {
    log.warn(pc.yellow(`Shutting down Mock API...`));
    server.close();
    outro("Mock Server closed. ⚡");
    process.exit(0);
  });
}
