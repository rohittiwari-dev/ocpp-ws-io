# ocpp-ws-io

## 2.1.7

### 🔌 Plugin System

- **Built-in Plugin Architecture**: Introduced `server.plugin()` API for composable server extensions. Plugins receive lifecycle hooks (`onInit`, `onConnection`, `onDisconnect`, `onClose`) and can be registered via `import { ... } from "ocpp-ws-io/plugins"`.
- **7 Built-in Plugins**:
  - `heartbeatPlugin()` — Auto-responds to OCPP `Heartbeat` calls with `{ currentTime }`.
  - `metricsPlugin()` — Real-time connection metrics (active, peak, avg duration, uptime) with periodic snapshots.
  - `connectionGuardPlugin()` — Enforces hard limit on concurrent connections (force-close with code `4001`).
  - `anomalyPlugin()` — Detects rapid reconnection storms; emits `securityEvent` with `ANOMALY_RAPID_RECONNECT`.
  - `sessionLogPlugin()` — Logs connect/disconnect events with identity, IP, protocol, and duration.
  - `otelPlugin()` — OpenTelemetry span creation for connection lifecycle. Auto-detects `@opentelemetry/api` peer dependency.
  - `webhookPlugin()` — HTTP POST webhooks on lifecycle events with HMAC-SHA256 signing and retry support.
- **`createPlugin()` helper** — Type-safe factory for building custom plugins.

### ⚡ Performance & Scaling

- **Worker Thread Pool (`workerThreads`)**: Off-loads JSON parsing to a configurable thread pool. Enable with `workerThreads: true` (auto-sizes) or `{ poolSize, maxQueueSize }`. Uses `MessageChannel` for zero-copy handoff.
- **Redis Connection Pooling (`poolSize`)**: Distributes write operations (`xadd`, `publish`, `set`) across N connections via round-robin. Subscriptions remain pinned to the primary driver. Default `poolSize: 1` preserves existing behavior.
- **Redis `driverFactory` option**: Factory function to create additional pool drivers when `poolSize > 1`.
- **Redis Cluster Mode (`ClusterDriver`)**: Native Redis Cluster support via `ioredis`. Handles `MOVED`/`ASK` redirections, hash-tag sharding for presence keys, and pipeline-based batch operations (`xaddBatch`, `setPresenceBatch`). Gracefully falls back to individual `GET` calls when `MGET` spans multiple slots.

### 📦 WebSocket Compression

- **`permessage-deflate` support**: Enable via `compression: true` (sensible defaults) or fine-tune with `{ threshold, level, memLevel, serverNoContextTakeover, clientNoContextTakeover }`. Available on both `OCPPServer` and `OCPPClient`. ~80% bandwidth reduction for JSON payloads.

### 🩹 Fixes

- **Plugin/Middleware separation**: Fixed plugin registration to cleanly separate from RPC middleware pipeline.
- **Export ordering**: Alphabetized type exports in `index.ts` for consistency.
- **Ternary formatting**: Fixed indentation of nested ternary expressions in `client.ts` and `server.ts`.

### 🧪 Testing

- Added `phase-g.test.ts` — 11 tests covering Redis connection pooling (round-robin distribution, subscription pinning, disconnect), compression type contracts, and cluster driver options.
- Added plugin integration tests covering all 7 built-in plugins, lifecycle hooks, and `server.plugin()` registration.
- Full suite: **703 tests / 50 files** — all passing.

### 📚 Documentation

- **New page**: `plugins.mdx` — Full documentation for all 7 built-in plugins with options tables, usage examples, and custom plugin creation guide.
- **Updated**: `clustering.mdx` — Added Connection Pooling and Redis Cluster Mode sections with configuration examples.
- **Updated**: `api-reference.mdx` — Added `compression`, `workerThreads`, `offlineQueue` options to server/client tables. Added `CompressionOptions` reference table.

## 2.1.5

### ⚡ Performance Improvements

- **Zero-Copy Message Parsing**: Incoming WebSocket frames are now parsed via `JSON.parse(buffer)` directly, eliminating a redundant `rawData.toString()` allocation per message. At high throughput (10k+ msg/s), this removes ~2 MB/s of GC pressure.
- **Lazy AJV Schema Compilation**: OCPP JSON schemas are compiled on first use (not at startup). If only OCPP 1.6 is used, OCPP 2.0.1 and 2.1 schemas are never compiled. Validator initialization is 60–80% faster in single-protocol deployments.
- **Validator Singleton Registry**: AJV instances are now shared globally across all routers and servers using the same protocol. In multi-router setups, this eliminates ~90% of redundant AJV object creation.
- **Backpressure Event Identity**: The `backpressure` event now includes `{ identity, bufferedAmount }` for operator-level alerting without requiring cross-reference lookups.

