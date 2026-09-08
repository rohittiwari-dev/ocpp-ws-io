# ocpp-ws-io

## Unreleased

Review remediation. One security fix, several defects that were silent in clustered deployments, and a small amount of new API. Every fix carries a regression test that was confirmed to fail without it.

### Security

- **Unmatched paths bypassed route auth whenever a global middleware existed.** The unknown-path 404 was an `else if` hanging off the auth branch. Global middleware routers (`server.use()`) always match but never mark a terminal route, so a single global middleware made the gate unreachable — and an unmatched path has no route auth callback, so the socket was upgraded without being authenticated. Any deployment combining `server.use()` with `server.route().auth()` was affected.

### Behaviour changes

Read these before upgrading — each changes what existing code does.

- **`replayBufferPlugin` no longer answers `{ status: "Accepted" }` for a command it only queued.** In OCPP, `Accepted` is the charge point's own commitment to carry a command out. Returning it for a command that never left made a parked command indistinguishable from a delivered one, so a CSMS reported a session as starting when nothing had reached the charger. The synthetic response is now `{ status: "Queued", queued: true, queuedAt, note }`, narrowable with the exported `isQueuedOffline()`. **Code branching on `status === "Accepted"` will now take its other path** — which is the correction, but check those call sites. `syntheticResponse: false` throws the original offline error, as before.

- **Route auth now takes precedence over a global `server.auth()`.** Auth callbacks were collected global → trie → regex into a first-wins slot, so a catch-all auth latched before the trie was consulted and every route-specific callback was silently discarded. The global callback is now used only when the matched route defines none.
- **Registering the same plugin object twice now registers it once.** It used to double every hook: double-counted metrics, duplicate webhooks, two `onClosing` calls on shutdown. Two *distinct* instances sharing a name (two webhook plugins posting to different URLs) are still both kept — deduplication is by identity, never by name.
- **`close()` detaches the event adapter.** `disconnect()` tears down its subscriptions and connections, and nothing re-subscribed on a later `listen()`, so a restart cycle looked clustered while cross-node RPC was silently dead. A restarted server now runs single-node, and warns, until `setAdapter()` is called again.
- **The cross-node call grace period is now 2000 ms** (was 1000). A cross-node call crosses the adapter twice — request out, result back — so the grace has to cover a round trip. With the shipped Redis adapter's `BLOCK 1000` per direction, the old value made the origin give up while a good response was still in flight, reporting a `TimeoutError` for a call that had succeeded. Configurable via `ServerOptions.remoteCallGraceMs`.
- **`broadcast()` and `broadcastBatch()` return a `BroadcastResult`** instead of `void`. Source-compatible — existing `await` callers are unaffected.
- **The presence heartbeat now refreshes three times per TTL** (was twice), with ±10% jitter and an overlap guard. At TTL/2 a single slow tick landed the next write exactly at expiry, dropping every connection on that node out of cluster routing.
- **Reconnect backoff is floored at 50 ms.** `backoffMin: 0` collapsed the exponential term to zero and produced a tight reconnect loop.
- **Connection pooling selects by destination, not round-robin.** `poolSize > 1` round-robined per call, so consecutive messages for the same target went over different TCP connections and could arrive out of order — for OCPP unicast, a charger's commands reordering in transit. One destination now stays pinned to one connection while different destinations still spread across the pool.
- **A remote timeout now arrives as `TimeoutError`**, not `GenericError`, so `catch (e) { if (e instanceof TimeoutError) }` behaves the same locally and cross-node.

### Performance

