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

| Option            | Type              | Default | Description                               |
| ----------------- | ----------------- | ------- | ----------------------------------------- |
| `protocols`       | `OCPPProtocol[]`  | `[]`    | Accepted OCPP subprotocols                |
| `securityProfile` | `SecurityProfile` | `NONE`  | Security profile for auto-created servers |
| `tls`             | `TLSOptions`      | —       | TLS options (Profile 2 & 3)               |
