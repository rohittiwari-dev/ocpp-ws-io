import pc from "picocolors";
import WebSocket, { WebSocketServer } from "ws";

export async function proxyCommand(options: {
  listen?: number;
  target?: string;
}) {
  console.log(pc.cyan(`\n⚡ ocpp-cli: Reverse Proxy Interceptor (MITM)`));

  const port = Number(options.listen || 8080);
  const targetUrlStr = options.target;

  if (!targetUrlStr) {
    console.error(
      pc.red(`Error: Please specify a target CSMS (--target ws://...)`),
    );
    process.exit(1);
  }

  console.log(pc.gray(`Listening locally on: ws://localhost:${port}`));
  console.log(pc.gray(`Proxying traffic to:  ${targetUrlStr}\n`));

  const wss = new WebSocketServer({ port });

  wss.on("connection", (clientSocket, req) => {
    const chargerId = req.url?.split("/").pop() || "Unknown";
    console.log(
      pc.green(`\n[PROXY] + Physical Charger Connected: ${chargerId}`),
    );

    const targetEndpoint = targetUrlStr.endsWith("/")
      ? targetUrlStr.slice(0, -1)
      : targetUrlStr;

    // Establish our outbound leg to the real server
    const protocolsOption = req.headers["sec-websocket-protocol"];
    const protocols =
      typeof protocolsOption === "string"
        ? protocolsOption.split(",").map((p) => p.trim())
        : protocolsOption;

    const serverSocket = new WebSocket(
      `${targetEndpoint}${req.url}`,
      protocols,
    );

    // 1. Client -> Proxy -> Server
    clientSocket.on("message", (data) => {
      logFrame(chargerId, "OUT", data.toString());
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.send(data);
      }
    });

    // 2. Server -> Proxy -> Client
    serverSocket.on("message", (data) => {
      logFrame(chargerId, "IN ", data.toString());
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(data);
      }
    });

    // Handle teardowns gracefully
    clientSocket.on("close", () => {
      console.log(pc.yellow(`[PROXY] - Charger Disconnected: ${chargerId}`));
      serverSocket.close();
    });

    serverSocket.on("close", () => {
      console.log(
        pc.red(`[PROXY] ✖ Target CSMS dropped connection for ${chargerId}`),
      );
      clientSocket.close();
    });

    serverSocket.on("error", (err) => {
      console.log(pc.red(`[PROXY] Target Error: ${err.message}`));
    });
  });

  function logFrame(_id: string, dir: "IN " | "OUT", payload: string) {
    let ocppName = "Message";
    try {
      const tuple = JSON.parse(payload);
      if (tuple[0] === 2) ocppName = "Call      ";
      if (tuple[0] === 3) ocppName = "CallResult";
      if (tuple[0] === 4) ocppName = "CallError ";
    } catch {
      ocppName = "Corrupt   ";
    }

    const color = dir === "OUT" ? pc.magenta : pc.blue;
    const arrow = dir === "OUT" ? "→" : "←";

    console.log(
      `${color(`[${dir}] ${arrow}`)} ${pc.bold(ocppName)} | ` +
        pc.gray(payload),
    );
  }

  wss.on("listening", () => {
    console.log(
      pc.green(
        `✔ Reverse Proxy initialized on port ${port}. Waiting for hardware...`,
      ),
    );
  });

  process.on("SIGINT", () => {
    console.log(pc.yellow(`\nShutting down Proxy...`));
    wss.close();
    process.exit(0);
  });
}
