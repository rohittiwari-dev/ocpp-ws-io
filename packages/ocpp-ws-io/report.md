> **Status update (2026-06-11):** All findings in this report have been addressed.
> See `docs/superpowers/plans/2026-06-10-ocpp-ws-io-review-fixes.md` and the
> `Unreleased` section of CHANGELOG.md for the fix list.

# Deep-Dive Review: `ocpp-ws-io` (v2.2.4)

**Date:** 2026-06-10
**Scope:** `packages/ocpp-ws-io` — full source review (~21k LOC src, 56 test files / 788 tests)
**Focus:** Correctness, OCPP 1.6J / 2.0.1 / 2.1 spec compliance, security, Redis/cluster scaling, plugin & framework integrations, build health.

---

## 1. Executive Summary

`ocpp-ws-io` is a well-architected, type-safe OCPP-J WebSocket RPC toolkit with an unusually broad feature surface: 3 OCPP versions, all 4 security profiles, radix-trie routing, a plugin system with ~20 lifecycle hooks, Redis clustering (pub/sub + streams + presence), and 4 framework integrations. The code is clean, well-commented, and the test suite is healthy (**788/788 passing, ~12s**).

However, the review found **3 critical defects** that undermine headline features in production:

1. **The worker-thread parsing feature is completely non-functional** (worker file missing from the published build *and* a `Buffer`→`Uint8Array` structured-clone bug that makes every parse fail even when the file exists — verified empirically).
2. **Strict-mode validation for OCPP 2.1 is a silent no-op** (schema `$id` naming mismatch — 0 of 181 schemas resolvable).
3. **Cluster presence expires after 5 minutes and is never refreshed**, breaking cross-node routing for any charger connected longer than the TTL.

Additionally, **cross-node `sendToClient` is fire-and-forget** — the remote charger's CALLRESULT is never returned to the caller — which is a fundamental gap relative to the "RPC across the cluster" positioning.

None of these are detected by the test suite because the tests exercise mocks (`ioredis-mock`), single-node setups, or the source tree (where `parse-worker.ts` resolution differs from `dist`).

**Verdict:** Excellent single-node OCPP server/client library. The clustering and performance-offload features need the fixes below before being relied on in a multi-node CSMS.

---

## 2. Architecture Overview

```
src/
├── server.ts            OCPPServer — upgrade pipeline, routing, plugins, clustering façade
├── client.ts            OCPPClient — RPC engine (calls, handlers, reconnect, validation)
├── server-client.ts     OCPPServerClient — server-side client w/ rate limits + plugin hooks
├── router.ts            OCPPRouter + Koa-style connection middleware chain
├── radix-trie.ts        O(k) path matching (static > :param > * priority)
├── ws-util.ts           RFC 6455/7230-compliant subprotocol & Basic-Auth parsing
├── cors.ts + utils/cidr.ts  IP/CIDR/origin/scheme gating (IPv4 + IPv6)
├── validator.ts         AJV strict-mode validation, lazy compile, global registry
├── adapters/
│   ├── adapter.ts       InMemoryAdapter + defineAdapter()
│   └── redis/           RedisAdapter (pub/sub broadcast + streams unicast + presence)
├── worker-pool.ts       Off-thread JSON parse pool (round-robin, self-healing)
├── plugins/             19 plugins (metrics, otel, kafka, mqtt, amqp, dedup, …)
├── frameworks/          express / fastify / hono / nestjs glue
└── browser/             Dependency-free browser port of OCPPClient
```

**Clustering model:** each node gets a random `nodeId`; broadcast goes over Redis pub/sub (`ocpp:broadcast`), node-to-node unicast over Redis Streams (`ocpp:node:<nodeId>`), and a `presence:<identity> → nodeId` key registry routes `sendToClient()` to the owning node.

### Genuine strengths

