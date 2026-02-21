# ocpp-ws-io

## 2.1.1

### Patch Changes

This patch release encapsulates several major registry layout optimizations and extensive internal runtime bug fixes.

**🪲 Bug Fixes:**

- **Browser Client Logging Integration**: Re-oriented the \`BrowserOCPPClient\` logging instantiation step to utilize the internal isomorphic \`initLogger\` pipeline. This restores native type parity between the UI client and the Node server, enables cross-environment parsing of \`handler\` properties, and fixes a regression TypeScript syntax failure.
- **NOOP Safety**: Corrected anomalous \`undefined\` evaluation crashes when users configured \`logging: false\` by injecting a stable, un-invokable \`NOOP_LOGGER\` interceptor for clients opting out of standard observability protocols.
- **Timeout and Bad Message Catch Verification**: Patched missing catch resolutions across the internal timeout execution limits during server lifecycle monitoring.

**⚡ Feature Iterations & Crawling:**

- **Registry Discoverability**: Overhauled \`package.json\` configurations dynamically across the monorepo root and the core package workspace to dramatically scale the relevant \`keywords\` footprint targeting Next.js, CSMS platforms, charging components, and IoT protocols.
- **LLM Context Router Extractors**: Fully refactored Fumadocs indexing APIs (\`llms.txt\`, \`llms-full.txt\`) on the primary website router to abandon internal text processing in favor of direct, raw \`.mdx\` filesystem extractions. These APIs dynamically resolve all components extending across the \`docs\` and \`blog\` namespaces respectively, generating absolute URL targets ideal for direct scraping by LLM web parsers without UI contamination natively.
- **UI Enhancements**: Implemented the \`LLMCopyButton\` schema universally across the blog architectures matching the documentation structures, and removed \`clerk\` shadow injections from the base documentation layout Table of Contents (\`DocsPage\`).

## 2.1.0

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

## 2.0.2

### Minor Changes

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

### Patch Changes

- d7e7f08: fix: handleupgrade function did not upgrade the http server with socket

## 2.0.1

### Patch Changes

- Type mismatch in OCPPServer client event

## 2.0.0

### Major Changes

- c2e1c7f: added packages rules, bumping version with chnages, uploading loading , fixed of potential linting fixes
