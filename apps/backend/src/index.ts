import { createServer } from "node:http";
import { handleRestApi } from "./api/rest.js";
import { createOCPPServer } from "./ocpp/server.js";

const PORT = 3000;

// 1. Initialize our modular OCPP server
const ocppServer = createOCPPServer();

// 2. Create the unified Node.js HTTP server.
// Bun provides a blazer-fast, native implementation of this under the hood.
const httpServer = createServer(async (req, res) => {
  try {
    // Attempt to handle as a custom REST API request
    const handled = await handleRestApi(req, res, ocppServer);
    if (handled) return;

    // Fallback: Add UI telemetry board routing here in the future.
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 - Not Found");
  } catch (err) {
    console.error("HTTP handler error:", err);
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

async function bootstrap() {
  // 3. Attach the OCPP Server to the SAME HTTP server using WebSocket "upgrade" mechanics
  // This satisfies the requirement: 'same port for ws and server , using upgrade'
  await ocppServer.listen(0, undefined, { server: httpServer });

  // 4. Start the shared HTTP server listener
  httpServer.listen(PORT, () => {
    console.log(
      `\n🚀 Unified CPMS Backend running on http://localhost:${PORT}`,
    );
    console.log(`🔌 WebSocket OCPP Endpoint ready at ws://localhost:${PORT}`);
    console.log(`\nTry testing the REST API:`);
    console.log(`- GET  http://localhost:${PORT}/api/stations`);
    console.log(
      `- POST http://localhost:${PORT}/api/stations/EVSE-001/trigger\n`,
    );
  });
}

bootstrap().catch(console.error);
