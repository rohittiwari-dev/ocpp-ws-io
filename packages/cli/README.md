# ocpp-ws-cli

The official Command Line Toolchain for the **ocpp-ws-io** ecosystem.

A breathtakingly fast, immensely powerful suite of 15 CLI commands that completely transform how you build, test, and run OCPP 1.6 / 2.0.1 / 2.1 charge point systems.

## Global Installation

```bash
npm install -g ocpp-ws-cli
```

_Or, run instantly without installing via `npx`:_

```bash
npx ocpp-ws-cli init my-new-csms
```

## The Toolchain

### 1. Code Generation

`ocpp generate` reads your custom `.json` schemas and outputs perfect TypeScript `.d.ts` declaration libraries for 100% strict type safety across your entire fleet.

### 2. Network Testing & Fuzzing

- `ocpp simulate` - Boot a physical terminal-based Charge Point to test authorization pipelines.
- `ocpp fuzz` - Launch concurrent threads of malformed socket payloads to ensure your Strict Mode validators are protecting Node from DDOS/JSON attacks.
- `ocpp replay` - Stream a `.json` array log piece-by-piece to faithfully recreate complex bugs in a staging environment.
- `ocpp load-test` - Fire thousands of concurrent BootNotifications to stress-test your Redis cluster.

### 3. Debugging & Observability

- `ocpp top` - Run a live terminal TUI that reads our `adapterMetrics()` out of Redis for fleet visualization.
- `ocpp tail` - Instantly sniff raw web socket payloads across the cluster.
- `ocpp proxy` - Boot a local MITM Reverse proxy that acts as a secure Charles Proxy for physical EV chargers.
- `ocpp parse` - Pipe illegible, raw JSON arrays from CloudWatch logs into beautifully formatted Javascript objects.

### 4. Enterprise Resources

- `ocpp mock` - Serve randomized HTTP SSE streams of Mock Data for your Frontend UI engineers.
- `ocpp ota` - Spin up a zero-config OTA HTTP chunked-file server to instantly test firmware downloads.
- `ocpp certs` - Native OpenSSL integration to generate `ca`, `client`, and `server` PEM keys for Profile 2 & 3.
- `ocpp sdk` - Generate a type-safe `.ts` API Object Class mapped straight to your backend payloads.
- `ocpp audit` - Run an automated OCA compliance penetration sweep against your CSMS endpoints.

## Documentation

For complete usage, examples, and flags, check out the documentation at:
**[ocpp-ws-io/docs/cli](https://github.com/rohittiwari-dev/ocpp-ws-io)**
