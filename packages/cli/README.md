<p align="center">
  <img src="https://raw.githubusercontent.com/rohittiwari-dev/ocpp-ws-io/main/assets/banner.svg" alt="ocpp-ws-io" width="420" />
</p>

# ocpp-ws-cli

<div align="center">
  <h3>⚡ The Ultimate CLI for ocpp-ws-io ⚡</h3>
  <p>A breathtakingly fast, immensely powerful suite of CLI tools that completely transform how you build, test, and run OCPP 1.6 / 2.0.1 / 2.1 charge point management systems.</p>
</div>

---

## 🚀 Quick Start

**Global Installation:**

```bash
npm install -g ocpp-ws-cli
```

**Run instantly via npx:**

```bash
npx ocpp-ws-cli
```

_Running without arguments launches the **Interactive Main Menu**._

---

## 🔥 Featured Commands

### `ocpp simulate` : The Stateful Charge Point Simulator

Boot a fully interactive, terminal-based Virtual Charge Point directly from your CLI.

- **Automated Boot Sequence**: Automatically connects, sends `BootNotification`, negotiates the `interval`, and manages the WebSocket `Heartbeat` loop.
- **Real-Time Hardware Dashboard**: Watch a beautiful, auto-refreshing ASCII interface updating every second with live physical metrics:
  - 🔌 **Voltage (V)** & ⚡ **Current (A)**
  - ⚡ **Live Power (kW)**
  - 🔋 **Energy Consumed (Wh)**
  - 🌡️ **Temperature (°C)**
  - 🚗 **State of Charge (SoC %)**
- **Interactive Keyboard Controls**:
  - `[A]` **Authorize**: Swipe a virtual RFID badge.
  - `[T]` **Start**: Initiate `StartTransaction`.
  - `[M]` **Meter**: Broadcast `MeterValues` with dynamic power curve generation.
  - `[E]` **Stop**: Push `StopTransaction` with final registers.
  - `[S]` **State**: Toggle between `Available` and `Faulted` states to test CSMS alarms.
- **Protocol-Aware Dispatching**: Automatically upgrades from flat OCPP 1.6 structures to modern `TransactionEvent` loop frameworks when connected as OCPP 2.0.1+.
- **Reverse RPC Ready**: Actively listens and reacts to CSMS `RemoteStartTransaction`, `RemoteStopTransaction`, `UnlockConnector`, `Reset`, and more.

### `ocpp mock` : Server-Sent Events (SSE) Mock Server

Spin up a randomized HTTP SSE stream of Mock OCPP Data to accelerate your Frontend UI development without needing physical hardware.

- Instantly streams dummy `MeterValues`, `StatusNotification`, and `Heartbeat` events.
- Configurable broadcast rates and host ports via interactive prompts.

### `ocpp audit` : Production Security Audit

Launch the interactive "OCPP-WS-IO Production Auditing Guide" wizard.

- Runs automated tests to pre-fill audit checkpoints.
- Generates a comprehensive markdown audit report (`audit-report.md`) verifying strict mode schema enforcement, rate-limiting, secure WSS handshakes, and caching topologies.

### `ocpp certs` : Local Certificate Generation

Bypass complicated bash scripts and instantly generate **4096-bit local Root CAs** and signed Server/Client `.pem` certificates.

- Designed explicitly for rapidly testing OCA Security Profile 2 (TLS) and Profile 3 (mTLS) directly on `localhost`.

### `ocpp test` : OCTT Compliance Test Suites

Execute modularized test suites against your servers:

- `transport` - Core WebSocket connection resilience.
- `rpc` - Strict 2-CALL / 3-CALLRESULT validation.
- `security` - Basic Auth and TLS robustness limits.
- `chaos` - Extreme malformed JSON/DDOS payload fuzzing.

### `ocpp generate` : Type Generation

Read your custom JSON schemas and output exact TypeScript `.d.ts` declaration libraries for 100% strict type safety across your entire charging network.

### `ocpp load-test` : Distributed Load Testing Engine

A distributed load testing engine capable of simulating thousands of concurrent Charge Point connections.

- Simulates intense traffic spikes with staggered connections.
- Generates detailed metrics for successful and failed requests.

### `ocpp fuzz` : Protocol Chaos Engine (Fuzzer)

A protocol fuzzer that sends malformed, invalid, or unexpected payloads.

- Floods the server with protocol anomalies using multiple concurrent worker threads.
- Validates that strict-mode schema enforcement and error handling are robust.

---

## 📚 Documentation

For complete usage, architecture planning, and API examples, check out the official documentation at:
**[ocpp-ws-io GitHub Repository](https://github.com/rohittiwari-dev/ocpp-ws-io)**
