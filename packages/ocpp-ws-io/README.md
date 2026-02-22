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
server.auth((ctx) => {
  console.log(
    `Connection from ${ctx.handshake.identity} at path ${ctx.handshake.pathname}`,
  );
  ctx.accept({ session: { authorized: true } });
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

| Option              | Type                  | Default    | Description                             |
| ------------------- | --------------------- | ---------- | --------------------------------------- |
| `identity`          | `string`              | _required_ | Charging station ID                     |
| `endpoint`          | `string`              | _required_ | WebSocket URL (`ws://` or `wss://`)     |
| `protocols`         | `OCPPProtocol[]`      | `[]`       | OCPP subprotocols to negotiate          |
| `securityProfile`   | `SecurityProfile`     | `NONE`     | Security profile (0–3)                  |
| `password`          | `string \| Buffer`    | —          | Password for Basic Auth (Profile 1 & 2) |
| `tls`               | `TLSOptions`          | —          | TLS/SSL options (Profile 2 & 3)         |
| `reconnect`         | `boolean`             | `true`     | Auto-reconnect on disconnect            |
| `pingIntervalMs`    | `number`              | `30000`    | Includes ±25% randomized jitter         |
| `strictMode`        | `boolean \| string[]` | `false`    | Enable/restrict schema validation       |
| `strictModeMethods` | `string[]`            | —          | Restrict validation to specific methods |

### `OCPPServer` Options

| Option               | Type               | Default   | Description                                |
| -------------------- | ------------------ | --------- | ------------------------------------------ |
| `protocols`          | `OCPPProtocol[]`   | `[]`      | Accepted OCPP subprotocols                 |
| `securityProfile`    | `SecurityProfile`  | `NONE`    | Security profile for auto-created servers  |
| `handshakeTimeoutMs` | `number`           | `30000`   | Timeout for WebSocket handshake (ms)       |
| `tls`                | `TLSOptions`       | —         | TLS options (Profile 2 & 3)                |
| `logging`            | `LoggingConfig`    | `true`    | Configure built-in logging                 |
| `sessionTtlMs`       | `number`           | `7200000` | Garbage collection inactivity timeout (ms) |
| `rateLimit`          | `RateLimitOptions` | —         | Token bucket socket & method rate-limiter  |

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

### Server & Router Execution Flow

The `OCPPServer` and its internal `OCPPRouter` handle connections and messages in a strict, two-phase execution hierarchy:

#### 1. Connection Phase (HTTP Upgrade)

Executes before the WebSocket connection is officially accepted.

1. **Route Matching (`router.route`)**: The incoming URL is matched against defined patterns.
2. **Connection Middleware (`router.use`)**: Runs sequentially. Used to extract tokens, inspect headers, or implement early rate-limiting logic.
3. **Auth Callback (`router.auth`)**: Runs **last** in the HTTP upgrade chain. Used to validate credentials against a database and finally accept/reject the connection.

#### 2. Message Phase (WebSocket Open)

Executes after the connection is accepted and messages start flowing. 4. **Message Middleware (`client.use` / `server.use`)**: Intercepts every outgoing/incoming message for logging, schema validation, or metric tracking. 5. **Message Handlers (`client.handle` / `server.handle`)**: The **final piece of business logic** where the system reacts to a specific OCPP action (e.g., `BootNotification`).

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

Perform RPC calls without `try/catch` blocks. Returns the response data on success, or `undefined` on failure while automatically logging the error. You can also pass per-call config options like timeouts.

````typescript
const result = await client.safeCall(
  "ocpp1.6",
  "Heartbeat",
  {},
  {
    timeoutMs: 15000, // Finely control the timeout specifically for this request
  },
);

if (result) {
  // Checked for undefined
  console.log("Heartbeat accepted:", result.currentTime);
}

### Unicast Routing (`sendToClient` / `safeSendToClient`) [Server]

Send a message to a specific client ID, even if they are connected to a different node in the cluster.

You have two options depending on your error-handling preference:

#### 1. Standard approach (`sendToClient`)
Throws an error if the client responds with a `CALLERROR` or if the timeout is reached.
```typescript
try {
  const result = await server.sendToClient(
    "CP001",
    "ocpp1.6",
    "GetConfiguration",
    { key: ["ClockAlignedDataInterval"] },
    { timeoutMs: 10000 },
  );
  console.log("Configuration:", result);
} catch (error) {
  console.error("Failed to get configuration:", error);
}
````

#### 2. Safe approach (`safeSendToClient`)

Returns the response on success, or `undefined` on error, automatically logging the failure internally.

```typescript
const result = await server.safeSendToClient(
  "CP001",
  "ocpp1.6",
  "GetConfiguration",
  { key: ["ClockAlignedDataInterval"] },
  { timeoutMs: 10000 },
);

if (result) {
  console.log("Configuration:", result);
}
```

### 2. Connection Middleware (Server)

For intercepting HTTP WebSocket Upgrade requests before they become an OCPP Client.

```typescript
const rateLimiter = defineMiddleware(async (ctx) => {
  const ip = ctx.handshake.remoteAddress;
  if (isRateLimited(ip)) {
    // Instantly aborts the WebSocket connection with an HTTP 429 status
    ctx.reject(429, "Too Many Requests");
  } else {
    // Or proceed down the execution chain. You can optionally pass an object
    // to next(), which will automatically be shallow-merged into `ctx.state`.
    await ctx.next({ rateLimitRemaining: 99 });
  }
});

server.use(rateLimiter);
```

### 3. Advanced Rate Limiting (Token Bucket)

To protect your CSMS from Noisy-Neighbor problems or firmware loops (e.g., a charger rapidly spamming `MeterValues`), you can enable the built-in Token Bucket Rate Limiter.

The Rate Limiter safely throttles connections without dropping the connection immediately. You can define global limits, method-specific limits, and provide a custom action callback when the limit is breached.

```typescript
const server = new OCPPServer({
  protocols: ["ocpp1.6"],
  rateLimit: {
    limit: 100, // Global limit
    windowMs: 60000, // per 60 seconds
    onLimitExceeded: "disconnect", // or "ignore", or a Custom Callback
    methods: {
      MeterValues: { limit: 10, windowMs: 60000 },
      Heartbeat: { limit: 2, windowMs: 60000 },
    },
  },
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
     protocols: ["ocpp1.6"],
   });

   // Uses Redis Streams for clustering reliability
   await server.setAdapter(new RedisAdapter(redis));
   ```

**Features:**

- **Unicast Routing**: Send messages to any client on any node.
- **Presence**: Track connected clients across the cluster.
- **Reliability**: Zero message loss during node restarts (via Redis Streams).
- **Batch Processing**: Use `server.broadcastBatch` to combine multi-node calls effortlessly.

### Custom Adapters (`EventAdapterInterface`)

You can build custom clustering adapters (e.g., RabbitMQ, Kafka, Postgres PUB/SUB) by implementing the exported `EventAdapterInterface`:

```typescript
import type { EventAdapterInterface } from "ocpp-ws-io";

export class CustomAdapter implements EventAdapterInterface {
  async publish(channel: string, data: unknown): Promise<void> {
    /* ... */
  }
  async subscribe(
    channel: string,
    handler: (data: unknown) => void,
  ): Promise<void> {
    /* ... */
  }
  async unsubscribe(channel: string): Promise<void> {
    /* ... */
  }
  async disconnect(): Promise<void> {
    /* ... */
  }

  // Optional primitives for advanced routing:
  async setPresence?(
    identity: string,
    nodeId: string,
    ttl: number,
  ): Promise<void>;
  async getPresence?(identity: string): Promise<string | null>;
  async removePresence?(identity: string): Promise<void>;
  async getPresenceBatch?(identities: string[]): Promise<(string | null)[]>;
  async publishBatch?(
    messages: { channel: string; data: unknown }[],
  ): Promise<void>;
  async metrics?(): Promise<Record<string, unknown>>;
}
```