### 🔒 Security Hardening

- **Payload Size Limits (`maxPayloadBytes`)**: The server now rejects WebSocket frames exceeding the configured byte limit (default: 64 KB) at the transport layer — before any JSON parsing. This prevents OOM attacks from malicious oversized payloads.
- **TLS Certificate Hot-Reload (`updateTLS()`)**: New `server.updateTLS(tlsOpts)` method hot-reloads TLS certificates across all active HTTPS servers without dropping existing WebSocket connections. Designed for Let's Encrypt 90-day rotation cycles.
- **Security Event Emission (`securityEvent`)**: The server now emits structured `SecurityEvent` objects for `AUTH_FAILED`, `CONNECTION_RATE_LIMIT`, and `UPGRADE_ABORTED` events. Hook directly into SIEM tools (Datadog, Splunk, PagerDuty) without log parsing.
- **Per-Identity Rate Limiting**: Each `OCPPServerClient` maintains independent token buckets (global + per-method), ensuring a noisy or misbehaving station cannot exhaust the global rate limits for other stations.

### 🧪 Testing

- Added `phase-i.test.ts` — 14 new tests covering all Phase I security features: payload size rejection, security event emissions, `updateTLS()` guard conditions, options persistence, and shallow merge behavior.

## 2.1.4

This release marks a massive architectural modernization of `ocpp-ws-io` focusing on enterprise stability, memory management, clustering observability, and strict RPC compliance. It resolves critical edge-cases encountered in high-load CSMS environments.

### 🔥 Enterprise & Performance Features

- **Idempotency Keys (Single Source of Truth Delivery)**: `client.call()` and `server.sendToClient()` now accept an `idempotencyKey` option. This safely overrides dynamically generated `messageId`s to guarantee exactly-once execution semantics across violently dropping networks and retries.
- **Eager Redis Rehydration**: The `RedisAdapter` now features an automatic eager rehydration pipeline. If the Redis broker connection drops, the adapter instantly re-registers all active local WebSockets upon broker reconnection, completely eliminating out-of-sync presence registries without waiting for the next station `Heartbeat`.
- **Global Memory & Garbage Collection**: Replaced expensive `setInterval` loops per client with a central, highly-optimized `SessionGarbageCollector`. Combined with centralized LRU caches for incoming request deduplication, memory overhead per 10k connections has been slashed by over 60%.
- **Socket-Level DDoS Protection**: Built-in Token Bucket Rate Limiting (global and per-method) has been pushed to the socket layer, safely terminating or ignoring aggressive firmware loops (`MeterValues`) before they spike the Node.js event loop.
- **Prometheus Observability**: The `OCPPServer` now natively exposes HTTP endpoints (`/health` and `/metrics`) out-of-the-box via `healthEndpoint: true`, streaming `ws` buffered bytes, active sessions, and internal V8 heap metrics.
- **NOREPLY Typing**: `typeof NOREPLY` is now officially supported in generic and version-specific `client.handle()` TypeScript overloads, allowing strict compliant suppression of response tracking.

### 🩹 Reliability Fixes

- **Strict Schema Validation Enhancements**: Fixed initialization bugs where `strictMode` failed without explicit `protocols`. Schemas are now lazily loaded and integrated flawlessly with `ajv-formats`.
- **Identity Collision Eviction**: Resolves the "Ghost Connection" bug. If continuous instances of the same `identity` rapidly reconnect, the server now actively traces and explicitly terminates older overlapping sockets to prevent split-brain routing states.
- **Offline Message Queues**: Integrated deep jitter (`backoffMin`/`backoffMax`) and exponential backoff retry flows directly into the internal asynchronous message buffering queue instead of dropping packets on link failure.
- **Unicast Sequence Assurance (`__seq`)**: Prevented Pub/Sub message race conditions by embedding monotonic sequence counters onto the Redis streams, empowering workers to safely detect and discard out-of-order `CALL` deliveries.
- **Graceful Shutdown Orchestration**: `server.close()` now safely flushes all Redis streams, unloads all presence trackers, and waits for pending handlers before terminating the HTTP server and internal listeners, preventing hanging processes during CI/CD rollouts.## 1.0.0
- **Router Enhancements**: Added modular router options with `createRouter` for flexible routing configurations.

### Patch Changes

- d7e7f08: fix: handleupgrade function did not upgrade the http server with socket
- Type mismatch in OCPPServer client event
- c2e1c7f: added packages rules, bumping version with chnages, uploading loading , fixed of potential linting fixes

This patch release encapsulates several major registry layout optimizations and extensive internal runtime bug fixes.