- **`date-time` validation is ~1.5× faster, and accepts exactly what it did before.** Format checking was 85% of the cost of validating a message — measured at 12.4 µs of 14.6 µs on a MeterValues carrying twenty timestamps — and `date-time` is 142 of the 144 format constraints across all three schema versions. It is now a bounded regex plus a calendar check instead of ajv-formats' default implementation. Conformance is pinned by a test that compares it against ajv-formats `full` mode across leap years, month and day bounds, offset bounds and leap seconds. ajv-formats stays registered for every other format, so custom schemas using `email`, `uri`, `ipv4` and the rest are unaffected. ajv-formats' `fast` mode was rejected outright: it admits month 13 and hour 25.
- **Validators are built when the server is constructed, not when the first message needs one.** Building a protocol's validator costs ~27 ms and compiling an action's schema another ~3.5 ms, against 0.9 µs to actually run one. Left lazy that landed on a charger's first `BootNotification`, on the event loop — and after a deploy that is every charger at once. Warming happens in the `OCPPServer` constructor rather than in `listen()`, so it also covers the `handleUpgrade` getter and the Express, Fastify, Hono and NestJS adapters that call through it. Only the protocols named by `protocols` (or by `strictMode`, when given a list) are built, and only when strict mode is on; with validation off nothing is built at all.
- **Validators are cached per protocol instead of as one all-versions batch.** A connection speaks one subprotocol, so building all three cost two AJV instances and two full schema registrations that were never consulted — 0.69 MB of 1.45 MB, 48%, for a server speaking a single version. The validator for the negotiated subprotocol is now built on first use and shared process-wide. Schemas within a validator are still compiled lazily per action, so an action never received is still never compiled.

### Added

- `ServerOptions.remoteCallGraceMs` — grace added to `callTimeoutMs` for cross-node calls, covering adapter round-trip latency.
- `ClientOptions.connectTimeoutMs` (default 30000) — bounds the WebSocket upgrade. Without it a peer that accepts TCP but never completes the handshake parked `connect()` in CONNECTING forever, and no retry was ever scheduled because the attempt never failed.
- `ClientOptions.retryInitialConnect` (default `false`) — retry in the background when the *first* `connect()` fails. `reconnect` only ever governed an established connection dropping, so a charge point booting during a CSMS outage threw once and never retried. Off by default: enabling it unconditionally leaves timers behind for callers that handle their own retry.
- `AuthAccept.identity` — override the connection identity from an auth callback. The default identity is the last path segment, so `/tenant-a/CP001` and `/tenant-b/CP001` collided on one registry entry and one presence key. Multi-tenant servers can now namespace by tenant.
- `EventAdapterInterface.removePresenceIfOwned()` and `.claimPresence()` — optional presence fencing, implemented atomically on Redis via Lua and directly on `InMemoryAdapter`. Without them a node that no longer owns an identity could delete or overwrite the entry another node had just written. Adapters that omit them keep the old unconditional behaviour.
- `RedisPubSubDriver.evalScript()` — optional Lua execution, used for the fencing above. Provided by all three shipped drivers.
- `Queue.clear()` — reject everything still queued.
- `ClientOptions.handlerGraceMs` (default 1000) — startup window during which an inbound CALL waits for its handler instead of being rejected.
- `RedisAdapterOptions.logger` — where the adapter reports transport problems. Errors previously went to a hardcoded `console.error`, invisible to structured logging.
- `ClusterDriverOptions.blockingReads` (default `true`) — opens a dedicated connection for blocking XREAD. `hasBlockingClient` was hardcoded false, so every Redis Cluster deployment polled with a 1s sleep instead, adding up to a second of latency to each leg of every cross-node call.
- `BroadcastResult` — local delivered/failed counts plus a `remotePublished` flag. That flag means "handed to the adapter", never "delivered": broadcast reaches other nodes over fire-and-forget pub/sub.

- `getStandardValidator(protocol)` — the cached validator for one protocol, or `null` if no schemas ship for it.
- `getStandardProtocols()` — the protocols with bundled OCPP schemas.
- `getStandardValidators(protocols?)` now takes an optional protocol list. Called with no arguments it returns all three, as before.
### Fixed

**Configuration wiring**

