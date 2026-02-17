# ocpp-ws-io

Type-safe OCPP WebSocket RPC client & server for Node.js.

Built with TypeScript from the ground up — supports OCPP 1.6, 2.0.1, and 2.1 with full JSON schema validation, all three security profiles, and optional Redis-based clustering.

## Features

- ⚡ **Full OCPP-J RPC** — Call, CallResult, CallError message framing per OCPP-J spec
- 🔒 **Security Profiles 0–3** — Plain WS, Basic Auth, TLS + Basic Auth, Mutual TLS
- 📐 **Strict Mode** — Optional schema validation using built-in OCPP JSON schemas
- 🔁 **Auto-Reconnect** — Exponential backoff with configurable limits
- 🧩 **Framework Agnostic** — Use standalone, or attach to Express, Fastify, NestJS, etc.
- 📡 **Clustering** — Optional Redis adapter for multi-instance deployments
- 🎯 **Type-Safe** — Full TypeScript types for events, handlers, options, and messages

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

// Register a handler for incoming calls from the server
client.handle("Reset", ({ params }) => {
  console.log("Reset requested:", params);
  return { status: "Accepted" };
});

// Connect and send a BootNotification
await client.connect();

const response = await client.call("BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});

console.log("BootNotification response:", response);
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

  // Handle BootNotification from this client
  client.handle("BootNotification", ({ params }) => {
    console.log("BootNotification:", params);
    return {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    };
  });

  // Send a call TO the client
  client
    .call("GetConfiguration", { key: ["HeartbeatInterval"] })
    .then((result) => console.log("GetConfiguration result:", result))
    .catch((err) => console.error("GetConfiguration failed:", err));

  client.on("close", () => {
    console.log(`${client.identity} disconnected`);
  });
});

await server.listen(3000);
console.log("OCPP Server listening on port 3000");
```

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

const myValidator = createValidator("custom-protocol", myCustomSchemas);

const client = new OCPPClient({
  protocols: ["custom-protocol"],
  strictMode: true,
  strictModeValidators: [myValidator],
});
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
    pubClient: new Redis(),
    subClient: new Redis(),
    prefix: "ocpp:", // optional, default: 'ocpp-ws-io:'
  }),
);

server.on("client", (client) => {
  console.log(`${client.identity} connected`);
});

await server.listen(3000);
```

The adapter is generic — it works with `ioredis`, `redis` (node-redis), or any client implementing the `RedisLikeClient` interface.

```typescript
// With node-redis
import { createClient } from "redis";

const pub = createClient();
const sub = pub.duplicate();
await pub.connect();
await sub.connect();

server.setAdapter(new RedisAdapter({ pubClient: pub, subClient: sub }));
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
| `protocols`                 | `string[]`               | `[]`       | OCPP subprotocols to negotiate               |
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

// Make an RPC call
const result = await client.call('BootNotification', { ... });

// Make a call with options
const result = await client.call('RemoteStartTransaction', params, {
  timeoutMs: 5000,
  signal: abortController.signal,
});

// Register a handler for a specific method
client.handle('Reset', ({ params, method, messageId, signal }) => {
  return { status: 'Accepted' };
});

// Register a wildcard handler (handles all unmatched methods)
client.handle((method, { params }) => {
  console.log(`Unhandled method: ${method}`);
  throw new RPCNotImplementedError();
});

// Remove a handler
client.removeHandler('Reset');
client.removeAllHandlers();

// Close the connection
await client.close();
await client.close({ code: 1000, reason: 'Normal closure' });
await client.close({ awaitPending: true }); // wait for in-flight calls
await client.close({ force: true });        // immediate termination

// Reconfigure at runtime
client.reconfigure({ callTimeoutMs: 10000 });

// Send a raw message (advanced — use with caution)
client.sendRaw(JSON.stringify([2, 'uuid', 'Heartbeat', {}]));
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
| `protocols`                 | `string[]`            | `[]`       | Accepted OCPP subprotocols                |
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

  // All OCPPClient methods available:
  client.handle("Heartbeat", () => ({ currentTime: new Date().toISOString() }));
  const result = await client.call("GetConfiguration", { key: [] });
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

  // Adapter interface (for custom adapters)
  EventAdapterInterface,
} from "ocpp-ws-io";
```

---

## Requirements

- **Node.js** ≥ 18.0.0
- **TypeScript** ≥ 5.0 (optional, but recommended)

## License

[MIT](LICENSE)
