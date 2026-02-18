# ocpp-ws-io

Type-safe OCPP WebSocket RPC client & server for Node.js.

Built with TypeScript from the ground up — supports OCPP 1.6, 2.0.1, and 2.1 with full JSON schema validation, all three security profiles, and optional Redis-based clustering.

## Features

- ⚡ **Full OCPP-J RPC** — Call, CallResult, CallError message framing per OCPP-J spec
- 🔒 **Security Profiles 0–3** — Plain WS, Basic Auth, TLS + Basic Auth, Mutual TLS
- 📐 **Strict Mode** — Optional schema validation using built-in OCPP JSON schemas
- 🔁 **Auto-Reconnect** — Exponential backoff with configurable limits
- 🧩 **Framework Agnostic** — Use standalone, or attach to Express, Fastify, NestJS, etc.
- 📡 **Clustering** — Optional Redis adapter (supports `ioredis` & `node-redis`)
- 🎯 **Type-Safe** — Auto-generated types for all OCPP 1.6, 2.0.1 & 2.1 methods with full request/response inference
- 🛠️ **Schema-to-TS** — Built-in script to re-generate types from official JSON schemas
- 🔀 **Version-Aware Handlers** — Register handlers per OCPP version with typed params, or use generic handlers with protocol context
- 🌐 **Browser Client** — Zero-dependency browser WebSocket client via `ocpp-ws-io/browser`

## Installation

```bash
npm install ocpp-ws-io
```

## Quick Start

### Client (Charging Station Simulator)

```typescript
import { OCPPClient, SecurityProfile } from "ocpp-ws-io";

const client = new OCPPClient({
  endpoint: "ws://localhost:3000",
  identity: "CP001",
  protocols: ["ocpp1.6"],
  securityProfile: SecurityProfile.NONE,
});

// Register a handler — params are auto-typed for OCPP 1.6 Reset
client.handle("Reset", ({ params, protocol }) => {
  console.log(`Reset requested (${protocol}):`, params.type);
  return { status: "Accepted" };
});

// Connect and send a BootNotification — version-aware, fully typed
await client.connect();

const response = await client.call("ocpp1.6", "BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});

console.log("Status:", response.status); // typed: "Accepted" | "Pending" | "Rejected"
```

### Server (Central System)

```typescript
import { OCPPServer } from "ocpp-ws-io";

const server = new OCPPServer({
  protocols: ["ocpp1.6", "ocpp2.0.1"],
});

// Optional: Add authentication
server.auth((accept, reject, handshake) => {
  console.log(
    `Connection from ${handshake.identity} @ ${handshake.remoteAddress}`,
  );

  if (handshake.identity === "BLOCKED") {
    return reject(401, "Not authorized");
  }

  accept({ session: { authorized: true } });
});

// Handle new client connections
server.on("client", (client) => {
  console.log(`${client.identity} connected (protocol: ${client.protocol})`);

  // Version-aware handlers — params typed per OCPP version
  client.handle("ocpp1.6", "BootNotification", ({ params }) => {
    console.log("OCPP 1.6 Boot:", params.chargePointVendor);
    return {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    };
  });

  client.handle("ocpp2.0.1", "BootNotification", ({ params }) => {
    console.log("OCPP 2.0.1 Boot:", params.chargingStation.vendorName);
    return {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    };
  });

  // Version-aware call from server to client
  const config = await client.call("ocpp1.6", "GetConfiguration", {
    key: ["HeartbeatInterval"],
  });
  console.log("Config:", config.configurationKey);

  client.on("close", () => {
    console.log(`${client.identity} disconnected`);
  });
});

await server.listen(3000);
console.log("OCPP Server listening on port 3000");
```

### Browser Client

For browser environments (React, Vue, Next.js client components, etc.), use `BrowserOCPPClient` from the `ocpp-ws-io/browser` subpath. Designed for **building charge point simulators, testing dashboards, and debugging tools** directly in the browser — zero Node.js dependencies.

> **Note:** The browser client does not support all OCPP features (no Security Profiles, Strict Mode, TLS, Ping/Pong, or custom headers). For production use, use `OCPPClient` in Node.js.

```typescript
import { BrowserOCPPClient } from "ocpp-ws-io/browser";

const client = new BrowserOCPPClient({
  endpoint: "wss://csms.example.com/ocpp",
  identity: "CP001",
  protocols: ["ocpp1.6"],
});

// Same typed API as OCPPClient
client.handle("Reset", ({ params }) => {
  console.log("Reset type:", params.type);
  return { status: "Accepted" };
});

await client.connect();

const response = await client.call("ocpp1.6", "BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});

console.log("Status:", response.status); // typed: "Accepted" | "Pending" | "Rejected"
```