- **`rateLimit.methods` silently disabled `workerThreads`.** Extracting the action name for per-method limits was a main-thread `JSON.parse` followed by an early return that sat before the worker-pool branch, so a server configured for both — the pairing the docs recommend above 10k connections — ran with a fully allocated, permanently idle pool while every frame parsed on the event loop. The parse now goes through the worker when a pool is present and the method is read off its result. Without per-method rules the limiter still runs before any parse, so a flood is still rejected without paying for one.
- **`connectionRateLimit` was not per-IP behind a proxy.** The client IP comes from the socket unless a proxy is trusted, and the only way to trust one was `cors({ trustProxy })` — whose own documentation described it as being about `X-Forwarded-Proto`. Behind a load balancer every charger therefore resolved to the proxy address and shared one bucket, turning a per-IP limit into a fleet-wide cap where `limit: 20` rejects the 21st charger regardless of source. `connectionRateLimit.trustProxy` now sets this directly, and the server warns once if it sees an `X-Forwarded-For` while trusting no proxy.
- **`rateLimit.sampleIntervalMs` was dropped by `reconfigure()`.** The constructor forwarded it but the runtime rebuild passed only three of the AdaptiveLimiter's four knobs, so enabling adaptive limiting at runtime with `sampleIntervalMs: 500` silently sampled every 2000 ms.
- **`poolSize > 1` without `driverFactory` silently ran a one-connection pool.** The factory is documented as required, but nothing enforced it and nothing warned, while the genuinely required clients throw two lines above. It now warns with the effective pool size.
- Two Redis option docs described behaviour the code does not have: `poolSize` advertised round-robin, which was deliberately replaced by channel hashing because round-robin let a charger's commands overtake each other, and never mentioned that presence writes bypass the pool entirely; `blockingClient` never said it must be a third dedicated connection, and claimed a reliability benefit when it is a latency one.

**Clustering**

- `sendBatch` had no cross-node path at all. For any charger not on the calling node it returned an array of `undefined` behind a "future enhancement" comment — indistinguishable from "every call failed", and silent. It now routes through `sendToClient`.
- Three presence writes were unfenced, all reachable under ordinary reconnect churn: the disconnect handler guarded ownership only locally, so after a charger moved from node A to node B, A's close event deleted B's entry; `_onUnicast` deleted the registry entry for any target it did not hold, so a message queued in a stream while the charger migrated wiped the new owner's entry; and the heartbeat re-claimed every local identity unconditionally, so a node holding a half-open socket kept stealing an identity back and routing flapped every cycle.
- Bulk presence calls are chunked at 1000. At the advertised 100k connections a refresh was one 100k-key MGET and one 100k-command pipeline per cycle.
- Cross-node results were accepted from any publisher. The target node is now recorded with the pending call and replies from anyone else are discarded.
- An adapter without `getPresence()` lost cross-node routing silently. `setAdapter()` now warns.

**Redis adapter**

- `ClusterDriver.xaddBatch` built one cluster pipeline across per-node stream keys. Those keys carry no hash tags, so any batch addressing more than one node is cross-slot: ioredis either rejects the pipeline or returns per-command errors, which were discarded so total failure looked like success. Results are now inspected and only failed entries retried individually.
- `natMap` was nested inside `redisOptions`, where ioredis never reads it — NAT mapping did nothing in exactly the Docker and Kubernetes setups the option exists for.
- `onError` bound only the command connection, so an `error` event on the subscriber was an uncaught exception — a Redis failover crashed every node.
- Presence rehydration was triggered on `reconnecting`, which ioredis emits while the connection is still down. It ran against a dead socket, threw into an empty catch, and was never retried. It now binds `ready`.
- `publishBatch` never set the stream TTL lease that `publish` sets, so every node id that received a batch left a stream key behind forever.

**Redis adapter internals**

- Pipeline and multi results were discarded. Both clients return per-command results rather than rejecting, so `exec()` resolved happily even when every command failed — a total failure was reported to the caller as success, with presence silently not written. Both drivers now inspect the reply and throw on the first failed command.
- `disconnect()` never closed the blocking client: a leaked Redis connection per adapter, and an open socket keeping the Node process alive after shutdown. Fixed in both drivers and in `ClusterDriver`.
- Presence batches and MGETs were unbounded — one refresh was a single command covering every identity, occupying the Redis event loop for everyone else on the instance. Both drivers now split at 500.
- An empty `XREAD` reply spun the poll loop. ioredis can return an empty array where node-redis returns nil, and the loop treated any truthy result as data, skipping its backoff sleep entirely.
- Stream-poll errors were swallowed with no log, counter or health signal, so a reader that had been failing for hours looked identical to an idle one while cross-node delivery into that node was gone. Failures are logged on the first occurrence and every 60th, recovery is logged, and the consecutive-failure count is exposed through `metrics()`.

**Node client**

