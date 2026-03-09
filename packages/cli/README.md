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

Clone and launch the **[ocpp-ws-simulator](https://github.com/rohittiwari-dev/ocpp-ws-simulator)** — a full-featured browser-based charge point emulator — in one command.

```bash
# Interactive (recommended)
ocpp studio

# Clone to a specific directory, then start
ocpp studio --dir ./my-simulator

# Clone and install only (no dev server)
ocpp studio --dir ./my-simulator --skip-dev
```

What it does:

1. ✅ Checks that Git is installed
2. 📦 Clones `rohittiwari-dev/ocpp-ws-simulator` with `--depth 1` (fast, no history)
3. 📥 Runs `npm install`
4. 🚀 Starts the Next.js dev server — open `http://localhost:3000`

| Flag               | Description                                       |
| ------------------ | ------------------------------------------------- |
| `-d, --dir <path>` | Target directory (default: `./ocpp-ws-simulator`) |
| `--skip-install`   | Skip `npm install`                                |
| `--skip-dev`       | Clone + install only, don't start the server      |

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

## 🖥️ Web UI Simulator (`ocpp-ws-simulator`)

For a **visual, browser-based** charge point simulator, use the standalone [`ocpp-ws-simulator`](https://github.com/rohittiwaridev/ocpp-ws-simulator) repo — maintained separately from this monorepo for easy distribution and self-hosting.

```bash
git clone https://github.com/rohittiwaridev/ocpp-ws-simulator.git
cd ocpp-ws-simulator && npm install && npm run dev
```

| Mode     | Tool                                                                       | Best For                                       |
| -------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| Terminal | `ocpp simulate` (this CLI)                                                 | Scripting, CI, quick charge point testing      |
| Browser  | [`ocpp-ws-simulator`](https://github.com/rohittiwaridev/ocpp-ws-simulator) | Visual debugging, demos, multi-connector flows |

Live at: **[ocpp.rohittiwari.me](https://ocpp.rohittiwari.me)**

---

## 📚 Documentation

For complete usage, architecture planning, and API examples, check out the official documentation at:
**[ocpp-ws-io GitHub Repository](https://github.com/rohittiwari-dev/ocpp-ws-io)**
