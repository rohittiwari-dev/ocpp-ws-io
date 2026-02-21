# ocpp-ws-io

> **Type-safe OCPP WebSocket RPC client & server for Node.js.**
>
> built with TypeScript — supports OCPP 1.6, 2.0.1, and 2.1 with full JSON schema validation, all security profiles, and clustering support.

[![npm version](https://img.shields.io/npm/v/ocpp-ws-io.svg)](https://www.npmjs.com/package/ocpp-ws-io)
[![License](https://img.shields.io/npm/l/ocpp-ws-io.svg)](https://github.com/rohittiwari-dev/ocpp-ws-io/blob/main/LICENSE)

## 📚 Documentation

For full API reference, advanced usage, and guides, visit the **[Official Documentation](https://ocpp-ws-io.rohittiwari.me)**.

## ✨ Features

- ⚡ **Full OCPP-J RPC** — Compliant message framing
- 🔒 **Security Profiles 0–3** — Plain WS, Basic Auth, TLS, mTLS
- 🎯 **Type-Safe** — Auto-generated types for all OCPP messages
- 📐 **Strict Mode** — Optional JSON schema validation
- 📡 **Clustering** — Redis adapter support
- 🌐 **Browser Client** — Zero-dependency client for simulators

## 📦 Installation

```bash
npm install ocpp-ws-io
```

## 🚀 Quick Start

### Client (Charging Station Simulator)

```typescript
import { OCPPClient } from "ocpp-ws-io";

const client = new OCPPClient({
  endpoint: "ws://localhost:3000",
  identity: "CP001",
  protocols: ["ocpp1.6"],
});

await client.connect();

// Fully typed call
const response = await client.call("ocpp1.6", "BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});

console.log("Status:", response.status);
```

### Server (Central System)

```typescript
import { OCPPServer } from "ocpp-ws-io";

const server = new OCPPServer({
  protocols: ["ocpp1.6", "ocpp2.0.1"],
  logging: { prettify: true, exchangeLog: true, level: "info" },
});

// Optional: Add authentication ringfence
server.auth((accept, reject, handshake) => {
  console.log(
    `Connection from ${handshake.identity} at path ${handshake.pathname}`,
  );
  accept({ session: { authorized: true } });
});

server.on("client", (client) => {
  console.log(`${client.identity} connected`);

  // Version-aware handler
  client.handle("ocpp1.6", "BootNotification", ({ params }) => {
    console.log("Boot from:", params.chargePointVendor);
    return {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    };
  });
});

await server.listen(3000);
```

## ⚙️ Configuration

### `OCPPClient` Options

| Option            | Type                  | Default    | Description                             |
| ----------------- | --------------------- | ---------- | --------------------------------------- |
| `identity`        | `string`              | _required_ | Charging station ID                     |
| `endpoint`        | `string`              | _required_ | WebSocket URL (`ws://` or `wss://`)     |
| `protocols`       | `OCPPProtocol[]`      | `[]`       | OCPP subprotocols to negotiate          |
| `securityProfile` | `SecurityProfile`     | `NONE`     | Security profile (0–3)                  |
| `password`        | `string \| Buffer`    | —          | Password for Basic Auth (Profile 1 & 2) |
| `tls`             | `TLSOptions`          | —          | TLS/SSL options (Profile 2 & 3)         |
| `reconnect`       | `boolean`             | `true`     | Auto-reconnect on disconnect            |
| `strictMode`      | `boolean \| string[]` | `false`    | Enable/restrict schema validation       |

### `OCPPServer` Options

| Option               | Type              | Default | Description                               |
| -------------------- | ----------------- | ------- | ----------------------------------------- |
| `protocols`          | `OCPPProtocol[]`  | `[]`    | Accepted OCPP subprotocols                |
| `securityProfile`    | `SecurityProfile` | `NONE`  | Security profile for auto-created servers |
| `handshakeTimeoutMs` | `number`          | `30000` | Timeout for WebSocket handshake (ms)      |
| `tls`                | `TLSOptions`      | —       | TLS options (Profile 2 & 3)               |
| `logging`            | `LoggingConfig`   | `true`  | Configure built-in logging                |

## 🛠️ Advanced Server Configuration

### Handshake & Upgrades

You can fine-tune how the server handles the WebSocket upgrade process, including timeouts for custom auth logic.

```typescript
const server = new OCPPServer({
  // ...
  handshakeTimeoutMs: 5000, // Timeout if auth callback takes too long (default 30s)
});

server.on("upgradeAborted", ({ identity, reason, socket }) => {
  console.warn(`Handshake aborted for ${identity}: ${reason}`);
});

server.on("upgradeError", ({ error, socket }) => {
  console.error("Upgrade failed:", error);
});
```

## 📝 Logging

ocpp-ws-io comes with **built-in structured logging** via [voltlog-io](https://www.npmjs.com/package/voltlog-io).

### Default Behavior

By default (`logging: true`), logs are output as structured JSON to `stdout`.

```json
{
  "level": 30,
  "time": 1678900000000,
  "msg": "Client connected",
  "component": "OCPPServer",
  "identity": "CP001"
}
```

### Pretty Printing & Exchange Logs

Enable `prettify` for development to see colored output with icons.  
Enable `exchangeLog` to log all OCPP messages with direction (`IN`/`OUT`) and metadata.

```typescript
const client = new OCPPClient({
  // ...
  logging: {
    enabled: true,
    prettify: true, // 🌈 Colors & icons
    exchangeLog: true, // ⚡ Log all OCPP messages
    level: "debug", // Default: 'info'
  },
});
```

**Output:**

```
⚡ CP-101  →  BootNotification  [OUT]
✅ CP-101  ←  BootNotification  [IN]   { latencyMs: 45 }
```

### Custom Logger

You can bring your own logger (Pino, Winston, etc.) by implementing `LoggerLike`:

````typescript
```typescript
import pino from "pino";

const client = new OCPPClient({
  logging: {
    handler: pino(), // Use existing logger instance
  },
});
````

## 🛡️ Safety & Reliability

### Safe Calls (`safeCall`)

Perform RPC calls without `try/catch` blocks. Returns `null` on failure and logs the error automatically.

```typescript
const result = await client.safeCall("ocpp1.6", "Heartbeat", {});
if (result) {
  console.log("Heartbeat accepted:", result.currentTime);
}
```

### Unicast Routing (`safeSendToClient`) [Server]

Send a message to a specific client ID, even if they are connected to a different node in the cluster.

```typescript
// Best-effort routing (Cluster-aware)
await server.safeSendToClient("CP001", "ocpp1.6", "GetConfiguration", {
  key: ["ClockAlignedDataInterval"],
});
```

## 🧩 Middleware

Intercept and modify OCPP messages using the middleware stack.

```typescript
// Add logging middleware (enabled by default)
client.use(async (ctx, next) => {
  console.log(`Processing ${ctx.method}`);
  await next();
});
```

## 📡 Clustering (Redis)

Scale your OCPP server across multiple nodes using Redis.

1. **Install Adapter**:

   ```bash
   npm install ioredis
   ```

2. **Configure Server**:

   ```typescript
   import { OCPPServer } from "ocpp-ws-io";
   import { RedisAdapter } from "ocpp-ws-io/adapters/redis";
   import Redis from "ioredis";

   const redis = new Redis(process.env.REDIS_URL);
   const server = new OCPPServer({
     adapter: new RedisAdapter(redis), // Uses Redis Streams for reliability
   });
   ```

**Features:**

- **Unicast Routing**: Send messages to any client on any node.
- **Presence**: Track connected clients across the cluster.
- **Reliability**: Zero message loss during node restarts (via Redis Streams).