- A post-open socket error was re-emitted with no listener guard. Node throws when `error` is emitted with nothing listening, so any socket error after the connection opened crashed a process that had not attached a handler.
- `_handleCallResult` / `_handleCallError` are async and were called without `await` or `catch`, so a throwing middleware or response listener became an unhandled rejection.
- A call whose `AbortSignal` had already aborted was still transmitted. `addEventListener("abort")` never fires for an already-aborted signal, and the listener is only attached once the call reaches the front of the concurrency queue — so a call aborted while queued went on the wire and nothing rejected it either.
- `close()` could be undone by a reconnect. It clears a pending reconnect timer, but once that timer has fired there is nothing left to clear: the attempt connected anyway and left a closed client alive in CONNECTING.
- Offline-queued calls were stranded on close. They hold the caller's resolve/reject and nothing settled them, and they cannot time out because the call timeout is only armed once a call is sent.
- The outbound buffer was unbounded and never cleared. It is now capped at 1000 frames, dropping oldest first.
- Pong timers were overwritten rather than guarded. When `pongTimeoutMs` exceeds `pingIntervalMs` the next ping orphaned the live handle, which still fired and terminated whatever socket was current — including a healthy reconnect.
- The concurrency queue leaked slots. A task throwing synchronously escaped `_drain()` before `.finally()` attached, so `_running` was never decremented — a handful of those and the queue deadlocked.

**Plugins**

- `amqp` and `redis-pubsub` dropped every message event. Both emit sub-typed names (`message.inbound`, `message:inbound`) but gate on `events`, which is configured with base names (`message`), so nothing ever matched.
- `webhook` never sent a shutdown notification. It enables `close` by default but only emitted `closing`, which the default list does not allow, and it fire-and-forgot the request instead of returning the promise the server awaits.
- Route-level `rateLimit.adaptive` was accepted by the type and silently ignored. The adaptive limiter samples host CPU and memory, so it is process-wide by nature; setting it on a route now logs a warning at `listen()`.

**Documentation**

- The README's only clustering example passed an ioredis client positionally into a constructor that takes an options object, and threw.
- The Redis Cluster guide used `driverFactory`, which is only consulted when `poolSize > 1`, so the `ClusterDriver` was silently discarded and the adapter built its driver from two empty objects.
- The durability claim now distinguishes the two paths: cross-node unicast is delivered over Redis Streams, `broadcast` is fire-and-forget pub/sub.
- The client quickstart registers a handler before `connect()`. See "Known behaviour" below.

### Removed

- `EventBuffer`. Added in the initial documentation commit and never wired in: not imported anywhere, not exported, not a build entry, and absent from every published tarball. Its stated purpose was buffering during connection setup, which it would not have achieved — both sides attach socket listeners synchronously, and the residual gap is one layer up at dispatch.

- **Off-thread AJV validation in the parse worker.** It was implemented, typed and unit-tested, but nothing in the library ever supplied the `schemaInfo` that would activate it, and `ParseResult.validationError` was never read. Wiring it as designed would have been actively harmful: `schemaInfo` is structured-cloned on every `postMessage`, so it would copy 5.2 ms of OCPP 2.1 schemas per frame to save 0.016 ms of validation. It also only guarded `message[0] === 2`, so it never validated CALLRESULTs and was never a substitute for the main-thread path. `workerThreads` is unaffected and still offloads `JSON.parse`, which is the expensive part — 60 µs against 16 µs on a 13 KB MeterValues.
### Deprecated

- `ClusterDriverOptions.prefix`. Documented as driving hash-tag generation but never read. Key prefixing is configured on the adapter via `RedisAdapterOptions.prefix`.

### Fixed (client startup)

- **A CALL arriving before handlers were registered got a false `NotImplemented`.** The socket dispatches as soon as it opens, so a CSMS that sends `Reset` the instant a charger appears could beat the application's `handle()` calls. The client answered `NotImplemented` — telling the peer the charger does not support an action it *does* support. Measured before the fix: registering directly after `await client.connect()` was already too late, and registering after any further `await` was too late as well, so the only working order was register-then-connect. That ordering was neither enforced nor discoverable, and the failure was intermittent.

  A CALL with no matching handler now waits for one during a bounded startup window (`ClientOptions.handlerGraceMs`, default 1000&nbsp;ms, `0` disables), and is answered the moment the handler is registered. Outside that window an unknown action is still rejected immediately, so genuinely unsupported actions are never delayed. The wait is capped at 100 parked messages so an unknown-action flood cannot pile up.

