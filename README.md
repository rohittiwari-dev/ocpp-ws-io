<div align="center">

<p align="center">
  <img src="https://raw.githubusercontent.com/rohittiwari-dev/ocpp-ws-io/main/assets/banner.svg" alt="ocpp-ws-io ecosystem" width="420" />
</p>

**The Complete, Type-Safe OCPP Ecosystem for Node.js**

A modular suite of tools built with TypeScript from the ground up for building Charge Point Management Systems (CSMS), Charge Point Simulators (EVSE), Smart Charging Solvers, and Protocol Translators. 

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[Documentation](https://ocpp-ws-io.rohittiwari.me) · [npm Organization / Core Package](https://www.npmjs.com/package/ocpp-ws-io) · [Contributing](CONTRIBUTING.md)

</div>

---

## 🌍 Why Does This Ecosystem Exist?

Historically, building an OCPP-compliant network has been an infrastructure nightmare. Moving from OCPP 1.6 to modern standards like OCPP 2.0.1 or 2.1 traditionally required structural backend rewrites. You were forced to manually write WebSocket framing, connection backoff logic, rate limiting, and state persistence. Smart Charging (distributing finite grid power) required you to invent complex mathematical constraint solvers. And testing? That meant either setting up physical hardware or running clunky, unmaintained Java desktop simulators.

**The Solution:** `ocpp-ws-io` is a modern, modular ecosystem that solves these problems. It provides end-to-end type safety, plug-and-play architectural components (RPC Core, Security, Proxies, Smart Charging), and a lightning-fast CLI & Web Simulator toolset.

### The Packages at a Glance

| Package | Description | Status |
|---------|-------------|--------|
| [**`ocpp-ws-io`**](packages/ocpp-ws-io) | **Core WebSocket RPC client & server.** Call framing, Type Safety, Security Profiles, DDoS protection, Redis clustering. | [![npm](https://img.shields.io/npm/v/ocpp-ws-io.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/ocpp-ws-io) |
| [**`ocpp-smart-charge-engine`**](packages/ocpp-smart-charge-engine) | **Library-agnostic load balancing.** Distributes grid power safely among EVs using advanced mathematical constraint solvers. | [![npm](https://img.shields.io/npm/v/ocpp-smart-charge-engine.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/ocpp-smart-charge-engine) |
| [**`ocpp-protocol-proxy`**](packages/ocpp-protocol-proxy) | **Version translation proxy.** Translates OCPP versions seamlessly (e.g., 1.6 ↔ 2.1) without touching charger firmware. | [![npm](https://img.shields.io/npm/v/ocpp-protocol-proxy.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/ocpp-protocol-proxy) |
| [**`ocpp-ws-cli`**](packages/cli) | **Terminal tooling ecosystem.** Code generation, CLI Simulation, Distributed Load Testing, Fuzzing, and Cert Generation. | [![npm](https://img.shields.io/npm/v/ocpp-ws-cli.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/ocpp-ws-cli) |
| [**`ocpp-ws-simulator`**](https://ocpp.rohittiwari.me) | **Visual Web UI Simulator.** A full-featured Next.js browser-based charge point emulator. Live at [ocpp.rohittiwari.me](https://ocpp.rohittiwari.me). | ✅ Available |
| [**`voltlog-io`**](https://npmjs.com/package/voltlog-io) | **Structured Logger.** High-performance structured logging layer powering the ecosystem's network diagnostics. | ✅ Published |

---

## ⚡ 1. Core RPC: `ocpp-ws-io`

At the heart of the ecosystem is the rock-solid WebSocket RPC core. 

**Features:**
- **End-to-End Type Safety**: Auto-generated typings for all 1.6, 2.0.1, and 2.1 methods.
- **Security Profiles 0–3**: Plain WS, Basic Auth, TLS + Basic Auth, Mutual TLS (mTLS).
- **Resilience**: Redis caching, eager state-synchronization, token-bucket Rate Limiting per station, and single-source-of-truth idempotency keys.

**Example: Spinning up a Central System (Server)**
```typescript
import { OCPPServer } from "ocpp-ws-io";

const server = new OCPPServer({
  protocols: ["ocpp1.6", "ocpp2.0.1"],
  logging: { prettify: true, exchangeLog: true }, // Watch the network traffic!
});

// Authenticate incoming connection
server.auth((ctx) => {
  ctx.accept({ session: { authorized: true } });
});

// Handle incoming messages gracefully
server.on("client", (client) => {
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

---

## ⚡ 2. Protocol Translation: `ocpp-protocol-proxy`

Legacy OCPP 1.6 charge points can't natively speak to modern OCPP 2.1 central systems. Instead of maintaining dual-protocol backends, put the Protocol Proxy in between.

**Features:**
- **Any-to-Any Translation**: Maps all 28 messages of OCPP 1.6 to 2.1 bidirectionally.
- **Middleware Hooks**: Intercept messages pre- and post-translation for observability.
- **Stateful Sessions**: Automatically maps string-based UUIDs (2.1) to integer Transaction IDs (1.6).

**Example: Translating 1.6 to 2.1**
```typescript
import { OCPPProtocolProxy, presets, OcppWsIoAdapter } from "ocpp-protocol-proxy";

// Connect to upstream CSMS running OCPP 2.1
const proxy = new OCPPProtocolProxy({
  upstreamEndpoint: "ws://your-modern-csms:9000",
  upstreamProtocol: "ocpp2.1",
});

// Load the 1.6 → 2.1 translation mappings
proxy.translate(presets.ocpp16_to_ocpp21);

// Accept connections from legacy 1.6 EVs
const adapter = new OcppWsIoAdapter({
  port: 9001,
  protocols: ["ocpp1.6"],
});

await proxy.listenOnAdapter(adapter);
```

---

## ⚡ 3. Load Balancing: `ocpp-smart-charge-engine`

How do you safely distribute 100kW of physical grid power across 5 cars without tripping the breaker? Use the Smart Charge Engine.

**Features:**
- **Multiple Algorithms**: Equal Share, Priority, Time-of-Use.
- **Auto-Dispatch**: Recalculates mathematically optimal charging limits on an interval.
- **Hardware Agnostic**: Handles minimum EV acceptance floors and maximum hardware limits to prevent faults.

**Example: Distributing Power**
```typescript
import { SmartChargingEngine, Strategies } from "ocpp-smart-charge-engine";
import { buildOcpp16Profile } from "ocpp-smart-charge-engine/builders";

const engine = new SmartChargingEngine({
  siteId: "SITE-001",
  maxGridPowerKw: 100, // 100kW max capacity
  safetyMarginPct: 5,  // Never use more than 95% of grid limit
  algorithm: Strategies.EQUAL_SHARE,
  
  // The integration point—simply send what the engine calculates!
  dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
    await server.safeSendToClient(clientId, "ocpp1.6", "SetChargingProfile", {
      connectorId,
      csChargingProfiles: buildOcpp16Profile(sessionProfile),
    });
  },
});

// A car connects
engine.addSession({
  transactionId: 1,
  clientId: "CP001",
  minChargeRateKw: 1.4, // Keep car awake
});

// Recalculates limits across all active cars and fires the dispatcher
await engine.dispatch(); 
```

---

## ⚡ 4. Testing & Simulators: `ocpp-ws-cli` & Web UI

Testing physical chargers is expensive. We built tools to let you test immediately in software.

### Terminal Tooling (`ocpp-ws-cli`)

**Features:**
- **`ocpp simulate`**: Interactive terminal-based Virtual Charge Point. Swipe RFID tags, start transactions, and stream metrics with keyboard shortcuts.
- **`ocpp load-test`**: Simulate 1000s of concurrent EVs slamming your CSMS.
- **`ocpp bench`**: Print throughput metrics and latency percentiles (P95, P99).
- **`ocpp fuzz`**: Chaos engineer your CSMS by hurling malformed JSON payloads at it.

**Example:**
```bash
# Install globally
npm i -g ocpp-ws-cli

# Start an interactive CLI Simulator
ocpp simulate
```

### Web Simulator (`ocpp-ws-simulator`)

For visual debugging and demos, we maintain an entire Next.js browser-based simulator. 

**🌍 Live application**: [**ocpp.rohittiwari.me**](https://ocpp.rohittiwari.me)

You can also launch it locally directly from the CLI tool:

```bash
# Clones the repo, installs dependencies, and boots the Next.js visual simulator!
ocpp studio
```

Or grab the source directly: [github.com/rohittiwari-dev/ocpp-ws-simulator](https://github.com/rohittiwari-dev/ocpp-ws-simulator)

---

## 📚 General Ecosystem Documentation

Explore the comprehensive documentation for the entire ecosystem:
- [Official Documentation Portal](https://ocpp-ws-io.rohittiwari.me)
- [API Reference](https://ocpp-ws-io.rohittiwari.me/docs/api-reference)

## 🐳 Requirements

- **Node.js** ≥ 18.0.0
- **TypeScript** ≥ 5.0 (optional, but highly recommended)

## ❤️ Contributing

We welcome contributions across all packages in the ecosystem! This repository is organized as a Turborepo monorepo.

Please see our [Contributing Guide](CONTRIBUTING.md) for details on:
- Setting up the development environment (`npm install && npm run build`)
- Submitting pull requests
- Code style and commit conventions (we use `changesets` and `commitlint`)

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## 🛡️ Security

To report a security vulnerability in any of our packages, please see our [Security Policy](SECURITY.md).

## 📄 License

[MIT](LICENSE) © 2026 Rohit Tiwari
