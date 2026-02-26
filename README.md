<div align="center">

<p align="center">
  <img src="https://raw.githubusercontent.com/rohittiwari-dev/ocpp-ws-io/main/assets/banner.svg" alt="ocpp-ws-io" width="420" />
</p>

**Type-safe OCPP WebSocket RPC client & server for Node.js**

Built with TypeScript from the ground up — supports OCPP 1.6, 2.0.1, and 2.1 with optional JSON schema validation, all security profiles, Redis-based clustering, and structured logging powered by [voltlog-io](https://ocpp-ws-io.rohittiwari.me/docs/voltlog-io).

[![npm version](https://img.shields.io/npm/v/ocpp-ws-io.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/ocpp-ws-io)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[Documentation](https://ocpp-ws-io.rohittiwari.me) · [API Reference](https://ocpp-ws-io.rohittiwari.me/docs/api-reference) · [npm](https://www.npmjs.com/package/ocpp-ws-io) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why ocpp-ws-io?

Building an OCPP-compliant charging station management system (CSMS) or charge point simulator shouldn't require guessing payload shapes or hand-writing validation logic. **ocpp-ws-io** gives you:

- ⚡ **Full OCPP-J RPC** — Call, CallResult, CallError message framing per spec
- 🎯 **End-to-end type safety** — Auto-generated TypeScript types for all OCPP 1.6, 2.0.1, and 2.1 methods
- 🔒 **Security Profiles 0–3** — Plain WS, Basic Auth, TLS + Basic Auth, Mutual TLS
- 📐 **Schema Validation** — Optional strict mode with built-in JSON schema validation
- 🚦 **DDoS Protection** — Socket-layer Token Bucket Rate Limiting per station and method
- 🔁 **Auto-Reconnect & Rehydration** — Exponential backoff with Eager Redis state-synchronization
- 🧩 **Framework Agnostic** — Standalone, Express, Fastify, NestJS, or custom `handleUpgrade`
- 📡 **Clustering** — Redis adapter for multi-instance deployments with durable message delivery via Streams
- 📊 **Prometheus Ready** — Turnkey `/health` and `/metrics` observability endpoints
- 🪵 **Logging** — Built-in structured logging powered by [voltlog-io](https://ocpp-ws-io.rohittiwari.me/docs/voltlog-io)
- 🌐 **Browser Client** — Zero-dependency browser WebSocket client via `ocpp-ws-io/browser`
- 🔀 **Express-style Routing** — Dynamically scope auth and middleware across `OCPPRouter` URL paths
- 🔑 **Idempotency Keys** — Single Source of Truth message tracking guaranteeing exactly-once delivery on retries
- ⚡ **CLI Ecosystem** — Built-in `ocpp-ws-cli` for generating types, load testing, fuzzing, and simulating virtual charge points

## Quick Start

### Install

```bash
npm install ocpp-ws-io
```

### Client (Charging Station)

```typescript
import { OCPPClient, SecurityProfile } from "ocpp-ws-io";

const client = new OCPPClient({
  endpoint: "ws://localhost:3000/api/v1/chargers",
  identity: "CP001",
  protocols: ["ocpp1.6"],
  securityProfile: SecurityProfile.NONE,
  logging: { prettify: true, exchangeLog: true }, // ⚡ See the traffic!
});

client.handle("Reset", ({ params }) => {
  console.log("Reset type:", params.type);
  return { status: "Accepted" };
});

await client.connect();

const response = await client.call("ocpp1.6", "BootNotification", {
  chargePointVendor: "VendorX",
  chargePointModel: "ModelY",
});

console.log("Status:", response.status); // "Accepted" | "Pending" | "Rejected"
```

### Server (Central System)

```typescript
import { OCPPServer } from "ocpp-ws-io";

const server = new OCPPServer({
  protocols: ["ocpp1.6", "ocpp2.0.1"],
  logging: { prettify: true, exchangeLog: true, level: "info" },
});

server.auth((ctx) => {
  console.log(
    `Connection from ${ctx.handshake.identity} at path ${ctx.handshake.pathname}`,
  );
  ctx.accept({ session: { authorized: true } });
});

server.on("client", (client) => {
  console.log(`${client.identity} connected (${client.protocol})`);

  client.handle("ocpp1.6", "BootNotification", ({ params }) => {
    return {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      interval: 300,
    };
  });
});

await server.listen(3000);
```

> 📖 **Full documentation** — See the [complete README](packages/ocpp-ws-io/README.md) for security profiles, framework integration, clustering, strict mode, browser client, custom protocols, and the full API reference.

## Monorepo Structure

```
ocpp-ws-io/
├── packages/
│   ├── ocpp-ws-io/          # Core OCPP WebSocket library (npm: ocpp-ws-io)
│   └── cli/                 # The CLI ecosystem (npm: ocpp-ws-cli)
├── apps/
│   └── docs/                # Documentation site (ocpp-ws-io.rohittiwari.me)
└── .github/
    └── workflows/           # CI/CD pipelines
```

| Package                                      | Description                               | Status       |
| -------------------------------------------- | ----------------------------------------- | ------------ |
| [`ocpp-ws-io`](packages/ocpp-ws-io)          | Core OCPP WebSocket RPC client & server   | ✅ Published |
| [`ocpp-ws-cli`](packages/cli)                | CLI for generation, simulation & testing  | ✅ Published |
| [`voltlog-io`](https://npmjs.com/voltlog-io) | Structured Logger (Maintained Separately) | ✅ Published |

## Requirements

- **Node.js** ≥ 18.0.0
- **TypeScript** ≥ 5.0 (optional, but recommended)
- **Browser**: Any modern browser with `WebSocket` support (for `BrowserOCPPClient`)

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Setting up the development environment
- Submitting pull requests
- Code style and commit conventions

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## Security

To report a security vulnerability, please see our [Security Policy](SECURITY.md).

## 🙏 Inspiration & Thanks

A massive thanks to [Mikuso](https://github.com/mikuso) for their fantastic work on [ocpp-rpc](https://github.com/mikuso/ocpp-rpc), which provided the brilliant early foundation for bridging OCPP-J JSON schemas in JavaScript. While building `ocpp-ws-io`, I wanted to expand on those great ideas by introducing strict, native end-to-end TypeScript support, allowing the community to build even safer CSMS platforms.

## License

[MIT](LICENSE) © 2026 Rohit Tiwari