## v2.3.1 - Subpath Type Declarations (2026-09-05)

Patch release. No runtime changes — types only.

### Fixed

- **`ocpp-ws-io/browser` shipped without type declarations.** The two `tsup` configs run concurrently against the same `outDir`, and `clean: true` on the Node config raced the browser config's declaration output: `dist/browser.d.ts` and `dist/browser.d.mts` were written and then deleted whenever `dist/` already existed (always true at publish time, since `prepublishOnly` builds over it). TypeScript consumers importing `ocpp-ws-io/browser` resolved the JS through the `exports` map, found no `types` target, and fell back to an implicit `any`:

  ```
  Could not find a declaration file for module 'ocpp-ws-io/browser'.
  '.../node_modules/ocpp-ws-io/dist/browser.js' implicitly has an 'any' type.
  ```

  Cleaning now happens once in the `build` script, before the concurrent tsup runs.

- **Subpath types were invisible to `moduleResolution: "node"`.** Legacy TS resolution ignores `exports`, so every subpath (`/browser`, `/adapters/redis`, `/plugins`, `/logger`, `/express`, `/nestjs`, `/fastify`, `/hono`) resolved to `any` — only the root entry carried types. Added `typesVersions` so all subpaths resolve under `node`, `node16`, and `bundler`.

### Added

- `scripts/verify-dist.js`, run as part of `build`: fails the build if any file declared in `exports` / `main` / `module` / `types` is missing from `dist/`. An incomplete `dist` can no longer be published silently.

## v2.3.0 - Review Hardening (2026-06-11)

Fixes every finding from the full-codebase security & reliability review
(3 critical, 8 high, 14 medium, ~12 low). 52 new regression tests
(840 total).

### Fixed

- **Worker-thread parse pool was silently non-functional**: `parse-worker.cjs` now ships in `dist/` and decodes binary frames (`Buffer` → `Uint8Array` across `postMessage`). The pool shuts down on `server.close()` so worker threads no longer pin the process, and is re-created on a later `listen()`.
- **OCPP 2.1 strict-mode validation was a silent no-op**: `Request`/`Response`-style schema ids now resolve (validator and worker).
- **Cluster presence TTL is heartbeat-refreshed** (every `presenceTtlSeconds / 2`); long-lived connections stay routable. Evicted duplicate connections no longer wipe the presence entry their replacement just registered.
- **Cross-node `sendToClient` now returns the remote client's response** (correlation ids over the adapter). Stale registry entries answer immediately with "not found" instead of timing out; adapter publish failures settle the call cleanly (no leak, no unhandled rejection).
- AbortSignal listeners detach when calls settle (node + browser clients); offline-queue overflow rejects the dropped call instead of stranding its promise.
- Inbound message processing is serialized per connection — async plugins and worker parsing can no longer reorder OCPP messages.
- Per-IP connection-rate buckets are garbage-collected; `x-forwarded-proto` is only honored behind the new `trustProxy` CORS option (scheme-spoofing fix).
- External HTTP servers passed to `listen(..., { server })` are no longer 404-hijacked by `healthEndpoint` nor closed by `server.close()` (also respected by the `listen({ signal })` abort path).
- Redis adapter: presence cache pruned on removal, no `__seq` payload mutation, stream offsets survive resubscribe, non-blocking polls when no dedicated blocking client exists, and a direct `driver` option (ClusterDriver is now actually usable; honest construction errors; cross-slot-safe presence batches).
- Strict mode validates inbound CALLRESULT payloads; OCPP 1.6 emits the spec spelling `FormationViolation` (2.x keeps `FormatViolation`).
- `message-dedup` only dedups CALLs (results/errors reuse the CALL id) and replays cached responses to retrying chargers; webhook plugin treats non-2xx as failure, clears timers, and backs off between retries.
- Detailed CALLERRORs no longer include stack traces; Basic-Auth identity comparison is timing-safe; malformed percent-encoding in upgrade URLs no longer crashes the handshake.
- `sendBatch` no longer mutates the client's `callConcurrency` (uses `callImmediate`); backpressured sends share one FIFO drain timer per client; `server.reconfigure()` actually applies `maxPayloadBytes` / `compression` / `rateLimit.adaptive` / `presenceTtlSeconds` changes; `connect()` failures reject instead of throwing uncaught when no `error` listener is attached; late `router.route()` patterns register with the server; client endpoints with query strings keep the identity in the pathname; `getPackageIdent()` reports the real version (drift-tested).

