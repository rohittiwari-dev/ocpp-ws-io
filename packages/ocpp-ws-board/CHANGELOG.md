# ocpp-ws-board

## Unreleased

### Fixed

- **The Security and Diagnostics pages no longer recompute on every render.** Their event and error lists were rebuilt as a new array on each render (`… ?? []`), so the statistics and filters memoised on them were recalculated every time. The lists are now memoised on the data they come from.

## 1.0.0 (2026-10-11)

### Features & Highlights

- **General Availability Release**: Official production-ready stable release of `ocpp-ws-board` with multi-protocol support for OCPP 1.6, 2.0.1, and 2.1.
- **Messages & Packet Inspection Studio**:
  - Multi-view modes: Live Traffic, Correlated Exchanges (automatic pairing of CALL requests with CALLRESULT responses and latency tracking), Protocol Errors & Exceptions, and Charger Activity breakdown.
  - Quick presets: Calls only, Errors only, Transactions, Heartbeats & Status, Slow RPCs (>100ms).
  - Clickable interactive table rows with inline payload expansion and JSON copying.
- **Interactive RPC Command Center**:
  - Live operator RPC composer with built-in parameter presets for standard actions (RemoteStartTransaction, RemoteStopTransaction, Reset, UnlockConnector, TriggerMessage, ChangeAvailability, etc.).
  - Target station selector with live connection status pills and input validation.
  - Command audit log tracking sent parameters, responses, latencies, and execution status.
  - Optional read-only deployment toggle via `commandsEnabled: false` in `BoardOptions`.
- **Security Events Studio**:
  - Dedicated monitor for authentication failures, rate limiting spikes, anomalous packets, and protocol violations.
  - Severity classification (Critical, High, Medium, Low) with filter presets.
  - Inline accordion row expansion directly beneath targeted incidents.
- **Diagnostics & Lifecycle Studio**:
  - Real-time exception tracker with formatted monospace stack traces.
  - Host lifecycle event monitor tracking client evictions, backpressure triggers, pong timeouts, config reloads, TLS updates, and shutdowns.
  - Inline accordion row expansion directly beneath targeted diagnostic records.
- **System Telemetry & Live Infrastructure Monitoring**:
  - Interactive SVG Area charts with metric switching (throughput req/s, average latency, error rate, memory, active connections).
  - Live process memory tracking (Node.js Heap used, Heap allocated, RSS) and socket concurrency percentage relative to server peak.
  - Inline historical telemetry snapshot inspector.
- **Configurable Bounded Ring Buffer Storage**:
  - Introduced `StoreOptions` with customizable bounds (`maxMessages: 10000`, `maxProxyEvents: 2000`, `maxSmartChargeHistory: 1000`).
  - High-performance in-memory compression via `zlib` deflateSync/inflateSync to prevent heap leaks.
  - Pluggable `BoardStorageAdapter` interface for external persistent databases (PostgreSQL, SQLite, Redis).
- **Modern Dashboard UI & Accessibility**:
  - Full Shadcn UI / Tailwind CSS v4 design with Dark, Light, and System theme synchronization.
  - Responsive collapsible icon rail sidebar navigation.
  - Dedicated Help & Shortcuts studio (`/help`) and modal cheat-sheet (`?` or `Ctrl+/`).
  - Safe signout confirmation dialog preventing accidental session termination.
- **Framework Adapters & Zero-Overhead Integration**:
  - First-class adapters for Express / Connect (`expressAdapter`), Hono / Fetch (`honoAdapter`), and NestJS (`BoardModule`).
- **Bundle & Performance Optimization**:
  - Route code-splitting with dynamic `React.lazy()` imports, reducing initial bundle size to < 300 kB with zero Vite chunk warnings.
  - Added clean build pipeline eliminating legacy declaration artifacts from packages.

## 0.2.1-alpha.1 (2026-10-04)

### Changes

- **`ocpp-ws-io` peer range is now `^3.0.0`** (was `^2.3.2`): the board is built and tested against `ocpp-ws-io` 3.0.0.
- **Requires Node.js 20 or later** (new `engines` field: `>=20.0.0`), the same floor as `ocpp-ws-io` 3.0.0; Node 18 reached end of life in April 2025. The build now targets Node 20.

## 0.2.0-alpha.0 (2026-10-02)

### Changes

- **Smaller install.** The dashboard UI ships prebuilt in `dist/public`, so its build libraries (React, Base UI, Tailwind, Recharts and others) moved from `dependencies` to `devDependencies`. Installing the package now pulls in only `hono` at runtime.
- **`ocpp-ws-io` peer range is now `^2.3.2`** (was `*`), so a future major release of `ocpp-ws-io` is not picked up without a matching board release.

### Fixes

- Message and security log filters fall back to "all" when a dropdown selection is cleared, instead of filtering on an empty value.

## 0.1.0 (2026-04-13)

### Features

- **Real-time OCPP Message Inspector**: Live deep packet inspection of OCPP 1.6J and 2.0.1 payloads with filtering by method, direction, and type
- **Connection Management Dashboard**: Monitor all connected charging stations with real-time status, protocol version, and connection metadata
- **Server Logs Viewer**: Terminal-style logs interface with auto-scroll, pause/resume, search, and export capabilities
- **Telemetry & Metrics**: Real-time charts for messages per second, latency, error rates, memory usage, and connection counts
- **Security Events Monitor**: Track authentication failures, rate limiting, protocol violations, and policy rejections
- **Multi-Framework Support**: Adapters for Express, Hono, and NestJS
- **Authentication System**: Token-based, credentials, and custom auth modes with session management
- **SSE Streaming**: Server-Sent Events for real-time message and telemetry updates
- **Dark/Light Theme**: Full theme support with system preference detection
- **Responsive Design**: Mobile-first responsive layout with collapsible sidebar

### Architecture

- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS 4
- **Backend**: Hono framework for REST API and SSE streams
- **State Management**: In-memory ring buffers with configurable limits
- **Real-time**: EventSource/SSE for live updates
- **UI Components**: Shadcn/ui with custom theming
