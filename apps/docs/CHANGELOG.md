# docs

## 2.3.0

### Minor Changes

- **The proxy, the smart charge engine and the CLI as part of `ocpp-ws-io`**: their pages install `ocpp-ws-io@beta` (3.1.0) and import `ocpp-ws-io/proxy` and `ocpp-ws-io/smart-charge`; each opens with a note on the move and has a "Moving from …" section with the old-to-new imports or commands. The overview, packages and comparison pages name the new paths, and the CLI page the `ocpp` command of `ocpp-ws-io`.
- **Protocol proxy reference**: translation maps typed by `protocol:Action` key, with typed mapper params; `TranslationResult.payload` as `object`; the session store's `ProxyValue`; Node.js 20; the source layout in `ocpp-ws-io`.
- **Type generation**: `ocpp generate` uses the same generator as the library's own types.

## 2.2.0

### Minor Changes

- **One section per package**: the ocpp-ws-io pages moved under `/docs/ocpp-ws-io`, and new sections cover the board (`ocpp-ws-board`), the protocol proxy, the smart charge engine, the simulator and a packages overview.
- **Framework guides**: Express, Fastify, Hono, NestJS and Bun/Deno each have their own page, with a supported-versions table.
- **ocpp-ws-io reference**: Plugins page; middleware on outgoing responses and errors; security profiles 1–3 with Basic Auth `401`, charging station identity checks and TLS certificates, versions and ciphers; the connection phase in routing; message IDs (`idGenerator`, `idValidator`), compression (off by default) and the new server options in the API reference.
- **Site**: Next.js 16.3, Fumadocs 16.15 with fumadocs-mdx 15, TypeScript 6. Copied layout components follow the new Fumadocs translation API, and the GitHub and X icons are inlined after lucide-react 1.0 dropped brand icons.

## 2.1.8

### Minor Changes

- **New Page — Plugins**: Full documentation for all 7 built-in plugins (`heartbeatPlugin`, `metricsPlugin`, `connectionGuardPlugin`, `anomalyPlugin`, `sessionLogPlugin`, `otelPlugin`, `webhookPlugin`) with options tables, usage examples, and custom plugin creation guide.
- **Clustering — Connection Pooling**: New section documenting `poolSize` and `driverFactory` options for distributing Redis write operations across multiple connections via round-robin.
- **Clustering — Redis Cluster Mode**: New section documenting `ClusterDriver` with NAT mapping, hash-tag sharding, and ioredis peer dependency.
- **Clustering — Config Table**: Added `streamTtlSeconds`, `presenceTtlSeconds`, `poolSize`, `driverFactory` to the configuration options table.
- **API Reference — Compression**: Added `compression` option to both `ClientOptions` and `ServerOptions` tables. Added full `CompressionOptions` reference table (threshold, level, memLevel, noContextTakeover).
- **API Reference — Worker Threads**: Added `workerThreads` option to `ServerOptions` table.
- **API Reference — Offline Queue**: Added `offlineQueue` and `offlineQueueMaxSize` options to `ClientOptions` table.
- **Sidebar**: Added `plugins` page between Clustering and Type Safety.

## 2.1.5

### Minor Changes

- **Security Page — Payload Size Limit**: New section documenting `maxPayloadBytes` — when to use it, the 64 KB default, and why to avoid raising it unnecessarily.
- **Security Page — TLS Certificate Hot-Reload**: New section documenting `server.updateTLS()` with a Certbot post-deploy example and guidance on when not to use it (reverse proxy setups).
- **Security Page — Security Event Monitoring**: New section documenting the `securityEvent` event with full event type table (`AUTH_FAILED`, `CONNECTION_RATE_LIMIT`, `UPGRADE_ABORTED`) and SIEM integration examples for Datadog and PagerDuty.
- **API Reference — `maxPayloadBytes`**: Added `maxPayloadBytes` to the `ServerOptions` table with description and default value.
- **API Reference — `updateTLS()`**: Added `updateTLS(options)` method entry with code example and link to the Security page.
- **API Reference — `on("securityEvent")`**: Added `securityEvent` handler entry with example and link to the Security page.

## 2.1.4

### Minor Changes

- **Comparisons Page**: Added a comprehensive architectural comparison page detailing how `ocpp-ws-io` stacks up against `@voltbras/ts-ocpp`, `ocpp-eliftech`, and generic RPC WebSocket wrappers, including cloud cost and horizontal scalability analysis.
- **Enterprise Features Documentation**: Extensive documentation updates across `system-design.mdx`, `clustering.mdx`, and `api-reference.mdx`.
- **Idempotency Keys**: Documented the single source of truth delivery architecture using `idempotencyKey` inside `CallOptions`.
- **Redis Eager Rehydration**: Detailed the new eager reconnect synchronization mechanism natively built into the `RedisAdapter`.
- **Health Observability**: Added documentation for the new `healthEndpoint` configuration that exposes `/health` and Prometheus `/metrics` instantly on the native node server.

## 1.0.0

### Patch Changes

- **CLI Documentation**: Added comprehensive documentation for the CLI tool, covering Project Setup, Simulation, Monitoring, and Development workflows.
- **Performance**: General documentation site performance improvements.
- Type mismatch in OCPPServer client event
- Comprehensive updates to `README.md` and `apps/docs`.
- New guides for **Middleware**, **Clustering (Redis Streams)**, **Logging**, and **Connection Upgrades**.
- Added **Bun** and **Deno** integration examples
- Type mismatch in OCPPServer client event
- c2e1c7f: added packages rules, bumping version with chnages, uploading loading , fixed of potential linting fixes