### Added

- `ServerOptions.maxConnections` — hard connection cap rejected at upgrade time (HTTP 503) with a `CONNECTION_LIMIT` security event.
- `ServerOptions.presenceTtlSeconds` — cluster presence TTL / heartbeat basis.
- `CORSOptions.trustProxy` — opt-in `x-forwarded-proto` handling behind a trusted proxy.
- `RedisAdapterOptions.driver` — pass a pre-built driver (e.g. `ClusterDriver`) directly.
- `OCPPClient.hasHandler()`, `OCPPClient.callImmediate()`, `OCPPClient.bufferedAmount`.

### Migration notes

- **`x-forwarded-proto` is now ignored by default.** If you enforce `allowedSchemes` behind a reverse proxy (nginx/Caddy), set `cors: { trustProxy: true }`.
- **Remote `sendToClient` now resolves with the remote response** (previously `undefined` fire-and-forget). Calls to nodes running older versions reject with `TimeoutError`.
- **OCPP 1.6 format errors are reported as `FormationViolation`** per the 1.6J spec (previously `FormatViolation`).
- **`createValidator()` always returns a fresh instance** — custom schema sets are no longer shadowed by a global cache.
- **The heartbeat plugin defers to an existing `Heartbeat` handler** instead of throwing.

## v2.2.4 - Security & Reliability Hardening

### Changes

- **Strict Plugin Initialization**: Added runtime validation to prevent **zero-key PII redaction** (which caused silent failures) and **uninitialized Redis plugins**. The `initialize()` call now throws an informative error if `options.sensitiveKeys` is missing or empty, or if a Redis-backed plugin is initialized without a Redis client.
- **Refined PII Redaction Logic**:
  - **Default Value Removed**: `options.sensitiveKeys` now defaults to `undefined`, forcing the caller to explicitly list keys. This prevents accidental redaction of essential fields like `idToken` in `Authorize` messages.
  - **Breaking Change Documentation**: Updated `src/plugins/pii-redactor.ts` to clearly state in the JSDoc that `sensitiveKeys` is a **required** property and provide explicit usage examples.
- **Graceful Redis Plugin Handling**: Modified `OCPPPluginFactory.initialize` to check for the presence of a `redisClient` when creating Redis-backed plugins. If a plugin requires a Redis client and none is provided, it will now log a warning and skip initialization instead of throwing a hard error, ensuring the rest of the plugin chain remains functional.

## v2.2.3 - Transport Hardening

A focused reliability release that closes gaps in cross-cluster routing, the
restart lifecycle, and best-effort call logging. Fully backward compatible.

### Improvements

- **Version-Aware Unicast Routing**: `sendToClient(identity, version, method, params)`
  now carries the OCPP `version` end-to-end. Locally it dispatches through the
  version-specific `client.call()` overload (enabling version-aware strict
  validation); across a cluster the `version` is included in the unicast payload so
  the receiving node resolves the same overload. Previously the `version` argument
  was parsed and silently discarded, and remote nodes received no version at all.
- **O(1) Targeted Delivery**: `sendToClient` and the internal unicast handler now
  resolve the target via the `identity` index instead of scanning every connected
  client, removing a linear lookup on the hot path for large fleets.
- **Restart-Safe Transport Config**: Centralized `WebSocketServer` creation so the
  configured `maxPayloadBytes` and `perMessageDeflate` compression settings are
  reapplied consistently across the constructor, upgrade re-init, and
  `close()` → `listen()` restart cycles. Previously a restart could silently drop
  compression and the max-payload limit.

### Fixes

- **Accurate `safeCall` Error Logs**: The method name reported when a `safeCall`
  fails is now resolved using the same overload parsing as `call()`, instead of a
  string heuristic that could misreport custom method names.

## v2.2.2 - The "Universal Framework" Release

This massive release transforms `ocpp-ws-io` from a standalone WebSocket engine into a universal, multi-framework toolkit. We have introduced native integrations for **Fastify**, **Hono**, **NestJS**, and fundamentally unlocked **Bun** and **Deno** support.

### Major Features & Integrations