> See [Browser Client](#browser-client-1) below for the full API reference, configuration options, and framework integration examples.

---

## Security Profiles

`ocpp-ws-io` supports all OCPP security profiles out of the box.

### Profile 0 — No Security (Development)

```typescript
const client = new OCPPClient({
  endpoint: "ws://localhost:3000",
  identity: "CP001",
  protocols: ["ocpp1.6"],
  securityProfile: SecurityProfile.NONE,
});
```

### Profile 1 — Basic Auth (Unsecured WS)

```typescript
const client = new OCPPClient({
  endpoint: "ws://localhost:3000",
  identity: "CP001",
  protocols: ["ocpp1.6"],
  securityProfile: SecurityProfile.BASIC_AUTH,
  password: "my-secret-password",
});
```

Server-side password verification:

```typescript
server.auth((accept, reject, handshake) => {
  const expectedPassword = getPasswordForStation(handshake.identity);

  if (
    !handshake.password ||
    !handshake.password.equals(Buffer.from(expectedPassword))
  ) {
    return reject(401, "Invalid credentials");
  }

  accept();
});
```

### Profile 2 — TLS + Basic Auth

```typescript
import fs from "fs";

const client = new OCPPClient({
  endpoint: "wss://csms.example.com",
  identity: "CP001",
  protocols: ["ocpp2.0.1"],
  securityProfile: SecurityProfile.TLS_BASIC_AUTH,
  password: "my-secret-password",
  tls: {
    ca: fs.readFileSync("./certs/ca.pem"),
    rejectUnauthorized: true,
  },
});
```

Server:

```typescript
const server = new OCPPServer({
  protocols: ["ocpp2.0.1"],
  securityProfile: SecurityProfile.TLS_BASIC_AUTH,
  tls: {
    cert: fs.readFileSync("./certs/server.crt"),
    key: fs.readFileSync("./certs/server.key"),
  },
});
```

### Profile 3 — Mutual TLS (Client Certificates)

```typescript
const client = new OCPPClient({
  endpoint: "wss://csms.example.com",
  identity: "CP001",
  protocols: ["ocpp2.0.1"],
  securityProfile: SecurityProfile.TLS_CLIENT_CERT,
  tls: {
    cert: fs.readFileSync("./certs/client.crt"),
    key: fs.readFileSync("./certs/client.key"),
    ca: fs.readFileSync("./certs/ca.pem"),
  },
});
```

Server-side certificate verification:

```typescript
const server = new OCPPServer({
  protocols: ["ocpp2.0.1"],
  securityProfile: SecurityProfile.TLS_CLIENT_CERT,
  tls: {
    cert: fs.readFileSync("./certs/server.crt"),
    key: fs.readFileSync("./certs/server.key"),
    ca: fs.readFileSync("./certs/ca.pem"),
  },
});

server.auth((accept, reject, handshake) => {
  const cert = handshake.clientCertificate;
  if (!cert || cert.subject?.CN !== handshake.identity) {
    return reject(401, "Certificate identity mismatch");
  }
  accept();
});
```

---

## Framework Integration

### Standalone

```typescript
const server = new OCPPServer({ protocols: ["ocpp1.6"] });
await server.listen(3000);
```

### With Express

```typescript
import express from "express";
import { createServer } from "http";
import { OCPPServer } from "ocpp-ws-io";

const app = express();
const httpServer = createServer(app);

const ocppServer = new OCPPServer({ protocols: ["ocpp1.6"] });

await ocppServer.listen(0, undefined, { server: httpServer });

ocppServer.on("client", (client) => {
  console.log(`${client.identity} connected`);
});

httpServer.listen(3000, () => {
  console.log("Express + OCPP on port 3000");
});
```

### With Fastify

```typescript
import Fastify from "fastify";
import { OCPPServer } from "ocpp-ws-io";

const app = Fastify();
const ocppServer = new OCPPServer({ protocols: ["ocpp2.0.1"] });

app.ready().then(async () => {
  await ocppServer.listen(0, undefined, { server: app.server });
});

ocppServer.on("client", (client) => {
  console.log(`${client.identity} connected`);
});

await app.listen({ port: 3000 });
```

### Manual `handleUpgrade`

For maximum control, use the `handleUpgrade` getter directly:

```typescript
import { createServer } from "http";
import { OCPPServer } from "ocpp-ws-io";

const httpServer = createServer();
const ocppServer = new OCPPServer({ protocols: ["ocpp1.6"] });

httpServer.on("upgrade", ocppServer.handleUpgrade);

httpServer.listen(3000);
```

---

## Type-Safe API

`ocpp-ws-io` includes auto-generated TypeScript types for **all** OCPP methods across 1.6, 2.0.1, and 2.1. When you call `handle()` or `call()` with a known method name, both request params and response types are inferred automatically. Custom/vendor-specific methods are also supported — they use `Record<string, any>` params.

### Version-Aware `handle()` and `call()`

Both `handle()` and `call()` support **version-specific overloads** — params and response types are inferred from the OCPP version you specify:

```typescript
// ✅ Version-aware handle — params typed per version
client.handle("ocpp1.6", "BootNotification", ({ params }) => {
  params.chargePointVendor; // ✅ string (OCPP 1.6 shape)
  return { status: "Accepted", currentTime: "...", interval: 300 };
});

client.handle("ocpp2.0.1", "BootNotification", ({ params }) => {
  params.chargingStation; // ✅ { model, vendorName } (OCPP 2.0.1 shape)
  return { status: "Accepted", currentTime: "...", interval: 300 };
});

// ✅ Version-aware call — params and response typed per version
const res16 = await client.call("ocpp1.6", "BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});
res16.status; // typed: "Accepted" | "Pending" | "Rejected"

const res201 = await client.call("ocpp2.0.1", "BootNotification", {
  chargingStation: { model: "ModelX", vendorName: "VendorY" },
  reason: "PowerUp",
});
res201.status; // typed for 2.0.1
```

### Default Protocol and Untyped Calls

```typescript
// Default protocol — uses the client's type parameter P
const res = await client.call("BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});

// Custom/extension methods — loose typing
client.handle("VendorCustomAction", ({ params }) => {
  params; // Record<string, any>
  return { result: "ok" };
});

const custom = await client.call<{ result: string }>("VendorCustomAction", {
  data: "hello",
});
custom.result; // string
```

````

**Dispatch priority**: When a call arrives, the runtime looks up handlers in this order:

1. **Version-specific** handler (e.g., `"ocpp1.6:BootNotification"`)
2. **Generic** handler (e.g., `"BootNotification"`)
3. **Wildcard** handler

### Handler Context

Every handler receives a `HandlerContext` with:

```typescript
client.handle("Reset", ({ params, protocol, method, messageId, signal }) => {
  params; // typed request body
  protocol; // "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1" | undefined
  method; // "Reset"
  messageId; // unique call ID
  signal; // AbortSignal
  return { status: "Accepted" };
});
````

### `removeHandler` with Version Support

```typescript
// Remove a generic handler
client.removeHandler("Reset");

// Remove a version-specific handler
client.removeHandler("ocpp1.6", "Reset");

// Remove wildcard handler
client.removeHandler();

// Remove all handlers
client.removeAllHandlers();
```

### Available Generated Type Utilities

```typescript
import type {
  OCPPProtocol, // "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1"
  OCPPProtocolKey, // keyof OCPPMethodMap — extensible via module augmentation
  OCPPMethodMap, // Full method map interface
  AllMethodNames, // All method names for a given protocol
  OCPPRequestType, // Request type for a method, e.g. OCPPRequestType<"ocpp1.6", "Reset">
  OCPPResponseType, // Response type for a method
} from "ocpp-ws-io";

// Example: Get all method names for OCPP 1.6
type OCPP16Methods = AllMethodNames<"ocpp1.6">;
// "Authorize" | "BootNotification" | "ChangeAvailability" | ...

// Example: Get request params type
type BootReq = OCPPRequestType<"ocpp1.6", "BootNotification">;
// { chargePointVendor: string; chargePointModel: string; ... }
```

---

## Strict Mode (Schema Validation)

Enable strict mode to validate all inbound and outbound messages against the OCPP JSON schemas:

```typescript
const client = new OCPPClient({
  endpoint: "ws://localhost:3000",
  identity: "CP001",
  protocols: ["ocpp1.6"],
  strictMode: true, // validates all calls against built-in schemas
});

// If validation fails, an RPCError is thrown automatically
client.on("strictValidationFailure", ({ message, error }) => {
  console.error("Validation failed:", error.message);
});
```

You can restrict strict mode to specific subprotocols:

```typescript
const client = new OCPPClient({
  protocols: ["ocpp1.6", "ocpp2.0.1"],
  strictMode: ["ocpp2.0.1"], // only validate OCPP 2.0.1 messages
});
```

Custom validators:

```typescript
import { createValidator } from "ocpp-ws-io";
import myCustomSchemas from "./my-schemas.json";

const myValidator = createValidator("vendor-proto", myCustomSchemas);

const client = new OCPPClient({
  protocols: ["ocpp1.6", "vendor-proto"],
  strictMode: true,
  strictModeValidators: [myValidator], // adds to built-in validators
});
```

> **Tip:** Combine custom validators with module augmentation to get both runtime validation **and** compile-time type safety. See [Extending with Custom Protocols](#extending-with-custom-protocols) below.

---

## Extending with Custom Protocols

`OCPPMethodMap` is a TypeScript **interface**, so you can extend it with your own protocols using [module augmentation](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation). This gives you full type safety for custom/vendor-specific protocols in `handle()`, `call()`, and `protocols`.

### Step 1: Define Your Method Types

```typescript
// src/vendor-types.ts
export interface MyVendorMethods {
  VendorAction: {
    request: { data: string; priority: number };
    response: { status: "Accepted" | "Rejected" };
  };
  VendorQuery: {
    request: { query: string };
    response: { results: string[] };
  };
}
```

### Step 2: Augment OCPPMethodMap

```typescript
// src/ocpp-extensions.d.ts
import type { MyVendorMethods } from "./vendor-types";

declare module "ocpp-ws-io" {
  interface OCPPMethodMap {
    "vendor-proto": MyVendorMethods;
  }
}
```

### Step 3: Use Everywhere — Fully Typed

```typescript
import { OCPPClient, createValidator } from "ocpp-ws-io";
import vendorSchemas from "./vendor-schemas.json";

const vendorValidator = createValidator("vendor-proto", vendorSchemas);

const client = new OCPPClient({
  endpoint: "ws://localhost:3000",
  identity: "CP001",
  protocols: ["ocpp1.6", "vendor-proto"], // ✅ autocompletes
  strictMode: true,
  strictModeValidators: [vendorValidator],
});

// ✅ Fully typed handle
client.handle("vendor-proto", "VendorAction", ({ params }) => {
  console.log(params.data); // string
  console.log(params.priority); // number
  return { status: "Accepted" }; // typed response
});

// ✅ Fully typed call
const res = await client.call("vendor-proto", "VendorQuery", {
  query: "status",
});
console.log(res.results); // string[]
```

---

## Clustering with Redis

For multi-instance deployments behind a load balancer, use the `RedisAdapter` to distribute events across processes:

```typescript
import { OCPPServer } from "ocpp-ws-io";
import { RedisAdapter } from "ocpp-ws-io/adapters/redis";
import Redis from "ioredis";

const server = new OCPPServer({ protocols: ["ocpp2.0.1"] });

server.setAdapter(
  new RedisAdapter({
    pubClient: new Redis(process.env.REDIS_URL),
    subClient: new Redis(process.env.REDIS_URL),
    prefix: "ocpp-cluster:", // optional
  }),
);

server.on("client", (client) => {
  console.log(`${client.identity} connected`);
});

await server.listen(3000);
```

The adapter automatically detects and works with both `ioredis` and `node-redis` (v4+).

```typescript
// With node-redis
import { createClient } from "redis";

const pub = createClient({ url: process.env.REDIS_URL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);

server.setAdapter(new RedisAdapter({ pubClient: pub, subClient: sub }));
```

## Type Generation

Re-generate TypeScript definitions from the latest OCPP JSON schemas:

```bash
npm run generate
```

---

## API Reference

### `OCPPClient`

```typescript
import { OCPPClient } from "ocpp-ws-io";
```

#### Constructor

```typescript
const client = new OCPPClient(options: ClientOptions);
```

**`ClientOptions`**:

| Option                      | Type                     | Default    | Description                                  |
| --------------------------- | ------------------------ | ---------- | -------------------------------------------- |
| `identity`                  | `string`                 | _required_ | Charging station ID                          |
| `endpoint`                  | `string`                 | _required_ | WebSocket URL (`ws://` or `wss://`)          |
| `protocols`                 | `OCPPProtocol[]`         | `[]`       | OCPP subprotocols to negotiate               |
| `securityProfile`           | `SecurityProfile`        | `NONE`     | Security profile (0–3)                       |
| `password`                  | `string \| Buffer`       | —          | Password for Basic Auth (Profile 1 & 2)      |
| `tls`                       | `TLSOptions`             | —          | TLS/SSL options (Profile 2 & 3)              |
| `headers`                   | `Record<string, string>` | —          | Additional WebSocket headers                 |
| `query`                     | `Record<string, string>` | —          | Additional URL query parameters              |
| `reconnect`                 | `boolean`                | `true`     | Auto-reconnect on disconnect                 |
| `maxReconnects`             | `number`                 | `Infinity` | Max reconnection attempts                    |
| `backoffMin`                | `number`                 | `1000`     | Initial reconnect delay (ms)                 |
| `backoffMax`                | `number`                 | `30000`    | Maximum reconnect delay (ms)                 |
| `callTimeoutMs`             | `number`                 | `30000`    | Default RPC call timeout (ms)                |
| `pingIntervalMs`            | `number`                 | `30000`    | WebSocket ping interval (ms), `0` to disable |
| `deferPingsOnActivity`      | `boolean`                | `false`    | Defer pings when messages received           |
| `callConcurrency`           | `number`                 | `1`        | Max concurrent outbound calls                |
| `strictMode`                | `boolean \| string[]`    | `false`    | Enable/restrict schema validation            |
| `strictModeValidators`      | `Validator[]`            | —          | Custom validators for strict mode            |
| `maxBadMessages`            | `number`                 | `Infinity` | Close after N consecutive bad messages       |
| `respondWithDetailedErrors` | `boolean`                | `false`    | Include error details in responses           |

#### Properties

| Property                 | Type                  | Description                                          |
| ------------------------ | --------------------- | ---------------------------------------------------- |
| `client.identity`        | `string`              | Charging station identity                            |
| `client.protocol`        | `string \| undefined` | Negotiated subprotocol                               |
| `client.state`           | `ConnectionState`     | Connection state (CONNECTING, OPEN, CLOSING, CLOSED) |
| `client.securityProfile` | `SecurityProfile`     | Active security profile                              |

#### Methods

```typescript
// Connect to the OCPP server
await client.connect();

// Version-aware call — fully typed params and response
const result = await client.call("ocpp1.6", "BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});

// OCPP 2.0.1 — different shape, still fully typed
const result201 = await client.call("ocpp2.0.1", "BootNotification", {
  chargingStation: { model: "ModelX", vendorName: "VendorY" },
  reason: "PowerUp",
});

// Default protocol call (uses the client's type parameter P)
const res = await client.call("Heartbeat", {});

// Explicit response type (for custom/vendor methods)
const custom = await client.call<{ result: string }>("VendorAction", {
  data: "hello",
});

// Call with options
const res2 = await client.call("ocpp1.6", "RemoteStartTransaction", params, {
  timeoutMs: 5000,
});

// Register a typed handler for a specific method
client.handle("Reset", ({ params, protocol, method, messageId, signal }) => {
  return { status: "Accepted" };
});

// Register a version-specific handler
client.handle("ocpp1.6", "BootNotification", ({ params }) => {
  params.chargePointVendor; // typed for OCPP 1.6 only
  return { status: "Accepted", currentTime: "...", interval: 300 };
});

// Register a handler for a custom/vendor method
client.handle("VendorCustomAction", ({ params }) => {
  return { result: "ok" };
});

// Register a wildcard handler (handles all unmatched methods)
client.handle((method, { params }) => {
  console.log(`Unhandled method: ${method}`);
  throw new RPCNotImplementedError();
});

// Remove handlers
client.removeHandler("Reset"); // remove generic
client.removeHandler("ocpp1.6", "Reset"); // remove version-specific
client.removeHandler(); // remove wildcard
client.removeAllHandlers(); // remove all

// Close the connection
await client.close();
await client.close({ code: 1000, reason: "Normal closure" });
await client.close({ awaitPending: true }); // wait for in-flight calls
await client.close({ force: true }); // immediate termination

// Reconfigure at runtime
client.reconfigure({ callTimeoutMs: 10000 });

// Send a raw message (advanced — use with caution)
client.sendRaw(JSON.stringify([2, "uuid", "Heartbeat", {}]));
```

#### Events

```typescript
client.on("open", ({ response }) => {
  /* connected */
});
client.on("close", ({ code, reason }) => {
  /* disconnected */
});
client.on("error", (error) => {
  /* error occurred */
});
client.on("connecting", ({ url }) => {
  /* attempting connection */
});
client.on("reconnect", ({ attempt, delay }) => {
  /* reconnecting */
});
client.on("message", (message) => {
  /* raw OCPP message */
});
client.on("call", (call) => {
  /* outbound call sent */
});
client.on("callResult", (result) => {
  /* call result received */
});
client.on("callError", (error) => {
  /* call error received */
});
client.on("badMessage", ({ message, error }) => {
  /* malformed message */
});
client.on("ping", () => {
  /* ping sent */
});
client.on("pong", () => {
  /* pong received */
});
client.on("strictValidationFailure", ({ message, error }) => {
  /* schema validation failure */
});
```

---

### `OCPPServer`

```typescript
import { OCPPServer } from "ocpp-ws-io";
```

#### Constructor

```typescript
const server = new OCPPServer(options?: ServerOptions);
```

**`ServerOptions`**:

| Option                      | Type                  | Default    | Description                               |
| --------------------------- | --------------------- | ---------- | ----------------------------------------- |
| `protocols`                 | `OCPPProtocol[]`      | `[]`       | Accepted OCPP subprotocols                |
| `securityProfile`           | `SecurityProfile`     | `NONE`     | Security profile for auto-created servers |
| `tls`                       | `TLSOptions`          | —          | TLS options (Profile 2 & 3)               |
| `callTimeoutMs`             | `number`              | `30000`    | Inherited by server clients               |
| `pingIntervalMs`            | `number`              | `30000`    | Inherited by server clients               |
| `callConcurrency`           | `number`              | `1`        | Inherited by server clients               |
| `strictMode`                | `boolean \| string[]` | `false`    | Inherited by server clients               |
| `maxBadMessages`            | `number`              | `Infinity` | Inherited by server clients               |
| `respondWithDetailedErrors` | `boolean`             | `false`    | Inherited by server clients               |

#### Properties

| Property         | Type                            | Description           |
| ---------------- | ------------------------------- | --------------------- |
| `server.clients` | `ReadonlySet<OCPPServerClient>` | All connected clients |

#### Methods

```typescript
// Start listening on a port
const httpServer = await server.listen(port, host?, options?);

// Attach authentication handler
server.auth((accept, reject, handshake, signal) => {
  // handshake contains: identity, remoteAddress, headers,
  // protocols, endpoint, query, password, clientCertificate,
  // securityProfile, request
  accept({ session: { userId: 123 } });
  // or: reject(401, 'Not authorized');
});

// Close the server
await server.close();
await server.close({ awaitPending: true });

// Set an event adapter for clustering
server.setAdapter(adapter);

// Publish events across instances
await server.publish('firmware-update', { stationId: 'CP001' });

// Reconfigure at runtime
server.reconfigure({ callTimeoutMs: 60000 });

// Get the handleUpgrade function for manual use
const upgrade = server.handleUpgrade;
httpServer.on('upgrade', upgrade);
```

#### Events

```typescript
server.on("client", (client: OCPPServerClient) => {
  /* new client connected */
});
server.on("error", (error) => {
  /* server error */
});
server.on("upgradeError", ({ error, socket }) => {
  /* upgrade failed */
});
```

---

### `OCPPServerClient`

Server-side client representation, created automatically when a charging station connects. Extends `OCPPClient` with additional properties:

```typescript
server.on("client", (client) => {
  client.identity; // string — station identity
  client.protocol; // string — negotiated subprotocol
  client.session; // Record<string, unknown> — session data from auth
  client.handshake; // HandshakeInfo — connection handshake details

  // All OCPPClient methods available — version-aware:
  client.handle("ocpp1.6", "Heartbeat", () => ({
    currentTime: new Date().toISOString(),
  }));
  const result = await client.call("ocpp1.6", "GetConfiguration", { key: [] });
  await client.close();
});
```

---

### `NOREPLY`

Return `NOREPLY` from a handler to suppress the automatic response:

```typescript
import { NOREPLY } from "ocpp-ws-io";

client.handle("StatusNotification", ({ params }) => {
  // Process the notification but don't send a response
  return NOREPLY;
});
```

---

### Error Classes

All error classes are exported for `instanceof` checks:

```typescript
import {
  // Base errors
  TimeoutError, // Call timeout
  UnexpectedHttpResponse, // Non-101 upgrade response
  WebsocketUpgradeError, // WebSocket upgrade failure

  // RPC errors (OCPP-J spec Section 4.3)
  RPCGenericError,
  RPCNotImplementedError,
  RPCNotSupportedError,
  RPCInternalError,
  RPCProtocolError,
  RPCSecurityError,
  RPCFormatViolationError,
  RPCFormationViolationError,
  RPCPropertyConstraintViolationError,
  RPCOccurrenceConstraintViolationError,
  RPCTypeConstraintViolationError,
  RPCMessageTypeNotSupportedError,
  RPCFrameworkError,
} from "ocpp-ws-io";
```

Throw typed errors from handlers:

```typescript
client.handle("Reset", ({ params }) => {
  if (params.type === "Hard") {
    throw new RPCNotSupportedError("Hard reset not supported");
  }
  return { status: "Accepted" };
});
```

---

### Utility Functions

```typescript
import {
  createRPCError,
  getErrorPlainObject,
  getPackageIdent,
} from "ocpp-ws-io";

// Create an RPC error from a code string
const err = createRPCError("NotImplemented", "Not available");

// Serialize an error to a plain JSON-safe object
const plain = getErrorPlainObject(err);

// Get package identifier (for headers, logging)
const ident = getPackageIdent(); // "ocpp-ws-io/1.0.0"
```

---

## Constants

```typescript
import { ConnectionState, MessageType, SecurityProfile } from "ocpp-ws-io";

// Connection states
ConnectionState.CONNECTING; // 0
ConnectionState.OPEN; // 1
ConnectionState.CLOSING; // 2
ConnectionState.CLOSED; // 3

// Also available as static properties
OCPPClient.CONNECTING;
OCPPClient.OPEN;
OCPPClient.CLOSING;
OCPPClient.CLOSED;

// Message types
MessageType.CALL; // 2
MessageType.CALLRESULT; // 3
MessageType.CALLERROR; // 4

// Security profiles
SecurityProfile.NONE; // 0
SecurityProfile.BASIC_AUTH; // 1
SecurityProfile.TLS_BASIC_AUTH; // 2
SecurityProfile.TLS_CLIENT_CERT; // 3
```

---

## TypeScript Types

All types are exported for use in your application:

```typescript
import type {
  // OCPP protocol types (auto-generated)
  OCPPProtocol, // "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1"
  OCPPProtocolKey, // keyof OCPPMethodMap — extensible via module augmentation
  AllMethodNames, // Union of method names for a protocol
  OCPPRequestType, // Request type for a method + protocol
  OCPPResponseType, // Response type for a method + protocol
  OCPPMethodMap, // Full method map interface

  // OCPP message types
  OCPPCall,
  OCPPCallResult,
  OCPPCallError,
  OCPPMessage,

  // Handler types
  HandlerContext,
  CallHandler,
  WildcardHandler,

  // Option types
  ClientOptions,
  ServerOptions,
  CallOptions,
  CloseOptions,
  ListenOptions,
  TLSOptions,

  // Auth types
  AuthAccept,
  AuthCallback,
  HandshakeInfo,
  SessionData,

  // Event types
  ClientEvents,
  ServerEvents,
  TypedEventEmitter,

  // Server client interface
  ServerClientInstance,

  // Adapter interface (for custom adapters)
  EventAdapterInterface,
} from "ocpp-ws-io";
```

---

## Browser Client

`BrowserOCPPClient` is a lightweight OCPP WebSocket RPC client designed for **building charge point simulators, testing dashboards, and debugging tools** in the browser. It provides the same typed API as `OCPPClient` — without any Node.js dependencies.

> **Note:** The browser client is designed for testing and simulating charge points — it does not support all OCPP features. Missing: Security Profiles (0–3), Strict Mode (schema validation), TLS/mTLS configuration, WebSocket Ping/Pong, and custom HTTP headers. For production charge point communication, use `OCPPClient` in a Node.js environment.

```typescript
import { BrowserOCPPClient } from "ocpp-ws-io/browser";
```

### Why a Separate Browser Client?

`OCPPClient` depends on Node.js modules (`ws`, `node:crypto`, `node:events`, `node:net`). `BrowserOCPPClient` replaces all of these with browser-native APIs:

| Feature           | `OCPPClient`           | `BrowserOCPPClient`        |
| ----------------- | ---------------------- | -------------------------- |
| WebSocket         | `ws` (Node.js)         | Native browser `WebSocket` |
| Events            | `node:events`          | Custom `EventEmitter`      |
| ID Generation     | `@paralleldrive/cuid2` | `@paralleldrive/cuid2`     |
| Security Profiles | 0–3 (TLS, mTLS, certs) | N/A (handled by browser)   |
| Custom Headers    | ✅ via `ws`            | ❌ browser limitation      |
| Ping/Pong         | ✅                     | ❌ browser limitation      |
| Type Safety       | ✅ Full                | ✅ Full (same types)       |
| Reconnection      | ✅                     | ✅                         |
| Strict Mode       | ✅                     | ❌                         |

### Constructor

```typescript
const client = new BrowserOCPPClient(options: BrowserClientOptions);
```

**`BrowserClientOptions`**:

| Option                      | Type                     | Default    | Description                            |
| --------------------------- | ------------------------ | ---------- | -------------------------------------- |
| `identity`                  | `string`                 | _required_ | Charging station ID                    |
| `endpoint`                  | `string`                 | _required_ | WebSocket URL (`ws://` or `wss://`)    |
| `protocols`                 | `string[]`               | `[]`       | OCPP subprotocols to negotiate         |
| `query`                     | `Record<string, string>` | —          | Additional URL query parameters        |
| `reconnect`                 | `boolean`                | `true`     | Auto-reconnect on disconnect           |
| `maxReconnects`             | `number`                 | `Infinity` | Max reconnection attempts              |
| `backoffMin`                | `number`                 | `1000`     | Initial reconnect delay (ms)           |
| `backoffMax`                | `number`                 | `30000`    | Maximum reconnect delay (ms)           |
| `callTimeoutMs`             | `number`                 | `30000`    | Default RPC call timeout (ms)          |
| `callConcurrency`           | `number`                 | `1`        | Max concurrent outbound calls          |
| `maxBadMessages`            | `number`                 | `Infinity` | Close after N consecutive bad messages |
| `respondWithDetailedErrors` | `boolean`                | `false`    | Include error details in responses     |

### Properties

| Property          | Type                  | Description               |
| ----------------- | --------------------- | ------------------------- |
| `client.identity` | `string`              | Charging station identity |
| `client.protocol` | `string \| undefined` | Negotiated subprotocol    |
| `client.state`    | `ConnectionState`     | Current connection state  |

### Static Constants

```typescript
BrowserOCPPClient.CONNECTING; // 0
BrowserOCPPClient.OPEN; // 1
BrowserOCPPClient.CLOSING; // 2
BrowserOCPPClient.CLOSED; // 3
```

### Methods

The API is identical to `OCPPClient` — all `call()`, `handle()`, `close()`, `sendRaw()`, `reconfigure()`, `removeHandler()`, and `removeAllHandlers()` methods work the same way with the same type signatures.

```typescript
// Connect
await client.connect();

// Version-aware typed call
const result = await client.call("ocpp1.6", "BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});

// Call with timeout and AbortSignal
const controller = new AbortController();
const res = await client.call(
  "Heartbeat",
  {},
  {
    timeoutMs: 5000,
    signal: controller.signal,
  },
);

// Register handlers (version-specific, generic, wildcard)
client.handle("ocpp1.6", "Reset", ({ params }) => {
  return { status: "Accepted" };
});

client.handle("StatusNotification", ({ params }) => {
  return {};
});

client.handle((method, { params }) => {
  console.log(`Unhandled: ${method}`);
  return {};
});

// Close the connection
await client.close();
await client.close({ code: 1000, reason: "Normal" });
await client.close({ awaitPending: true });
await client.close({ force: true });

// Reconfigure at runtime
client.reconfigure({ callTimeoutMs: 10000, reconnect: false });
```

### Events

```typescript
client.on("open", (event) => {
  /* connected */
});
client.on("close", ({ code, reason }) => {
  /* disconnected */
});
client.on("error", (error) => {
  /* error occurred */
});
client.on("connecting", ({ url }) => {
  /* attempting connection */
});
client.on("reconnect", ({ attempt, delay }) => {
  /* reconnecting */
});
client.on("message", (message) => {
  /* any OCPP message */
});
client.on("call", (call) => {
  /* incoming call */
});
client.on("callResult", (result) => {
  /* call result received */
});
client.on("callError", (error) => {
  /* call error received */
});
client.on("badMessage", ({ message, error }) => {
  /* malformed message */
});
```

### Framework Integration

#### React

```typescript
import { useEffect, useRef, useState } from "react";
import { BrowserOCPPClient } from "ocpp-ws-io/browser";

function useOCPP(identity: string, endpoint: string) {
  const clientRef = useRef<BrowserOCPPClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const client = new BrowserOCPPClient({
      identity,
      endpoint,
      protocols: ["ocpp1.6"],
    });

    client.on("open", () => setConnected(true));
    client.on("close", () => setConnected(false));

    client.connect();
    clientRef.current = client;

    return () => {
      client.close();
    };
  }, [identity, endpoint]);

  return { client: clientRef.current, connected };
}
```

#### Next.js (Client Component)

```typescript
"use client";
import { BrowserOCPPClient } from "ocpp-ws-io/browser";

// ✅ Works in client components — no Node.js dependencies
const client = new BrowserOCPPClient({
  identity: "CP001",
  endpoint: "wss://csms.example.com/ocpp",
  protocols: ["ocpp1.6"],
});
```

### Browser Exports

All exports from `ocpp-ws-io/browser`:

```typescript
import {
  // Client
  BrowserOCPPClient,

  // Error classes
  RPCGenericError,
  RPCNotImplementedError,
  RPCNotSupportedError,
  RPCInternalError,
  RPCProtocolError,
  RPCSecurityError,
  RPCFormatViolationError,
  RPCFormationViolationError,
  RPCPropertyConstraintViolationError,
  RPCOccurrenceConstraintViolationError,
  RPCTypeConstraintViolationError,
  RPCMessageTypeNotSupportedError,
  RPCFrameworkError,
  TimeoutError,

  // Utilities
  createRPCError,
  getErrorPlainObject,

  // Constants
  ConnectionState,
  MessageType,
  NOREPLY,
} from "ocpp-ws-io/browser";
```

---

## Requirements

- **Node.js** ≥ 18.0.0 (for `OCPPClient` and `OCPPServer`)
- **Browser**: Any modern browser with `WebSocket` support (for `BrowserOCPPClient`)
- **TypeScript** ≥ 5.0 (optional, but recommended)

## Inspired By

This project is inspired by [ocpp-rpc](https://github.com/mikuso/ocpp-rpc) — a well-crafted OCPP-J RPC library for Node.js. `ocpp-ws-io` builds on similar ideas while adding full TypeScript type safety, version-aware APIs, built-in schema validation, and clustering support.

## License

[MIT](LICENSE)