**🪲 Bug Fixes:**

- **Browser Client Logging Integration**: Re-oriented the \`BrowserOCPPClient\` logging instantiation step to utilize the internal isomorphic \`initLogger\` pipeline. This restores native type parity between the UI client and the Node server, enables cross-environment parsing of \`handler\` properties, and fixes a regression TypeScript syntax failure.
- **NOOP Safety**: Corrected anomalous \`undefined\` evaluation crashes when users configured \`logging: false\` by injecting a stable, un-invokable \`NOOP_LOGGER\` interceptor for clients opting out of standard observability protocols.
- **Timeout and Bad Message Catch Verification**: Patched missing catch resolutions across the internal timeout execution limits during server lifecycle monitoring.

**⚡ Feature Iterations & Crawling:**

- **Registry Discoverability**: Overhauled \`package.json\` configurations dynamically across the monorepo root and the core package workspace to dramatically scale the relevant \`keywords\` footprint targeting Next.js, CSMS platforms, charging components, and IoT protocols.
- **LLM Context Router Extractors**: Fully refactored Fumadocs indexing APIs (\`llms.txt\`, \`llms-full.txt\`) on the primary website router to abandon internal text processing in favor of direct, raw \`.mdx\` filesystem extractions. These APIs dynamically resolve all components extending across the \`docs\` and \`blog\` namespaces respectively, generating absolute URL targets ideal for direct scraping by LLM web parsers without UI contamination natively.
- **UI Enhancements**: Implemented the \`LLMCopyButton\` schema universally across the blog architectures matching the documentation structures, and removed \`clerk\` shadow injections from the base documentation layout Table of Contents (\`DocsPage\`).
- **CORS Support**: Implemented router configuration support for Cross-Origin Resource Sharing (CORS).
- **Performance Optimizations**: improved client session management, message handling, and connection statistics.
- **Bundle Size**: Optimized build artifacts to reduce overall bundle size.

### Minor Changes

- a2c0f3f: ### ✨ Features

  - **OCPPRouter Engine**: Introduced an Express-style `OCPPRouter` API to support modular connection routing based on URL patterns (`server.route()`, `server.use()`, `server.auth()`).
  - **Browser Middleware Parity**: Brought the internal `MiddlewareStack` outwards to the `BrowserOCPPClient`, giving `client.use()` full interceptor-like support natively in the browser.
  - **TypeScript Middleware Helpers**: Shipped typed utility functions `defineRpcMiddleware` for strict browser/node interceptors, `defineMiddleware` for node connections, and `defineAuth` / `combineAuth` for highly composable authentication logic.
  - **Structured Logging Configs**: Redesigned `LoggingConfig` interface using a clear `{ prettify, exchangeLog, level }` structure, standardizing real-time stream observability with `[IN]`, `[OUT]`, and `[RES]` log formatting.

  ### 🩹 Fixes & Additions

  - **Handshake API Normalization**: Standardized legacy `endpoint` configurations by officially transitioning them to Node-native `pathname` properties inside `HandshakeInfo` and constructor objects.
  - **Duplicate Handler Collisions**: Protected `client.handle()` RPC registration tables from silently overriding each other by throwing explicit runtime errors when identical handlers are accidentally attached.
  - **Global Server Fallbacks**: Modernized the core `OCPPServer` HTTP routing logic to cleanly enforce wildcard sub-routers, providing built-in unauthenticated catch-alls that terminate hanging connections.
  - **Logging Formatter Duplication**: Resolved manual format injection overhead inside the browser bundles by deferring payload formatting accurately to `createLoggingMiddleware()`.

- # Reliability, Middleware, and Type Safety

  ## 🚀 Features

  - **Redis Streams for Unicast**: Replaced Pub/Sub for node-to-node communication. This ensures **zero message loss** during temporary node restarts or network instability.
  - **Middleware System**: Added `client.use()` and server-side middleware for intercepting and modifying OCPP messages.
  - **Enhanced Logging**:
    - New `initLogger` with configurable options (`prettify`, `exchangeLog`).
    - Built-in logging middleware that traces all incoming/outgoing messages.
  - **Safe Calls**: Added `safeCall()` and `safeSendToClient()` methods for "fire-and-forget" operations that handle errors gracefully.
  - **Connection Upgrades**: Added `handshakeTimeoutMs` and `upgradeAborted` event to `OCPPServer` for better control over the WebSocket handshake pipeline.

  ## 📚 Documentation

  - Comprehensive updates to `README.md` and `apps/docs`.
  - New guides for **Middleware**, **Clustering (Redis Streams)**, **Logging**, and **Connection Upgrades**.
  - Added **Bun** and **Deno** integration examples.
