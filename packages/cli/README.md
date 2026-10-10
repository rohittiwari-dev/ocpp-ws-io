<p align="center">
  <img src="https://raw.githubusercontent.com/rohittiwari-dev/ocpp-ws-io/main/assets/banner.svg" alt="ocpp-ws-io" width="420" />
</p>

# ocpp-ws-cli

<div align="center">
  <h3>⚡ The Ultimate CLI for ocpp-ws-io ⚡</h3>
  <p>A breathtakingly fast, immensely powerful suite of CLI tools that completely transform how you build, test, and run OCPP 1.6 / 2.0.1 / 2.1 charge point management systems.</p>
</div>

> **⚠️ Deprecated: the CLI now ships in [`ocpp-ws-io`](https://www.npmjs.com/package/ocpp-ws-io), as its `ocpp` command.**
> This package's last release only runs that one, so existing scripts keep working, but new commands and fixes ship in `ocpp-ws-io`. Commands and options are the same. Move to:
>
> ```bash
> npm uninstall -g ocpp-ws-cli   # both packages install the `ocpp` command
> npm install -g ocpp-ws-io
> ```
>
> | Before | Now |
> |:---|:---|
> | `npm install -g ocpp-ws-cli` | `npm install -g ocpp-ws-io` |
> | `npx ocpp-ws-cli …` | `npx ocpp-ws-io …` |
> | `ocpp …`, `ocpp-ws-cli …` | the same: `ocpp-ws-io` installs both commands |

---

## 🚀 Quick Start

**Global Installation:**

```bash
npm install -g ocpp-ws-io
```

**Run instantly via npx:**

```bash
npx ocpp-ws-io
```

_Running without arguments launches the **Interactive Main Menu**._

---

## 🔥 Featured Commands

### `ocpp simulate` : The Stateful Charge Point Simulator

Boot a fully interactive, terminal-based Virtual Charge Point directly from your CLI.

> **Prefer a visual UI?** The **[ocpp-ws-simulator](https://github.com/rohittiwari-dev/ocpp-ws-simulator)** is a standalone Next.js web app maintained separately for easy cloning and self-hosting — no monorepo needed. See the [Web Simulator](#-web-ui-simulator-ocpp-ws-simulator) section below.

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

### `ocpp studio` : Visual Web Simulator

Opens the hosted **[OCPP Visual Simulator](https://ocpp.rohittiwari.me)** directly in your default browser — no local clone, install, or dev server required.

```bash
ocpp studio
```

What it does:

1. 🌐 Opens **[ocpp.rohittiwari.me](https://ocpp.rohittiwari.me)** in your default browser
2. ✅ No local setup, no storage usage — runs entirely in the cloud

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

Reads a custom protocol's JSON schemas and writes its TypeScript types, the augmentation that declares it to `ocpp-ws-io`, and its strict-mode validator, so the types and what strict mode validates come from the same file.

### `ocpp load-test` : Distributed Load Testing Engine

A distributed load testing engine capable of simulating thousands of concurrent Charge Point connections.

- Simulates intense traffic spikes with staggered connections.
- Generates detailed metrics for successful and failed requests.

### `ocpp bench` : Server Throughput & Latency Benchmark

Measure your OCPP server's real-world performance with precise latency percentiles and throughput metrics.

- **Round-Trip Latency**: Tracks min / avg / p50 / p95 / p99 / max latency for every RPC call using `performance.now()` sub-millisecond precision.
- **Throughput**: Measures sustained messages-per-second across the benchmark duration.
- **Connection Time**: Records WebSocket handshake + BootNotification round-trip.
- **Error Rate**: Tracks failed and timed-out calls as a percentage.
- **Live Dashboard**: Real-time terminal UI showing all metrics as the benchmark runs.
- **Configurable**: Set duration (`-d`), concurrency (`-c`), protocol (`-p`), and endpoint (`-e`).
- **Report Export**: Save results as JSON, Markdown, or plain text via `--report`.

```bash
# Interactive mode
ocpp bench

# CLI flags
ocpp bench -e ws://localhost:5000/ocpp -d 30 -c 5
ocpp bench -e ws://localhost:5000/ocpp --report json
```

### `ocpp fuzz` : Protocol Chaos Engine (Fuzzer)

A protocol fuzzer that sends malformed, invalid, or unexpected payloads.

- Floods the server with protocol anomalies using multiple concurrent worker threads.
- Validates that strict-mode schema enforcement and error handling are robust.

---

## 🖥️ Web UI Simulator

For a **visual, browser-based** charge point simulator, use the hosted version at **[ocpp.rohittiwari.me](https://ocpp.rohittiwari.me)** — or run `ocpp studio` to open it directly from the CLI.

| Mode     | Tool                                                           | Best For                                       |
| -------- | -------------------------------------------------------------- | ---------------------------------------------- |
| Terminal | `ocpp simulate` (this CLI)                                     | Scripting, CI, quick charge point testing      |
| Browser  | [`ocpp studio`](https://ocpp.rohittiwari.me) | Visual debugging, demos, multi-connector flows |

---

## 📚 Documentation

For complete usage, architecture planning, and API examples, check out the official documentation at:
**[ocpp-ws-io GitHub Repository](https://github.com/rohittiwari-dev/ocpp-ws-io)**
