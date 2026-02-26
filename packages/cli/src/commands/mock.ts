import http from "node:http";
import * as p from "@clack/prompts";
import pc from "picocolors";

export interface MockOptions {
  port?: number;
  rate?: number;
}

export async function runMock(options: MockOptions = {}): Promise<void> {
  p.intro(pc.bgMagenta(pc.white(" 📡 OCPP SSE Mock Server ")));

  let port = options.port;
  if (!port) {
    const result = await p.text({
      message: "Port to run the SSE server on",
      initialValue: "8080",
      validate: (val) => {
        if (!val) return "Port is required";
        const parsed = parseInt(val, 10);
        if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535)
          return "Port must be a number between 1 and 65535";
      },
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    port = parseInt(result as string, 10);
  }

  let rate = options.rate;
  if (!rate) {
    const result = await p.text({
      message: "Event generation rate (milliseconds)",
      initialValue: "500",
      validate: (val) => {
        if (!val) return "Rate is required";
        const parsed = parseInt(val, 10);
        if (Number.isNaN(parsed) || parsed < 10)
          return "Rate must be a number >= 10";
      },
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    rate = parseInt(result as string, 10);
  }

  const clients = new Set<http.ServerResponse>();

  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/events" || req.url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send initial connection successful event
      res.write(
        `data: ${JSON.stringify({
          type: "connection",
          message: "SSE connected",
        })}\n\n`,
      );

      clients.add(res);

      req.on("close", () => {
        clients.delete(res);
      });
    } else {
      res.writeHead(404);
      res.end("Not Found. Try /events");
    }
  });

  server.listen(port, () => {
    p.log.success(
      `SSE Mock Server running at ${pc.cyan(
        `http://localhost:${port}/events`,
      )}`,
    );
    p.log.info(`Broadcasting mock events every ${pc.yellow(`${rate}ms`)}`);
    p.log.info("Press Ctrl+C to stop.");
  });

  // Mock Event Generator
  let seqNo = 0;

  function generateMockEvent() {
    seqNo++;
    const types = [
      "MeterValues",
      "StatusNotification",
      "TransactionEvent",
      "Heartbeat",
    ];
    const type = types[Math.floor(Math.random() * types.length)];

    let payloadStr = "";

    const timestamp = new Date().toISOString();
    const stationId = `CS-${Math.floor(Math.random() * 100)
      .toString()
      .padStart(3, "0")}`;

    switch (type) {
      case "MeterValues":
        payloadStr = JSON.stringify({
          action: "MeterValues",
          stationId,
          timestamp,
          seqNo,
          meterValue: [
            {
              timestamp,
              sampledValue: [
                {
                  measurand: "Power.Active.Import",
                  unit: "W",
                  value: (Math.random() * 50000).toFixed(2),
                },
                {
                  measurand: "Energy.Active.Import.Register",
                  unit: "Wh",
                  value: (Math.random() * 1000000).toFixed(2),
                },
                {
                  measurand: "SoC",
                  unit: "Percent",
                  value: Math.floor(Math.random() * 100).toString(),
                },
                {
                  measurand: "Voltage",
                  unit: "V",
                  value: (230 + (Math.random() * 10 - 5)).toFixed(2),
                },
              ],
            },
          ],
        });
        break;
      case "StatusNotification": {
        const statuses = [
          "Available",
          "Preparing",
          "Charging",
          "SuspendedEV",
          "Finishing",
          "Faulted",
        ];
        payloadStr = JSON.stringify({
          action: "StatusNotification",
          stationId,
          timestamp,
          seqNo,
          connectorId: Math.floor(Math.random() * 3) + 1,
          status: statuses[Math.floor(Math.random() * statuses.length)],
        });
        break;
      }
      case "TransactionEvent": {
        const evTypes = ["Started", "Updated", "Ended"];
        payloadStr = JSON.stringify({
          action: "TransactionEvent",
          stationId,
          timestamp,
          seqNo,
          eventType: evTypes[Math.floor(Math.random() * evTypes.length)],
          transactionInfo: {
            transactionId: `TX-${Math.floor(Math.random() * 10000)}`,
          },
        });
        break;
      }
      case "Heartbeat":
        payloadStr = JSON.stringify({
          action: "Heartbeat",
          stationId,
          timestamp,
          seqNo,
        });
        break;
    }

    // Broadcast to all clients
    for (const client of clients) {
      client.write(`data: ${payloadStr}\n\n`);
    }

    if (seqNo % 10 === 0) {
      // Periodic heartbeat/logging can go here
    }
  }

  const intervalId = setInterval(generateMockEvent, rate);

  return new Promise<void>((resolve) => {
    const handleSigInt = () => {
      p.log.info("\nStopping SSE Mock Server...");
      clearInterval(intervalId);

      // Close all open client connections
      for (const client of clients) {
        client.end();
      }
      clients.clear();

      server.close(() => {
        p.log.success("Server stopped safely.");
        process.off("SIGINT", handleSigInt); // Remove the listener
        resolve(); // Return to main menu
      });
    };

    process.on("SIGINT", handleSigInt);
  });
}
