# docs

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