- **Handshake pipeline** (`server.ts:728`) is carefully built: state guard → per-IP token bucket → CORS → trie routing → subprotocol negotiation (RFC-correct parser) → Basic-Auth/mTLS extraction → middleware+auth chain with `AbortController`, socket-death listeners, and timeout — with security events emitted at every rejection point.
- **RFC compliance details** rarely seen: `parseSubprotocols` implements the RFC 7230 token grammar; close codes validated per RFC 6455 §7.4; Basic-Auth passwords returned as `Buffer` (OCPP security whitepaper) with identity-prefix colon handling.
- **Resilience features**: ping/pong dead-peer detection with ±25% jitter, full-jitter call retries, exponential reconnect backoff per OCPP 2.0.1 §J.1 (resets on successful connect), offline queue with atomic drain, duplicate-identity eviction, graceful drain of `bufferedAmount` on shutdown, TLS hot-reload (`updateTLS`), LRU-bounded session cache.
- **Typed API**: versioned overloads (`call("ocpp1.6", "BootNotification", …)`) with generated request/response types for all three protocol versions.
- **Test suite**: 788 tests, fast, covering handshake robustness, routing, validation, plugins, frameworks, browser client.

---

## 3. Critical Findings

### C1 — Worker-thread parsing is non-functional (build + runtime bugs)

**Files:** `tsup.config.ts`, `worker-pool.ts:45`, `parse-worker.ts:81`, `server-client.ts:204-216`

Two independent defects make `workerThreads: true` dead weight:

1. **`parse-worker.ts` is not a tsup entry**, so the published `dist/` contains no `parse-worker.js` (verified: `ls dist` → no match). `WorkerPool` resolves `resolve(__dirname, "parse-worker.js")` at runtime → every worker errors on spawn in any installed copy of the package.
2. Even when the file exists (running from source), `worker.postMessage({ buffer })` structured-clones the `Buffer` into a plain `Uint8Array`. `JSON.parse(uint8Array)` coerces via comma-joined `toString()` and **always throws**. Verified empirically:
   ```
   {"ok":false,"err":"Unexpected non-whitespace character after JSON at position 2","type":"Uint8Array","isBuffer":false}
   ```
   Since `ws` delivers `Buffer`s by default, **every message** takes a failed worker round-trip, then falls back to main-thread parse (`server-client.ts:211-214`) — i.e. the feature *adds* latency and CPU instead of removing it, silently.

**Fix:** add `"parse-worker": "src/parse-worker.ts"` to the tsup Node entry; in the worker do `Buffer.from(buffer).toString("utf8")` (or decode with `TextDecoder`) before `JSON.parse`. Consider transferring the underlying `ArrayBuffer` to avoid the copy.

### C2 — OCPP 2.1 strict mode validates nothing (silent no-op)

**Files:** `src/schemas/ocpp2_1.json`, `validator.ts:121-129`, `client.ts:1755/1782`, `parse-worker.ts:90`

The validator builds lookup IDs as `urn:<Method>.req` / `urn:<Method>.conf`. The 1.6 and 2.0.1 schema files follow that convention, but **all 181 OCPP 2.1 schemas are registered as `urn:<Method>Request` / `urn:<Method>Response`** (verified: 0 `.req/.conf`-style IDs in `ocpp2_1.json`). `Validator.validate()` treats a missing schema as "no schema for this action — skip" and returns silently.

**Impact:** a CSMS running `strictMode: true` against `ocpp2.1` chargers performs **zero** payload validation while reporting none of it — a correctness *and* security regression (strict mode is the documented defense against malformed payloads).

**Fix:** normalize at `Validator` construction (map `…Request`→`.req`, `…Response`→`.conf` for the 2.1 set), or regenerate the 2.1 schema file with consistent IDs. Add a regression test asserting every protocol has ≥1 resolvable `urn:<knownMethod>.req` schema.

### C3 — Cluster presence expires after 300s and is never refreshed

**File:** `server.ts:1266-1278` (comment admits "For Phase 1, we set it once")

On connection, `setPresence(identity, nodeId, 300)` is called exactly once. There is no heartbeat/refresh (the batch-refresh plumbing — `setPresenceBatch`, `presenceTtlSeconds` — exists in the adapter but is never wired into the server).

**Impact:** in a multi-node deployment, any charger connected longer than 5 minutes vanishes from the registry. `sendToClient()` from another node then throws `Client <id> not found` (`server.ts:1677`) even though the charger is healthy and connected. Since EV chargers hold connections for hours/days, **cross-node unicast effectively only works for the first 5 minutes of every connection.**

**Fix:** add a presence-refresh interval (e.g. every `ttl/2`, batched via `setPresenceBatch` for all local identities), and refresh on activity.

---

## 4. High-Severity Findings

### H1 — Cross-node `sendToClient` never returns the response

