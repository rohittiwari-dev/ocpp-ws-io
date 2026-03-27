<p align="center">
  <img src="https://raw.githubusercontent.com/rohittiwari-dev/ocpp-ws-io/main/assets/banner.svg" alt="ocpp-ws-io - OCPP RPC WebSocket Client and Server" width="420" />
</p>

# 🔌 OCPP RPC WebSocket Client & Server Library

The **production-ready OCPP RPC implementation** for building type-safe EV charging platforms, CSMS backends, charge points, and simulators. Supports OCPP 1.6J, 2.0.1, and 2.1 with full protocol compliance, all security profiles, Redis clustering, strict JSON schema validation, and structured logging.

> **Built with TypeScript** for EV charging, CSMS, CPO/EMSP platforms. Zero-dependency WebSocket RPC framework supporting OCPP versions 1.6, 2.0.1, and 2.1 with optional JSON schema validation, bidirectional messaging, all security profiles (0–3), Redis pub/sub clustering, and structured logging powered by [voltlog-io](https://ocpp-ws-io.rohittiwari.me/docs/voltlog-io).

[![npm version](https://img.shields.io/npm/v/ocpp-ws-io.svg)](https://www.npmjs.com/package/ocpp-ws-io)
[![License](https://img.shields.io/npm/l/ocpp-ws-io.svg)](https://github.com/rohittiwari-dev/ocpp-ws-io/blob/main/LICENSE)

## 📚 Full Documentation & API Reference

For full API reference, advanced usage, and guides, visit the **[Official Documentation](https://ocpp-ws-io.rohittiwari.me)**.

## ✨ Key Features for OCPP RPC WebSocket Development

The library provides enterprise-grade features for building OCPP-compliant EV charging platforms:

- ⚡ **Full OCPP-J RPC Support** — Complete JSON-RPC 2.0 OCPP message framing for 1.6J, 2.0.1, and 2.1
- 🔒 **All Security Profiles** — Supports Plain WS, Basic Authentication, TLS/SSL, and mutual TLS (mTLS)
- 🎯 **Type-Safe TypeScript** — Auto-generated, fully-typed interfaces for all OCPP versions and methods
- 📐 **Strict Schema Validation** — Optional JSON schema validation with AJV for data integrity
- 📡 **Redis Clustering & Pub/Sub** — Built-in Redis adapter for distributed CSMS deployments
- 🌐 **Browser-Ready Client** — Zero-dependency WebSocket client for EV charging simulators
- ⚡ **CLI Toolkit** — `ocpp-ws-cli` for type generation, load testing, fuzzing, and virtual charge point simulation
- 🛡️ **DDoS & Rate Limiting** — Token bucket rate limiting and adaptive throttling for charging station protection

## 📦 Installation

```bash
npm install ocpp-ws-io
```

## 🚀 Quick Start: OCPP RPC Client & Server Examples

Get up and running with OCPP WebSocket RPC in minutes. Choose your role: EV charging station (client) or CSMS backend (server).

### OCPP RPC Client: Charge Point / Charging Station Simulator

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

### OCPP RPC Server: Central System / CSMS Backend

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

## ⚙️ OCPP RPC Configuration & Options

Configure your OCPP WebSocket RPC client and server with extensive options for protocol negotiation, security, validation, and performance.

### OCPP WebSocket RPC Client Configuration

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

**Call Options**
When invoking `client.call()` you can safely decouple dynamically generated message IDs and pass your own deterministic keys:

```typescript
await client.call("ocpp1.6", "BootNotification", { ... }, { idempotencyKey: "unique-boot-123" });
```

### OCPP WebSocket RPC Server Configuration

| Option               | Type               | Default   | Description                                |
| -------------------- | ------------------ | --------- | ------------------------------------------ |
| `protocols`          | `OCPPProtocol[]`   | `[]`      | Accepted OCPP subprotocols                 |
| `securityProfile`    | `SecurityProfile`  | `NONE`    | Security profile for auto-created servers  |
| `handshakeTimeoutMs` | `number`           | `30000`   | Timeout for WebSocket handshake (ms)       |
| `tls`                | `TLSOptions`       | —         | TLS options (Profile 2 & 3)                |
| `logging`            | `LoggingConfig`    | `true`    | Configure built-in logging                 |
| `sessionTtlMs`       | `number`           | `7200000` | Garbage collection inactivity timeout (ms) |
| `rateLimit`          | `RateLimitOptions` | —         | Token bucket socket & method rate-limiter  |
| `healthEndpoint`     | `boolean`          | `false`   | Expose HTTP `/health` and `/metrics` APIs  |

## � Message Observability & Event Handling (v3.0.0+)

Unified message event API with direction tracking and rich contextual metadata for complete visibility into OCPP message flow.

### Observe All Messages with Direction & Latency

```typescript
const client = new OCPPClient({ ... });

// Single unified "message" event with direction, context, and metadata
client.on("message", ({ message, direction, ctx }) => {
  console.log({
    direction,      // "IN" (from server) | "OUT" (to server)
    method: ctx.method,       // "BootNotification", "MeterValues", etc.
    type: ctx.type,           // "incoming_call", "outgoing_call", etc.
    messageId: ctx.messageId, // Unique message ID
    timestamp: ctx.timestamp, // ISO 8601 timestamp
    latencyMs: ctx.latencyMs, // Response latency (if available)
    protocol: ctx.protocol,   // "ocpp1.6", "ocpp2.0.1", etc.
  });
});

// Server-side observation (for each connected client)
const server = new OCPPServer({ ... });
server.on("client", (client) => {
  client.on("message", ({ direction, ctx }) => {
    console.log(`[${client.identity}] ${direction} ${ctx.method} (${ctx.latencyMs}ms)`);
  });
});
```

### Message Event Payload Structure

```typescript
interface MessageEventPayload {
 message: OCPPMessage; // Original OCPP message tuple
 direction: "IN" | "OUT"; // Message direction
 ctx: MessageEventContext; // Enriched context with metadata
}

interface MessageEventContext {
 type:
  | "incoming_call"
  | "outgoing_call"
  | "incoming_result"
  | "incoming_error";
 messageId: string;
 method?: string;
 params?: unknown;
 payload?: unknown;
 timestamp: string; // ISO 8601
 latencyMs?: number; // Response latency
 protocol?: string;
}
```

## �🛠️ Advanced OCPP RPC Server Configuration & WebSocket Handshake

Build sophisticated OCPP server implementations with fine-tuned WebSocket upgrade handling, authentication, and message routing.

### OCPP WebSocket Handshake, Upgrade & Authentication

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

### OCPP Server & Router Execution Flow (Connection & Message Phases)

The `OCPPServer` and its internal `OCPPRouter` handle connections and messages in a strict, two-phase execution hierarchy:

#### 1. Connection Phase (HTTP Upgrade)

Executes before the WebSocket connection is officially accepted.

1. **Route Matching (`router.route`)**: The incoming URL is matched against defined patterns.
2. **Connection Middleware (`router.use`)**: Runs sequentially. Used to extract tokens, inspect headers, or implement early rate-limiting logic.
3. **Auth Callback (`router.auth`)**: Runs **last** in the HTTP upgrade chain. Used to validate credentials against a database and finally accept/reject the connection.

#### 2. Message Phase (WebSocket Open)

Executes after the connection is accepted and messages start flowing. 4. **Message Middleware (`client.use` / `server.use`)**: Intercepts every outgoing/incoming message for logging, schema validation, or metric tracking. 5. **Message Handlers (`client.handle` / `server.handle`)**: The **final piece of business logic** where the system reacts to a specific OCPP action (e.g., `BootNotification`).

### NOREPLY Suppression in OCPP RPC Message Handlers

Return `NOREPLY` directly from any message handler to safely suppress the automatic outbound `CALLRESULT` without violating strict internal tracking specifications.

```typescript
import { NOREPLY } from "ocpp-ws-io";

client.handle("StatusNotification", ({ params }) => {
 return NOREPLY;
});
```

## 📝 Structured Logging for OCPP RPC WebSocket Applications

`ocpp-ws-io` provides **battle-tested structured JSON logging** optimized for high-throughput EV charging and OCPP WebSocket environments, powered by [voltlog-io](https://ocpp-ws-io.rohittiwari.me/docs/voltlog-io).

### Default JSON Logging Behavior

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

### Pretty Printing & OCPP Message Exchange Logs (Development Mode)

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

```sh
⚡ CP-101  →  BootNotification  [OUT]
✅ CP-101  ←  BootNotification  [IN]   { latencyMs: 45 }
```

### Custom Logger Integration (Pino, Winston, etc.)

You can bring your own logger (Pino, Winston, etc.) by implementing `LoggerLike`:

```typescript
import pino from "pino";

const client = new OCPPClient({
 logging: {
  handler: pino(), // Use existing logger instance
 },
});
```

## 🛡️ OCPP RPC Safety, Reliability & Error Handling

Build fault-tolerant EV charging applications with safe call patterns, automatic error handling, and idempotency support.

### Safe RPC Calls (`safeCall`) - Error Handling Without Try/Catch

Perform RPC calls without `try/catch` blocks. Returns the response data on success, or `undefined` on failure while automatically logging the error. You can also pass per-call config options like timeouts.

```typescript
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
```

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
```

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

## 🧩 OCPP Message Middleware & Interceptor Pattern

Intercept, validate, and modify OCPP RPC messages across the middleware stack for logging, schema validation, and metric tracking.

```typescript
// Add logging middleware (enabled by default)
client.use(async (ctx, next) => {
 console.log(`Processing ${ctx.method}`);
 await next();
});
```

## 📡 Redis Clustering & Distributed CSMS Architecture

Scale OCPP RPC servers across multiple nodes with Redis pub/sub, Streams, and presence tracking for enterprise CSMS deployments.

### Set Up Redis Clustering

1. **Install Redis Adapter**:

    ```bash
    npm install ioredis
    ```

2. **Configure OCPP Server with Redis Adapter**:

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

**OCPP Redis Clustering Features:**

- **Unicast Routing**: Send OCPP RPC messages to any charge point on any cluster node.
- **Presence Tracking**: Real-time discovery of connected clients across the cluster.
- **Durability**: Redis Streams for guaranteed message delivery.
- **Batch Operations**: Use `server.broadcastBatch` for efficient multi-node requests.

### Custom Clustering Adapters (RabbitMQ, Kafka, PubSub)

Build custom OCPP clustering solutions beyond Redis by implementing the `EventAdapterInterface`. This enables distributed CSMS architectures with your preferred message broker or database backend.

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