- **Unified Context Architecture (`BaseOcppContext`)**: Completely abstracted the core context logic, allowing any Node.js framework to inject a standard, strongly-typed `ocpp` object directly into its request lifecycle.
- **First-Class Fastify Integration (`ocpp-ws-io/fastify`)**:
  - Shipped a native Fastify plugin that seamlessly handles HTTP upgrades.
  - Hardened with strict memory-leak prevention (automatically deregisters `upgrade` hooks on server close).
  - TypeScript module augmentation injects `req.ocpp` safely across all Fastify routes.
- **First-Class Hono Integration (`ocpp-ws-io/hono`)**:
  - Shipped native middleware (`ocppMiddleware`) compatible with Hono's `ContextVariableMap`.
  - Added `@hono/node-server` adapters to elegantly handle raw Node server upgrades without dropping performance.
- **Bun & Deno Native Support**:
  - By hooking into standard Node.js networking (`ws` and `node:http`), `ocpp-ws-io` now inherently supports Bun and Deno environments perfectly via their compatibility layers. Zero configuration required.
- **Native NestJS Support (`ocpp-ws-io/nestjs`)**:
  - **First-Class Decorators**: Introduced `@OcppGateway()`, `@OcppMessageEvent()`, and `@OcppAuth()` for seamless class-based WebSocket routing.
  - **Parameter Injectors**: Map incoming OCPP properties directly to method parameters via `@Identity()`, `@Params()`, `@Session()`, and `@Context()`.
  - **Dynamic Module Initialization**: Provided `OcppModule.forRoot()` and `OcppModule.forRootAsync()` to natively register the adapter alongside global configurations.
  - **Zero-Config WebSockets**: The `OcppService` now automatically hooks into the underlying `HttpAdapterHost`.
  - **Testing Environment Hardening**: Bypassed ESBuild/Vite decorator stripping behaviors by utilizing NestJS `useFactory` instantiation, guaranteeing 100% test compatibility.

### Internal Refactors

- **Express Optimization**: Refactored the existing `ocpp-ws-io/express` integration to utilize the new `BaseOcppContext` for consistency across the library.
- **Upgrade Request Filtering**: Centralized the path-matching and upgrade-filtering logic into `base/utils.ts` to guarantee uniform behavior across all supported frameworks.

### Documentation

- Restructured the documentation tree into a new Fumadocs `frameworks` layout.
- Added extensive guides, examples, and edge-case documentation for NestJS, Fastify, Hono, Bun, and Deno.

## v2.2.1 - Plugin System Hardening & Type Exports

### Patch Changes

- **Exported Missing Plugin Types**: Exported `SecurityEvent`, `MessageEventPayload`, `MessageDirection`, `MessageEventContext`, `OCPPServerStats`, and `TelemetryConfig` from `index.ts` so external plugin authors can properly type their hooks.
- **Improved Type Safety**: Added missing `backpressure` and `rateLimitExceeded` events to the `ClientEvents` interface to allow fully type-safe event listeners.
- **Fixed Outbound Interception Bypass**: Guarded the `CALLERROR` generated from `_onBadMessage` with `_invokeBeforeSend` to ensure it can be intercepted by plugins.
- **Massive Plugin System Upgrade**: Expanded the `OCPPPlugin` interface from 4 to 26 hooks, adding complete lifecycle observability and control.
  - Added message interception: `onBeforeReceive` and `onBeforeSend` hooks (return `false` to drop/block messages).
  - Added new error event hooks: `onBadMessage`, `onValidationFailure`, `onHandlerError`, `onError`.
  - Added security and lifecycle hooks: `onSecurityEvent`, `onAuthFailed`, `onRateLimitExceeded`, `onEviction`.
  - Added infrastructure hooks: `onBackpressure`, `onPongTimeout`, `onClosing`, `onReconfigure`, `onTLSUpdate`.
- **Telemetry Engine**: Added background telemetry push mechanism via `telemetry.pushIntervalMs` option. Automatically pushes `OCPPServerStats` to plugins implementing `onTelemetry`.
- **Custom Metrics**: Restored `getCustomMetrics` natively to `/metrics` so plugins can contribute custom Prometheus lines.
- **Client & Server Integration**: Built-in support across both `OCPPClient` and `OCPPServerClient` objects. All existing plugins are fully backward compatible.

## v2.2.0 - Message Event Observability (BREAKING CHANGE)