**Files:** `server.ts:1653-1667` (publish + `return;`), `server.ts:1841-1891` (`_onUnicast` fire-and-forget)

When the target charger lives on another node, the call payload is published to that node's stream and the method resolves `undefined`. The remote node executes `client.call(...)` and only *logs* the outcome — there is no reply channel correlating the CALLRESULT back to the originating node.

**Impact:** the core promise of "RPC to any client in the cluster" only holds for local clients. Remote calls give the caller no result, no error, no delivery confirmation — indistinguishable from a dropped message. Combined with C3, remote behavior is unreliable in both directions. The typed signature (`Promise<OCPPResponseType | undefined>`) hints at this, but it deserves prominent documentation and ideally a real implementation (publish a response message to `ocpp:node:<source>` keyed by a correlation ID, with timeout).

### H2 — Offline-queue overflow leaves callers hanging forever

**File:** `client.ts:716-739`

When the offline queue is full, the **oldest entry is `shift()`ed and discarded without settling its promise**. The dropped caller's `await client.call(...)` hangs forever (no timeout is armed until `_sendCall` runs). In a long offline window with `offlineQueue: true`, every overflowed call is a leaked, permanently-pending promise.

**Fix:** `reject()` (or resolve with a typed error) the dropped entry.

### H3 — Stale presence resurrection + unbounded cache in RedisAdapter

**File:** `adapters/redis/index.ts:74, 320-349, 405-417`

`_presenceCache` is appended on every `setPresence` but **never pruned on `removePresence`**. Consequences:
1. After a Redis reconnect, `_rehydratePresence()` re-registers **every identity ever seen**, including chargers that disconnected hours ago — other nodes will route unicasts to a node that no longer owns the client (the receiving node then deletes presence for a *possibly reconnected-elsewhere* client, `server.ts:1883`, compounding the inconsistency).
2. Unbounded memory growth on long-lived nodes with churn.

**Fix:** delete from `_presenceCache` in `removePresence()`; consider an LRU bound.

### H4 — Per-IP connection-rate-limit buckets are never evicted

**File:** `server.ts:76-79, 741-777`

`_connectionBuckets` grows one entry per unique source IP, forever. The very attack it defends against (high-rate connections from rotating IPs, e.g. a botnet or IPv6 rotation) drives unbounded memory growth. There is no GC interval, no LRU, no TTL.

**Fix:** sweep buckets with full tokens older than `windowMs` in the existing `_gcInterval`, or use `LRUMap`.

### H5 — `x-forwarded-proto` trusted unconditionally (scheme-gate bypass)

**File:** `cors.ts:26-30`

The scheme check (`allowedSchemes: ["wss"]`) prefers `x-forwarded-proto` over the actual socket type with no "trust proxy" opt-in. A direct (non-proxied) attacker on plain `ws://` sends `X-Forwarded-Proto: https` and passes a `wss`-only gate.

**Fix:** add a `trustProxy: boolean | string[]` option (default `false`); only honor forwarded headers when enabled. The same applies to IP allowlists if `X-Forwarded-For` support is ever added (currently `remoteAddress` is used, which is correct but means IP rules don't work behind proxies — worth documenting).

### H6 — Async plugin hooks & worker pool break message ordering

**File:** `server-client.ts:151-220`

The `ws.on("message")` handler is `async` and awaits `onBeforeReceive` plugins (e.g. `message-dedup` does a Redis round-trip per message). Node does not serialize async event handlers, so two in-flight messages can complete out of order: `StopTransaction` can be processed before the `StartTransaction` that preceded it on the wire. The round-robin worker pool path has the same property (different workers finish in any order).

**Impact:** OCPP transaction semantics assume ordered processing per connection. Under load or Redis latency, financial events can invert.

**Fix:** per-connection sequential pipeline (chain a promise per client), or document that async interceptors void ordering guarantees.

### H7 — `healthEndpoint` + user-provided server hijacks all HTTP routes

**File:** `server.ts:500-585`, `listen(..., { server })`

When `healthEndpoint: true`, a `request` listener is attached that **404s every URL other than `/health` and `/metrics`**. If the user passes their own Express/Fastify HTTP server via `options.server`, both handlers run and both write responses → broken app routes and `ERR_HTTP_HEADERS_SENT`. Additionally, `server.close()` closes externally-owned HTTP servers (`server.ts:1511-1519`) and `listen()` never removes the `upgrade` handler it added.

**Fix:** only register the catch-all 404 on servers the library created; on external servers, handle only `/health`+`/metrics` and skip closing them on shutdown (or document the ownership transfer).

### H8 — AbortSignal listener leak on completed calls

**File:** `client.ts:876-895, 1330-1333`

`options.signal.addEventListener("abort", abortHandler)` is added per call, and the stored `abortHandler` field actually holds the **remover** closure — but it is never invoked anywhere: `_handleCallResult` has a literal empty block (`if (pendingCtx.abortHandler) { /* Remove abort listener if bound */ }`), `_handleCallError` and the timeout path don't even check. With a long-lived shared `AbortSignal` (a common pattern: one controller for a session issuing thousands of calls), listeners accumulate without bound.

**Fix:** call the remover in all three settle paths (result, error, timeout) and in `_rejectPendingCalls`.

---

## 5. Medium-Severity Findings

| # | Finding | Location |
|---|---------|----------|
| M1 | **Redis blocking `XREAD` falls back to the shared pub connection** when `blockingClient` isn't provided — every 1s poll blocks all publishes/presence ops on that connection (head-of-line blocking). `blockingClient` is optional but in practice mandatory. | `helpers.ts:201, 369` |
| M2 | **`ClusterDriver` is unusable as designed**: the doc-comment promises `{hash-tag}` sharding but no hash tags are ever generated; `setPresenceBatch`/`mget` pipeline cross-slot keys (fails on ioredis Cluster); the JSDoc example (`pubClient: {}` + `driverFactory`) doesn't work because `driverFactory` is only consulted when `poolSize > 1` and the primary driver is still built from `pubClient`/`subClient`; the constructor's `catch` rethrows *every* error as "install ioredis", masking real failures. | `cluster-driver.ts:30-78`, `redis/index.ts:87-102` |
| M3 | **`__seq` ordering counters are written but never read** — the adapter stamps `__seq` onto unicast payloads (mutating the caller's object) but `_onUnicast` never checks sequence; out-of-order delivery is undetected. Dead code + payload pollution. | `redis/index.ts:129-139`, `server.ts:1841` |
| M4 | **Stream re-subscribe replays old messages**: offsets reset to `"0"` on (re)subscribe, so an `unsubscribe`→`subscribe` cycle (or a node reusing a nodeId) replays up to `streamMaxLen` stale unicast calls → duplicate commands to chargers. | `redis/index.ts:204-212` |
| M5 | **`adapterMetrics()`/HPA lag metric is wrong**: comment claims "XLEN directly equals pending unread messages" — false; consumed entries remain in the stream until MAXLEN trimming, so the metric over-reports backlog → autoscaler over-scaling. | `redis/index.ts:357-359` |
| M6 | **Inbound CALLRESULT payloads are never schema-validated in strict mode** — only inbound CALL (`.req`) and outbound result (`.conf`) are checked. A malformed/malicious response from a charger flows straight into application code. | `client.ts:1186-1213` (no `_validateInbound(..., "conf")` anywhere) |
| M7 | **OCPP 1.6 error-code mismatch**: 1.6J defines `FormationViolation`; the validator keyword map and the bad-message path always emit `FormatViolation` (the 2.0.1+ name) regardless of negotiated protocol. Strict CPs may not recognize the code. | `validator.ts:57-59`, `client.ts:1400` |
| M8 | **`createValidator` silently ignores custom schemas** if a validator for that subprotocol is already cached — `createValidator("ocpp1.6", mySchemas)` returns the standard validator with no warning. | `validator.ts:163-173` |
| M9 | **`sendBatch` mutates shared client concurrency**: temporarily raising `callConcurrency` and restoring it in `finally` races with concurrent `sendBatch` calls or user `reconfigure` — last writer wins, possibly pinning a charger at the wrong concurrency. | `server.ts:1774-1797` |
| M10 | **Backpressure wait spawns one 50ms `setInterval` per queued send** — under sustained backpressure with hundreds of pending sends, hundreds of timers poll the same `bufferedAmount` (timer storm). A single shared drain-waiter per socket suffices. | `client.ts:1640-1656` |
| M11 | **`message-dedup` drops duplicate CALLs without replaying the response.** Per OCPP-J guidance, a retried CALL with the same messageId should receive the original CALLRESULT; silently dropping it guarantees the charger times out and may retry forever. Also adds one Redis RTT to *every* message (and is the main trigger for H6). | `plugins/message-dedup.ts:120-161` |
| M12 | **`connectionGuard` enforces the cap after full TLS + auth + upgrade** — an attacker (or reconnect storm) pays nothing; the server does the expensive work then closes. Cap should be enforced at upgrade time (e.g. a connection-middleware or `onUpgrade` hook). Count also drifts if `onConnection` of another plugin throws before guard registers. | `plugins/connection-guard.ts:70-81` |
| M13 | **`respondWithDetailedErrors` leaks stack traces to remote peers** — `getErrorPlainObject` includes `stack`, sent inside CALLERROR details. Document as debug-only / strip `stack` by default. | `util.ts:61-69`, `client.ts:1248-1258` |
| M14 | **Malformed %-encoding in URL path throws** — `decodeURIComponent` in trie matching and identity extraction raises `URIError` for paths like `/ocpp/CP%E0%A4%A`; the upgrade catch destroys the socket without a clean HTTP 400. | `radix-trie.ts:188`, `server.ts:894` |

---

## 6. Low-Severity / Polish

- **`getPackageIdent()` hardcodes `1.0.1`** while the package is 2.2.4 — the `User-Agent` header misreports the version on every client connection (`util.ts:113-114`). Generate from `package.json` at build time.
- **README claims "Zero-dependency"** — actual runtime deps: `ajv`, `ajv-formats`, `ws`, `voltlog-io`. Also references "(v3.0.0+)" features while the package is v2.2.4.
- **"Zero-copy" comments are inaccurate** (`client.ts:1044`, `server-client.ts:181`): `JSON.parse(buffer)` implicitly allocates a string via `toString()`. Functional, but the claimed optimization doesn't exist.
- **`redis-pubsub` plugin publishes a `"closing"` event that can never be enabled** — `"closing"` is missing from the `RedisPubSubEvent` union and the default allowlist, so `send("closing", …)` is always filtered out (`plugins/redis-pubsub.ts:21-27, 251-255`).
- **`heartbeatPlugin` collides with user handlers** — `client.handle("Heartbeat", …)` throws if the app registered its own; the error is only swallowed into plugin logs (`plugins/heartbeat.ts:20`).
- **Webhook plugin**: doesn't check `response.ok` (HTTP 500 counts as success), doesn't clear the abort timer on failure, no backoff between retries (`plugins/webhook.ts:78-97`).
- **`maxBadMessages` defaults to `Infinity`** — a peer can spray garbage forever by default; counter also never decays on good messages.
- **`_buildEndpoint` breaks if the endpoint contains a query string** — identity is appended after `?…`, e.g. `ws://host/path?x=1/CP-1` (`client.ts:1811-1825`).
- **Late `router.route()` calls after `attachRouters()`/`server.route()` are silently ignored** — patterns are only inserted into the trie at registration time.
- **Leftover debug artifact**: commented-out `console.log` in `_startPing` (`client.ts:1672`); duplicated JSDoc block above `sendToClient` (`server.ts:1570-1583`).
- **`@ts-expect-error` used to reach private base-class members** in `server-client.ts` and `server.ts` (e.g. `_startPing`, `_ws` drain check) — these should be `protected`.
- **`reconfigure()` on the server** updates options but never rebuilds dependent subsystems (adaptive limiter, worker pool, compression config of `_wss`), so most reconfigurations silently don't take effect until restart.

---

## 7. Security Posture Summary

| Area | Assessment |
|------|------------|
| Security profiles 0–3 | ✅ Correctly implemented (Basic over WS, TLS+Basic, mTLS w/ `requestCert` + peer-cert exposure to auth callback) |
| Basic-Auth parsing | ✅ RFC 7617-tolerant, binary-password Buffers, identity-prefix handling. ⚠️ Comparison is not constant-time (minor timing-oracle on identity match) |
| Origin/IP/scheme gating | ✅ Solid CIDR (v4+v6) implementation. ❌ H5: spoofable `x-forwarded-proto`; absent-Origin passes by design (documented, correct for chargers) |
| DoS resistance | ⚠️ Token buckets at connection & message level + adaptive limiter are good, but H4 (bucket map growth), M12 (post-handshake cap), `maxBadMessages: Infinity`, and `maxPayload` 64KB default mostly OK |
| Information disclosure | ⚠️ M13 stack traces with `respondWithDetailedErrors`; auth reject messages echoed into HTTP response body (no header injection — body only) |
| Validation | ❌ C2 (2.1 no-op), M6 (responses unvalidated), M7 (1.6 error code) |

---

## 8. Scaling Assessment (Redis / multi-node)

The architecture (pub/sub broadcast, streams unicast, presence registry, batch pipelines, pooled drivers) is the right shape, but the current implementation is **not yet safe for a production multi-node CSMS**:

1. **C3** — presence expires after 5 min → remote routing breaks.
2. **H1** — remote calls return no response → cluster RPC is delivery-only.
3. **H3** — presence resurrection after Redis reconnects → misrouted unicasts.
4. **M1** — without a dedicated `blockingClient`, stream polling head-of-line-blocks all Redis ops.
5. **M2** — Redis Cluster support is effectively untested/unwired.
6. **M4/M3** — replay and ordering of unicast streams are unhandled.
7. Sessions (`_sessions`) are node-local only — a charger reconnecting to a different node loses its session; nothing in the adapter interface persists sessions (worth documenting).

Single-node and single-node-with-Redis-eventing (plugins) use cases are solid today. The fixes for C3/H1/H3 + M1 are the minimum bar for genuine horizontal scaling; all are tractable within the existing adapter abstraction.

---

## 9. Build & Test Health

- ✅ `vitest run`: **56 files, 788 tests, all passing** (12.4s).
- ✅ Dual CJS/ESM build with per-subpath exports and `.d.ts`/`.d.mts`; browser entry built with `platform: "browser"`.
- ❌ `parse-worker.js` absent from `dist/` (C1) — `files: ["dist"]` means the published package can never spawn workers.
- ⚠️ Tests rely on `ioredis-mock` and in-memory adapters — no integration coverage for: real Redis streams semantics, presence TTL expiry (C3 would be caught by a 2-node + fake-timer test), worker pool in built output, Redis Cluster.
- ⚠️ `coverage/` artifacts are committed to the repo — add to `.gitignore`.

---

## 10. Prioritized Recommendations

| Priority | Action |
|----------|--------|
| **P0** | Fix C1 (add `parse-worker` build entry + decode `Uint8Array` in worker), or remove/feature-flag `workerThreads` until fixed |
| **P0** | Fix C2 (normalize OCPP 2.1 schema IDs); add cross-version schema-resolution regression test |
| **P0** | Fix C3 (presence heartbeat via `setPresenceBatch` every TTL/2) |
| **P1** | H1: implement response correlation for cross-node `sendToClient` (reply stream + correlation ID + timeout), or document loudly |
| **P1** | H2 (reject dropped offline-queue entries), H3 (prune `_presenceCache`), H4 (GC connection buckets), H8 (remove abort listeners) |
| **P1** | H5: add `trustProxy` option; H7: don't 404/close user-provided HTTP servers |
| **P2** | H6/M11: per-connection sequential message pipeline; dedup should replay cached responses |
| **P2** | M1 (require/auto-derive blocking client), M2 (rework or remove ClusterDriver), M6 (validate inbound `.conf`), M7 (protocol-aware error codes) |
| **P3** | Remaining medium/low items; version string, README accuracy, `.gitignore` coverage |

---

## Appendix: Verification Evidence

| Claim | How verified |
|-------|--------------|
| Worker Buffer bug | Live `node` repro: postMessage(Buffer) → worker received `Uint8Array`, `JSON.parse` threw |
| `parse-worker.js` missing | `ls dist/` — no `parse-worker*`; tsup entries enumerated |
| OCPP 2.1 schema mismatch | Parsed `ocpp2_1.json`: 181 schemas, 0 matching `.req/.conf`, 180 `Request/Response`; no compensating mapping found by grep |
| Presence set-once | `server.ts:1266-1278` incl. "Phase 1" comment; no other `setPresence` call sites in server |
| Remote call returns `undefined` | `server.ts:1659-1667` — `publish(...)` then bare `return;`; `_onUnicast` only logs |
| CALLRESULT not validated | grep: `_validateInbound` called once, with `"req"` only |
| Tests pass | `npx vitest run` → 788/788 |