### Major Changes

- **BREAKING**: Unified message event API with direction tracking and enriched context
  - New `message` event emits `{ message, direction, ctx }` payload instead of raw `OCPPMessage`
  - Direction indicator: `"IN"` (from peer) | `"OUT"` (to peer)
  - Enriched context includes: `timestamp`, `latencyMs`, `protocol`, `method`, `type`
  - Applies to both `OCPPClient` and `OCPPServerClient` (server-side connections)
  - See [MIGRATION_v3_MESSAGE_EVENTS.md](./MIGRATION_v3_MESSAGE_EVENTS.md) for detailed migration guide

### Backward Compatibility Notes

- Old `call`, `callResult`, `callError` events still emit (deprecated, for compatibility)
- `badMessage` and other events unchanged
- Middleware context handling unchanged (`MiddlewareContext` still used internally)
- All 703 tests passing — comprehensive test coverage ensures stability

### Related Files

- New types: `MessageDirection`, `MessageEventPayload`, `MessageEventContext` in `src/types.ts`
- Updated: Client event handling in `src/client.ts` with helper methods
- Server-client inherits from client, automatically gets message event support
- Enhanced README with observability section and examples

### Examples

**Before (v2.1.15):**

```typescript
client.on("call", (msg) => {
  const [, id, method] = msg;
  console.log(`Call: ${method}`);
});
```

**After (v2.2.0):**

```typescript
client.on("message", ({ message, direction, ctx }) => {
  console.log(`${direction} ${ctx.method} [latency: ${ctx.latencyMs}ms]`);
});
```

## 2.1.15

### Patch Changes

- Documentation update not core or breaking changes

## 2.1.14

### Patch Changes

- Bump `voltlog-io` to v1.0.7
- Disable source maps in build output for improved debugging and stack trace readability

## 2.1.13

### Patch Changes

- Bump `voltlog-io` to v1.0.6

  v1.0.5 and earlier shipped `dist/chunk-DAFMRCAN.mjs` which unconditionally
  executed `import { fileURLToPath } from "url"` (a Node.js built-in) as part of
  tsup's ESM shim, crashing every browser bundler (Vite, Next.js/webpack, esbuild)
  with `fileURLToPath is not a function`.

  v1.0.6 removes the shared chunk entirely and ships a clean browser-safe client
  bundle — no Node.js shim, no `path`/`url` imports.

  This unblocks `voltlog-io/client` usage in `ocpp-ws-io/browser` (`browser/init-logger.ts`)
  which was added in the previous patch to replace the root `init-logger.ts` that
  imported from the Node.js-only full `voltlog-io` entry point.

## 2.1.12

### Patch Changes

- Fix browser package pulling in Node.js-only modules
  - `browser/util.ts`: inline `NOOP_LOGGER` definition instead of re-exporting from `../util.js`, which transitively imported `node:crypto` and would break any strict browser bundler (Vite, webpack, esbuild)
  - `browser/init-logger.ts`: new browser-safe logger initialiser that imports from `voltlog-io/client` (the browser-only bundle) instead of the full `voltlog-io` package which includes Node.js transports
  - `browser/client.ts`: update `initLogger` import to `./init-logger.js` (new browser-local file)
  - `browser/index.ts`: replace `export * from "../helpers/index.js"` with explicit named exports of only the two browser-safe helpers (`createLoggingMiddleware`, `defineRpcMiddleware`); server-only exports (`defineMiddleware`, `createPlugin`, `defineAuth`, `combineAuth`) are no longer part of the browser API surface

## 2.1.11

### Patch Changes

- feat: re-enable source maps in build output for improved debugging and stack trace readability
- add: voltlog new version that allows client side imports

## 2.1.10

### Patch Changes

- perf: replace `@paralleldrive/cuid2` with `crypto.randomUUID()` for faster, zero-dependency ID generation
- perf: disable source maps, enable minification and tree shaking — package size reduced from ~9MB to 2.9MB (unpacked)
- chore: remove `@paralleldrive/cuid2` from dependencies

## 2.1.9

### Patch Changes

- fix: resolve CodeQL security vulnerabilities including dynamic method call invocation issues

  fix: update CI/CD pipeline with Netlify build hooks for reliable monorepo deployments

## 2.1.8

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
