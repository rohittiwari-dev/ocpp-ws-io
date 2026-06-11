# ocpp-ws-io Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all findings from `packages/ocpp-ws-io/report.md` (3 critical, 8 high, 14 medium, ~12 low) — worker pool, OCPP 2.1 validation, cluster presence/RPC, leaks, security gates, plugin bugs, docs.

**Architecture:** All changes live in `packages/ocpp-ws-io`. Fixes are grouped into 5 phases: criticals (build/validation/presence), core client/server highs, Redis/cluster + medium correctness fixes, low-severity polish, final verification. Each task is TDD: failing test → minimal fix → green → commit.

**Tech Stack:** TypeScript (strict), `ws`, AJV, tsup (CJS+ESM), vitest, ioredis-mock, biome.

**Working directory for all commands:** `D:\projects\ocpp-ws-io\packages\ocpp-ws-io`

**Conventions:**
- Run a single test file: `npx vitest run test/<file>.test.ts`
- Full suite (baseline must stay green): `npx vitest run`
- Existing suite is 788 tests, all passing — keep it that way after every task.

---

## Phase 1 — Critical Fixes

### Task 1: C1 — Make the worker-thread parse pool actually work

The worker file is missing from `dist/` (not a tsup entry) and `postMessage(Buffer)` arrives as `Uint8Array`, so `JSON.parse` always throws. Fix: convert the worker to a plain `.cjs` file (no build step needed, works from both `src/` in tests and `dist/` in prod), copy it into `dist/` on build, decode bytes properly, and add a `workerPath` option for tests.

**Files:**
- Create: `src/parse-worker.cjs`
- Delete: `src/parse-worker.ts`
- Modify: `src/worker-pool.ts`
- Modify: `tsup.config.ts`
- Modify: `src/server.ts` (log when pool creation fails)
- Test: `test/worker-pool.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/worker-pool.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { WorkerPool } from "../src/worker-pool.js";

const workerPath = fileURLToPath(
  new URL("../src/parse-worker.cjs", import.meta.url),
);

describe("WorkerPool", () => {
  test("parses a Buffer OCPP frame off-thread", async () => {
    const pool = new WorkerPool({ poolSize: 1, workerPath });
    const result = await pool.parse(Buffer.from('[2,"id1","Heartbeat",{}]'));
    expect(result.message).toEqual([2, "id1", "Heartbeat", {}]);
    await pool.shutdown();
  });

  test("parses a string frame", async () => {
    const pool = new WorkerPool({ poolSize: 1, workerPath });
    const result = await pool.parse('[3,"id2",{"ok":true}]');
    expect(result.message).toEqual([3, "id2", { ok: true }]);
    await pool.shutdown();
  });

  test("rejects on invalid JSON", async () => {
    const pool = new WorkerPool({ poolSize: 1, workerPath });
    await expect(pool.parse(Buffer.from("not-json"))).rejects.toThrow();
    await pool.shutdown();
  });

  test("constructor throws when the worker file does not exist", () => {
    expect(
      () => new WorkerPool({ poolSize: 1, workerPath: "Z:/nope/missing.cjs" }),
    ).toThrow(/worker/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/worker-pool.test.ts`
Expected: FAIL — `workerPath` option doesn't exist / `parse-worker.cjs` not found.

- [ ] **Step 3: Create `src/parse-worker.cjs`** (plain CommonJS — same logic as the old `.ts`, plus byte decoding)

```js
"use strict";
// ─── Worker Entry Point for JSON Parse + Optional AJV ───────────
// Runs in a worker_threads context. Receives raw message data
// (string or Uint8Array — Buffers arrive as Uint8Array after the
// structured clone), parses it, and optionally validates with AJV.

const { parentPort } = require("node:worker_threads");

if (!parentPort) {
  throw new Error("parse-worker must be run inside a worker thread");
}

// Lazy-loaded AJV instance for validation in the worker
let ajv = null;
const compiledSchemas = new Map();

function getOrCompileSchema(schemaId, schemas) {
  const cached = compiledSchemas.get(schemaId);
  if (cached) return cached;

  if (!ajv) {
    try {
      const Ajv = require("ajv").default;
      const addFormats = require("ajv-formats").default;
      ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      for (const [id, schema] of Object.entries(schemas)) {
        try {
          ajv.addSchema(schema, id);
        } catch {
          // Ignore duplicate schema errors
        }
      }
    } catch {
      return null; // AJV not available
    }
  }

  try {
    const validate = ajv.getSchema(schemaId);
    if (validate) {
      compiledSchemas.set(schemaId, validate);
      return validate;
    }
  } catch {
    // Schema not found
  }
  return null;
}

parentPort.on("message", (request) => {
  const { id, buffer, schemaInfo } = request;
  try {
    // Buffers are cloned as Uint8Array across postMessage — decode to utf8
    // text before parsing (JSON.parse on a Uint8Array would throw).
    const text =
      typeof buffer === "string" ? buffer : Buffer.from(buffer).toString("utf8");
    const message = JSON.parse(text);

    let validationError;
    if (schemaInfo && Array.isArray(message) && message[0] === 2) {
      const method = message[2];
      const schemaId = `urn:${method}.req`;
      const validate = getOrCompileSchema(schemaId, schemaInfo.schemas);
      if (validate) {
        const valid = validate(message[3]);
        if (!valid) {
          validationError = {
            schemaId,
            errors: JSON.stringify(validate.errors),
          };
        }
      }
    }

    parentPort.postMessage({ id, message, validationError });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
```

- [ ] **Step 4: Delete `src/parse-worker.ts`**

```bash
git rm src/parse-worker.ts
```

- [ ] **Step 5: Modify `src/worker-pool.ts`** — add `workerPath` option, existence check, decode note

In `WorkerPoolOptions` add:

```ts
export interface WorkerPoolOptions {
  /** Number of worker threads (default: Math.max(2, cpus - 2)) */
  poolSize?: number;
  /** Max pending parse jobs before rejecting (default: 10000) */
  maxQueueSize?: number;
  /** Override the worker entry path (used by tests; defaults to parse-worker.cjs next to this file) */
  workerPath?: string;
}
```

In the constructor, replace:

```ts
    // Resolve the worker entry point path
    // In production (dist/), the worker is compiled alongside the pool
    this._workerPath = resolve(__dirname, "parse-worker.js");
```

with:

```ts
    // Resolve the worker entry point path.
    // parse-worker.cjs ships as a plain CJS file (copied into dist/ by the
    // build) so the same relative path works from src/ (tests) and dist/.
    this._workerPath = options.workerPath ?? resolve(__dirname, "parse-worker.cjs");
    if (!existsSync(this._workerPath)) {
      throw new Error(
        `WorkerPool: worker entry not found at ${this._workerPath}`,
      );
    }
```

Add to imports at top: `import { existsSync } from "node:fs";`

- [ ] **Step 6: Modify `tsup.config.ts`** — copy the worker into dist after the Node build. In the **first** (Node) config object, add:

```ts
    onSuccess:
      "node -e \"require('node:fs').copyFileSync('src/parse-worker.cjs','dist/parse-worker.cjs')\"",
```

- [ ] **Step 7: Modify `src/server.ts`** — warn when the pool can't be created. In the constructor, replace:

```ts
    const wt = this._options.workerThreads;
    if (wt) {
      const poolOpts = typeof wt === "object" ? wt : {};
      this._workerPool = createWorkerPool(poolOpts);
      if (this._workerPool) {
        this._logger?.info?.("Worker thread pool initialized", {
          poolSize: this._workerPool.size,
        });
      }
    }
```

with:

```ts
    const wt = this._options.workerThreads;
    if (wt) {
      const poolOpts = typeof wt === "object" ? wt : {};
      this._workerPool = createWorkerPool(poolOpts);
      if (this._workerPool) {
        this._logger?.info?.("Worker thread pool initialized", {
          poolSize: this._workerPool.size,
        });
      } else {
        this._logger?.warn?.(
          "workerThreads was requested but the worker pool could not be created — falling back to main-thread parsing",
        );
      }
    }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run test/worker-pool.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Verify the build ships the worker**

Run: `npx tsup && node -e "require('node:fs').accessSync('dist/parse-worker.cjs'); console.log('worker shipped OK')"`
Expected: `worker shipped OK`

- [ ] **Step 10: Full suite + commit**

Run: `npx vitest run` — Expected: all pass (788 + 4 new).

```bash
git add -A
git commit -m "fix(worker-pool): ship parse-worker.cjs in dist and decode Uint8Array frames"
```

---

### Task 2: C2 — OCPP 2.1 strict-mode schema ID normalization

`ocpp2_1.json` registers `urn:<Method>Request`/`urn:<Method>Response`, but lookups use `urn:<Method>.req`/`.conf` — so 2.1 strict mode validates nothing. Normalize IDs at `Validator` construction.

**Files:**
- Modify: `src/validator.ts:94-103`
- Test: `test/validator.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/validator.test.ts`:

```ts
import { getStandardValidators } from "../src/standard-validators.js";

describe("OCPP 2.1 schema ID normalization (C2)", () => {
  test("resolves urn:<Method>.req for 2.1 Request/Response-style ids", () => {
    const v21 = getStandardValidators().find((v) => v.subprotocol === "ocpp2.1")!;
    expect(v21.hasSchema("urn:BootNotification.req")).toBe(true);
    expect(v21.hasSchema("urn:BootNotification.conf")).toBe(true);
  });

  test("2.1 strict validation actually rejects invalid payloads", () => {
    const v21 = getStandardValidators().find((v) => v.subprotocol === "ocpp2.1")!;
    // BootNotificationRequest requires `reason` and `chargingStation`
    expect(() => v21.validate("urn:BootNotification.req", {})).toThrow();
    expect(() =>
      v21.validate("urn:BootNotification.req", {
        reason: "PowerUp",
        chargingStation: { model: "M1", vendorName: "V1" },
      }),
    ).not.toThrow();
  });
});
```

(Add the `getStandardValidators` import at the top of the file if not present.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/validator.test.ts`
Expected: FAIL — `hasSchema("urn:BootNotification.req")` is `false` for 2.1.

- [ ] **Step 3: Implement** — in `src/validator.ts`, replace the constructor schema loop:

```ts
    for (const schema of schemas) {
      const normalized = { ...schema };
      if (
        typeof normalized.$id === "string" &&
        normalized.$id.startsWith("urn:")
      ) {
        normalized.$id = normalized.$id.replace("urn:", "urn/");
      }
      this._ajv.addSchema(normalized);
    }
```

with:

```ts
    for (const schema of schemas) {
      const normalized = { ...schema };
      if (typeof normalized.$id === "string") {
        // OCPP 2.1 schemas use `urn:<Method>Request` / `urn:<Method>Response`
        // ids while lookups are `urn:<Method>.req` / `urn:<Method>.conf`
        // (the 1.6 / 2.0.1 convention). Normalize so all versions resolve.
        const m = normalized.$id.match(/^urn:(.+?)(Request|Response)$/);
        if (m) {
          normalized.$id = `urn:${m[1]}.${m[2] === "Request" ? "req" : "conf"}`;
        }
        if (normalized.$id.startsWith("urn:")) {
          normalized.$id = normalized.$id.replace("urn:", "urn/");
        }
      }
      this._ajv.addSchema(normalized);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/validator.test.ts` — Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npx vitest run` — Expected: all green.

```bash
git add src/validator.ts test/validator.test.ts
git commit -m "fix(validator): normalize OCPP 2.1 Request/Response schema ids so strict mode works"
```

---

### Task 3: C3 — Presence heartbeat (refresh TTL while clients are connected)

Presence is set once with a 300s TTL and never refreshed; chargers connected >5 min vanish from the cluster registry. Add a refresh interval + `presenceTtlSeconds` server option.

**Files:**
- Modify: `src/types.ts` (ServerOptions)
- Modify: `src/server.ts` (option use, refresh interval, close cleanup)
- Test: `test/presence-refresh.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/presence-refresh.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

class SpyAdapter extends InMemoryAdapter {
  setPresenceBatch = vi.fn(async () => {});
}

describe("presence heartbeat (C3)", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close({ force: true }).catch(() => {});
  });

  test("refreshes presence TTL periodically for connected clients", async () => {
    const adapter = new SpyAdapter();
    server = new OCPPServer({ presenceTtlSeconds: 1 }); // refresh every ~500ms
    await server.setAdapter(adapter);
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    client = new OCPPClient({
      identity: "CP-PRESENCE",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    await client.connect();

    await new Promise((r) => setTimeout(r, 1300));

    expect(adapter.setPresenceBatch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = adapter.setPresenceBatch.mock.calls.at(-1)![0] as Array<{
      identity: string;
      ttl?: number;
    }>;
    expect(lastCall[0].identity).toBe("CP-PRESENCE");
    expect(lastCall[0].ttl).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/presence-refresh.test.ts`
Expected: FAIL — `presenceTtlSeconds` not a valid option / `setPresenceBatch` never called.

- [ ] **Step 3: Add the option to `ServerOptions`** in `src/types.ts` (next to `sessionTtlMs`):

```ts
  /**
   * TTL (seconds) for cluster presence registry entries, and the basis for
   * the automatic presence heartbeat (refreshed every ttl/2 while clients
   * are connected). Default: 300.
   */
  presenceTtlSeconds?: number;
```

- [ ] **Step 4: Implement in `src/server.ts`**

4a. Add a field near `_telemetryInterval`:

```ts
  private _presenceInterval: ReturnType<typeof setInterval> | null = null;
```

4b. In `setAdapter()`, after the two `subscribe` calls, add:

```ts
    // Presence heartbeat — refresh TTLs so long-lived connections never
    // expire out of the cluster registry (report C3).
    this._startPresenceRefresh();
```

4c. Add the two methods after `setAdapter()`:

```ts
  private _startPresenceRefresh(): void {
    if (this._presenceInterval || !this._adapter?.setPresence) return;
    const ttlSec = this._options.presenceTtlSeconds ?? 300;
    const intervalMs = Math.max(250, (ttlSec * 1000) / 2);
    this._presenceInterval = setInterval(() => {
      this._refreshPresence(ttlSec).catch((err) => {
        this._logger?.warn?.("Presence refresh failed", { error: err });
      });
    }, intervalMs);
    this._presenceInterval.unref();
  }

  private async _refreshPresence(ttlSec: number): Promise<void> {
    const adapter = this._adapter;
    if (!adapter) return;
    const identities = Array.from(this._clientsByIdentity.keys());
    if (identities.length === 0) return;
    if (adapter.setPresenceBatch) {
      await adapter.setPresenceBatch(
        identities.map((identity) => ({
          identity,
          nodeId: this._nodeId,
          ttl: ttlSec,
        })),
      );
    } else if (adapter.setPresence) {
      await Promise.all(
        identities.map((identity) =>
          adapter.setPresence!(identity, this._nodeId, ttlSec),
        ),
      );
    }
  }
```

4d. In `_handleUpgrade`, replace the one-shot presence registration block (the one with the long "Phase 1" comment) with:

```ts
      // Register presence (TTL refreshed by the presence heartbeat — see
      // _startPresenceRefresh).
      if (this._adapter?.setPresence) {
        const ttlSec = this._options.presenceTtlSeconds ?? 300;
        this._adapter
          .setPresence(identity, this._nodeId, ttlSec)
          .catch((err) => {
            this._logger?.error?.("Error setting presence", {
              identity,
              error: err,
            });
          });
      }
```

4e. In `close()`, next to the `_telemetryInterval` cleanup, add:

```ts
    if (this._presenceInterval) {
      clearInterval(this._presenceInterval);
      this._presenceInterval = null;
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/presence-refresh.test.ts` — Expected: PASS.

- [ ] **Step 6: Full suite + commit**

Run: `npx vitest run` — Expected: all green.

```bash
git add src/types.ts src/server.ts test/presence-refresh.test.ts
git commit -m "fix(cluster): heartbeat presence TTL so long-lived connections stay routable"
```

---

## Phase 2 — High-Severity Fixes (core client/server)

### Task 4: Visibility refactor — make base-class internals `protected`, add `bufferedAmount` getter

Prerequisite for later tasks: removes the `@ts-expect-error` private-access hacks in `server-client.ts` and `server.ts`.

**Files:**
- Modify: `src/client.ts` (member visibility, new getter)
- Modify: `src/server-client.ts` (drop `@ts-expect-error` comments)
- Modify: `src/server.ts:1466-1489` (drain loop uses the getter)
- Test: covered by the existing suite (behavior unchanged)

- [ ] **Step 1: In `src/client.ts` change visibility** of these members from `private` to `protected`:
  - `private _pongTimer` → `protected _pongTimer`
  - `private _startPing()` → `protected _startPing()`
  - `private _recordActivity()` → `protected _recordActivity()`
  - `private _onClose(` → `protected _onClose(`

- [ ] **Step 2: Add a public getter in `src/client.ts`** (next to the other getters):

```ts
  /**
   * Bytes currently queued in the underlying WebSocket send buffer
   * (0 when disconnected). Useful for backpressure monitoring and drain checks.
   */
  get bufferedAmount(): number {
    return this._ws?.bufferedAmount ?? 0;
  }
```

- [ ] **Step 3: In `src/server-client.ts` remove every `// @ts-expect-error` comment** that guards calls to `_recordActivity()`, `_onClose(...)`, `_pongTimer`, and `_startPing()` (lines 59-60, 152-153, 222-224, 238-252). The calls themselves stay; only the suppression comments go. TypeScript must compile cleanly (an unnecessary `@ts-expect-error` is itself an error).

- [ ] **Step 4: In `src/server.ts` close() drain loop**, replace the block that reads `client._ws` via `@ts-expect-error`:

```ts
      const drainPromises = Array.from(this._clients).map(async (client) => {
        if (client.bufferedAmount > 0) {
          this._logger?.debug?.("Waiting for client buffer to drain", {
            identity: client.identity,
            bufferedAmount: client.bufferedAmount,
          });
          await new Promise<void>((resolve) => {
            let elapsed = 0;
            const check = setInterval(() => {
              elapsed += 50;
              if (client.bufferedAmount === 0 || elapsed >= drainTimeout) {
                clearInterval(check);
                resolve();
              }
            }, 50);
          });
        }
      });
```

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run` — Expected: all green (pure refactor).

```bash
git add src/client.ts src/server-client.ts src/server.ts
git commit -m "refactor: protected base-class internals + public bufferedAmount getter (drop ts-expect-error)"
```

---

### Task 5: H8 — Remove abort listeners when calls settle (node + browser clients)

**Files:**
- Modify: `src/client.ts` (`PendingCall`, `_sendCall`, `_handleCallResult`, `_handleCallError`, `_rejectPendingCalls`)
- Modify: `src/browser/client.ts` (same paths)
- Test: `test/abort-listener-leak.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/abort-listener-leak.test.ts`:

```ts
import { getEventListeners } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

describe("abort listener cleanup (H8)", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close({ force: true }).catch(() => {});
  });

  test("listeners are removed from a shared signal when calls resolve", async () => {
    server = new OCPPServer({});
    server.on("client", (c) => c.handle("Echo", ({ params }) => params));
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    client = new OCPPClient({
      identity: "CP-ABORT",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    await client.connect();

    const ac = new AbortController();
    for (let i = 0; i < 5; i++) {
      await client.call("Echo", { i }, { signal: ac.signal });
    }
    expect(getEventListeners(ac.signal, "abort").length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/abort-listener-leak.test.ts`
Expected: FAIL — 5 listeners still attached.

- [ ] **Step 3: Implement in `src/client.ts`**

3a. Replace the `PendingCall` interface field `abortHandler?: () => void;` with:

```ts
  /** Detaches the abort listener from options.signal (if one was attached). */
  removeAbortListener?: () => void;
```

3b. In `_sendCall`, replace the promise body's timeout/abort wiring (from `const timeoutHandle = setTimeout(...)` through `this._pendingCalls.set(msgId, {...})`) with:

```ts
        let removeAbortListener: (() => void) | undefined;

        const timeoutHandle = setTimeout(() => {
          removeAbortListener?.();
          this._pendingCalls.delete(msgId);
          reject(
            new TimeoutError(
              `Call to "${ctxvals.method}" timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);

        const abortHandler = () => {
          clearTimeout(timeoutHandle);
          this._pendingCalls.delete(msgId);
          reject(options.signal?.reason ?? new Error("Aborted"));
        };

        if (options.signal) {
          options.signal.addEventListener("abort", abortHandler, {
            once: true,
          });
          removeAbortListener = () =>
            options.signal?.removeEventListener("abort", abortHandler);
        }

        this._pendingCalls.set(msgId, {
          resolve,
          reject,
          timeoutHandle,
          removeAbortListener,
          method: ctxvals.method,
          sentAt: Date.now(),
        });
```

3c. In the send-failure callback of `_safeSend` inside `_sendCall` (the `if (err)` branch), add `removeAbortListener?.();` before `reject(err);` — and in the final `else` branch (socket not open) add `removeAbortListener?.();` before `reject(...)`.

3d. In `_handleCallResult`, replace:

```ts
      clearTimeout(pendingCtx.timeoutHandle);
      if (pendingCtx.abortHandler) {
        // Remove abort listener if bound
      }
      this._pendingCalls.delete(ctxvals.messageId);
```

with:

```ts
      clearTimeout(pendingCtx.timeoutHandle);
      pendingCtx.removeAbortListener?.();
      this._pendingCalls.delete(ctxvals.messageId);
```

3e. In `_handleCallError`, after `clearTimeout(pendingCtx.timeoutHandle);` add `pendingCtx.removeAbortListener?.();`

3f. In `_rejectPendingCalls`, inside the loop after `clearTimeout(pending.timeoutHandle);` add `pending.removeAbortListener?.();`

- [ ] **Step 4: Mirror in `src/browser/client.ts`**

4a. In its `PendingCall` interface, replace `abortHandler?: () => void;` with `removeAbortListener?: () => void;`

4b. In its `_sendCall` abort wiring, replace `pending.abortHandler = abortHandler;` with:

```ts
          pending.removeAbortListener = () =>
            options.signal?.removeEventListener("abort", abortHandler);
```

4c. In its `_handleCallResult` and `_handleCallError`, after each `clearTimeout(pending.timeoutHandle);` add `pending.removeAbortListener?.();`

4d. In its `_rejectPendingCalls` loop, after `clearTimeout(pending.timeoutHandle);` add `pending.removeAbortListener?.();`

- [ ] **Step 5: Run to verify + commit**

Run: `npx vitest run test/abort-listener-leak.test.ts` then `npx vitest run` — Expected: all green.

```bash
git add src/client.ts src/browser/client.ts test/abort-listener-leak.test.ts
git commit -m "fix(client): detach AbortSignal listeners when calls settle (leak)"
```

---

### Task 6: H2 — Reject (don't strand) calls dropped from a full offline queue

**Files:**
- Modify: `src/client.ts:716-727`
- Test: `test/offline-queue-overflow.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/offline-queue-overflow.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { OCPPClient } from "../src/client.js";

describe("offline queue overflow (H2)", () => {
  test("oldest queued call is rejected, not stranded", async () => {
    const client = new OCPPClient({
      identity: "CP-OQ",
      endpoint: "ws://127.0.0.1:1",
      reconnect: false,
      offlineQueue: true,
      offlineQueueMaxSize: 1,
    });

    const p1 = client.call("First", {});
    const p2 = client.call("Second", {}); // overflows, drops p1
    p2.catch(() => {}); // stays pending; silence any later rejection

    await expect(p1).rejects.toThrow(/overflow/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/offline-queue-overflow.test.ts` — Expected: timeout/FAIL (p1 never settles).

- [ ] **Step 3: Implement** — in `src/client.ts`, replace:

```ts
          if (this._offlineQueue.length >= maxSize) {
            this._offlineQueue.shift(); // Drop oldest
            this._logger?.warn?.(
              "Offline queue full — dropping oldest message",
              {
                method,
                queueSize: this._offlineQueue.length,
              },
            );
          }
```

with:

```ts
          if (this._offlineQueue.length >= maxSize) {
            const dropped = this._offlineQueue.shift(); // Drop oldest
            dropped?.reject(
              new Error("Offline queue overflow — oldest queued call dropped"),
            );
            this._logger?.warn?.(
              "Offline queue full — dropping oldest message",
              {
                method,
                queueSize: this._offlineQueue.length,
              },
            );
          }
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run test/offline-queue-overflow.test.ts && npx vitest run` — Expected: green.

```bash
git add src/client.ts test/offline-queue-overflow.test.ts
git commit -m "fix(client): reject calls evicted from a full offline queue"
```

---

### Task 7: H6 — Per-connection ordered inbound pipeline

Async plugin hooks / worker parsing currently let messages dispatch out of order. Serialize per-connection pre-processing with a promise chain.

**Files:**
- Modify: `src/server-client.ts:150-220`
- Test: `test/message-ordering.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/message-ordering.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

describe("inbound message ordering (H6)", () => {
  let server: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await server?.close({ force: true }).catch(() => {});
  });

  test("a slow async onBeforeReceive does not reorder messages", async () => {
    const received: string[] = [];
    let delayed = false;

    server = new OCPPServer({});
    server.plugin({
      name: "slow-first",
      async onBeforeReceive() {
        if (!delayed) {
          delayed = true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return undefined;
      },
    });
    server.on("client", (c) =>
      c.handle((method) => {
        received.push(method);
        return {};
      }),
    );

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;
    client = new OCPPClient({
      identity: "CP-ORDER",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    await client.connect();

    client.sendRaw(JSON.stringify([2, "m1", "First", {}]));
    client.sendRaw(JSON.stringify([2, "m2", "Second", {}]));

    await new Promise((r) => setTimeout(r, 400));
    expect(received).toEqual(["First", "Second"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/message-ordering.test.ts` — Expected: FAIL with `["Second", "First"]`.

- [ ] **Step 3: Implement in `src/server-client.ts`**

3a. Add a field next to `_rateLimits`:

```ts
  /**
   * Per-connection inbound pipeline. Serializes async pre-processing
   * (plugin onBeforeReceive, rate-limit parse, worker-pool parse) so
   * messages are dispatched in wire order — OCPP transaction semantics
   * depend on it (e.g. StartTransaction before StopTransaction).
   */
  private _inboundChain: Promise<void> = Promise.resolve();
```

3b. In `_attachServerWebsocket`, replace the entire `ws.on("message", async (data: RawData) => { ... });` handler with:

```ts
    ws.on("message", (data: RawData) => {
      this._recordActivity();
      this._inboundChain = this._inboundChain
        .then(() => this._processInboundMessage(data))
        .catch(() => {
          // _processInboundMessage handles its own errors; never break the chain
        });
    });
```

3c. Add the extracted method (same logic as before, but the worker path is awaited):

```ts
  private async _processInboundMessage(data: RawData): Promise<void> {
    // Plugin interception: onBeforeReceive
    for (const p of this._serverPlugins) {
      if (p.onBeforeReceive) {
        try {
          const result = p.onBeforeReceive(this, data);
          if (result instanceof Promise) {
            const res = await result;
            if (res === false) return;
          } else if (result === false) {
            return;
          }
        } catch (_err) {
          // Don't let plugin errors stop message processing
        }
      }
    }

    // Rate Limit Check
    const limits = this._options.rateLimit;
    if (limits) {
      // We need to parse just enough to find the method name if there are method rules
      let method: string | undefined;
      let pData: unknown;

      if (limits.methods) {
        try {
          // JSON.parse accepts a Buffer directly (implicit utf8 toString)
          pData = JSON.parse(data as unknown as string);
          if (Array.isArray(pData) && pData[0] === 2) {
            method = pData[2];
          }
        } catch {
          // Ignore parse errors here, let _onMessage handle bad JSON
        }
      }

      if (!this._checkRateLimit(method)) {
        this._handleRateLimitExceeded(pData || data.toString());
        return;
      }

      // If we parsed for rate limiting, pass the pre-parsed data to avoid double-parse
      if (pData !== undefined) {
        this._onMessage(data, pData);
        return;
      }
    }

    // Worker pool path: off-thread parse (awaited to preserve ordering)
    if (this._workerPool) {
      const raw = typeof data === "string" ? data : (data as Buffer);
      try {
        const result = await this._workerPool.parse(raw);
        this._onMessage(data, result.message);
      } catch {
        // Parse failed — fall through to _onMessage which handles bad JSON
        this._onMessage(data);
      }
      return;
    }

    // Default path: main-thread parse
    this._onMessage(data);
  }
```

(Note: the `this._recordActivity()` that was the first line of the old handler moved into the synchronous `ws.on("message")` callback so activity is recorded at receipt time.)

- [ ] **Step 4: Run + commit**

Run: `npx vitest run test/message-ordering.test.ts && npx vitest run` — Expected: green.

```bash
git add src/server-client.ts test/message-ordering.test.ts
git commit -m "fix(server-client): serialize inbound pre-processing to preserve wire order"
```

---

### Task 8: H4 — GC idle per-IP connection-rate-limit buckets

**Files:**
- Modify: `src/server.ts` (constructor GC interval + new method)
- Test: `test/connection-bucket-gc.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/connection-bucket-gc.test.ts`:

```ts
import { afterEach, describe, expect, test } from "vitest";
import { OCPPServer } from "../src/server.js";

describe("connection bucket GC (H4)", () => {
  let server: OCPPServer;
  afterEach(async () => {
    await server?.close({ force: true }).catch(() => {});
  });

  test("idle buckets are evicted; active buckets are kept", () => {
    server = new OCPPServer({
      connectionRateLimit: { limit: 5, windowMs: 1000 },
    });
    const buckets = (server as any)._connectionBuckets as Map<string, any>;
    buckets.set("1.2.3.4", { tokens: 2, lastRefill: Date.now() - 5000 });
    buckets.set("5.6.7.8", { tokens: 5, lastRefill: Date.now() });

    (server as any)._sweepConnectionBuckets(Date.now());

    expect(buckets.has("1.2.3.4")).toBe(false);
    expect(buckets.has("5.6.7.8")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/connection-bucket-gc.test.ts` — Expected: FAIL (`_sweepConnectionBuckets` is not a function).

- [ ] **Step 3: Implement in `src/server.ts`**

3a. Add the method (near `_updateSessionActivity`):

```ts
  /**
   * Evict per-IP connection buckets that have been idle longer than the
   * rate-limit window. Recreating a bucket grants a full token allowance,
   * which is exactly what a full refill after `windowMs` idle would yield —
   * so eviction is behavior-preserving while bounding memory (report H4).
   */
  private _sweepConnectionBuckets(now: number): void {
    const rl = this._options.connectionRateLimit;
    if (!rl) {
      this._connectionBuckets.clear();
      return;
    }
    for (const [ip, bucket] of this._connectionBuckets) {
      if (now - bucket.lastRefill > rl.windowMs) {
        this._connectionBuckets.delete(ip);
      }
    }
  }
```

3b. In the constructor's `_gcInterval` callback, after the session sweep loop, add:

```ts
      this._sweepConnectionBuckets(now);
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run test/connection-bucket-gc.test.ts && npx vitest run` — Expected: green.

```bash
git add src/server.ts test/connection-bucket-gc.test.ts
git commit -m "fix(server): evict idle per-IP connection rate-limit buckets"
```

---

### Task 9: H5 — `trustProxy` option for forwarded-proto scheme checks

**Files:**
- Modify: `src/types.ts` (CORSOptions)
- Modify: `src/cors.ts:23-35`
- Test: `test/cors.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/cors.test.ts`:

```ts
describe("trustProxy (H5)", () => {
  const plainReq = (headers: Record<string, string>) =>
    ({
      socket: { remoteAddress: "203.0.113.5" },
      headers,
    }) as any;

  test("x-forwarded-proto is ignored by default (spoof attempt blocked)", () => {
    const { allowed } = checkCORS(
      plainReq({ "x-forwarded-proto": "https" }),
      { allowedSchemes: ["wss"] },
    );
    expect(allowed).toBe(false);
  });

  test("x-forwarded-proto is honored when trustProxy is true", () => {
    const { allowed } = checkCORS(
      plainReq({ "x-forwarded-proto": "https" }),
      { allowedSchemes: ["wss"], trustProxy: true },
    );
    expect(allowed).toBe(true);
  });
});
```

(Use the same `checkCORS` import already present in that file.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/cors.test.ts` — Expected: first new test FAILS (header currently always honored).

- [ ] **Step 3: Add to `CORSOptions` in `src/types.ts`:**

```ts
  /**
   * Honor `X-Forwarded-Proto` from a reverse proxy when evaluating
   * `allowedSchemes`. Leave false (default) unless the server is only
   * reachable through a trusted proxy — otherwise clients can spoof the
   * header to bypass wss-only rules.
   */
  trustProxy?: boolean;
```

- [ ] **Step 4: Implement in `src/cors.ts`** — replace the scheme-check block:

```ts
  // 2. Scheme Check
  if (options.allowedSchemes && options.allowedSchemes.length > 0) {
    let scheme = request.socket instanceof TLSSocket ? "wss" : "ws";

    // Only honor proxy headers when explicitly trusted — X-Forwarded-Proto
    // is client-controlled on direct connections (report H5).
    if (options.trustProxy === true) {
      const fwdProto = request.headers["x-forwarded-proto"];
      if (typeof fwdProto === "string") {
        scheme = fwdProto === "https" || fwdProto === "wss" ? "wss" : "ws";
      }
    }

    if (!options.allowedSchemes.includes(scheme as "ws" | "wss")) {
      return { allowed: false, reason: "Protocol scheme not allowed" };
    }
  }
```

- [ ] **Step 5: Run + commit**

Run: `npx vitest run test/cors.test.ts && npx vitest run` — Expected: green. (If an existing test relied on the old spoofable behavior, update it to pass `trustProxy: true` — that is the documented migration.)

```bash
git add src/types.ts src/cors.ts test/cors.test.ts
git commit -m "fix(security): gate x-forwarded-proto behind explicit trustProxy option"
```

---

### Task 10: H7 — Don't hijack or close user-provided HTTP servers

**Files:**
- Modify: `src/server.ts` (`listen()`, `close()`, new ownership tracking fields)
- Test: `test/external-server.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/external-server.test.ts`:

```ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { OCPPServer } from "../src/server.js";

describe("external HTTP server ownership (H7)", () => {
  let app: ReturnType<typeof createServer>;
  let server: OCPPServer;

  afterEach(async () => {
    await server?.close({ force: true }).catch(() => {});
    await new Promise<void>((r) => (app?.listening ? app.close(() => r()) : r()));
  });

  test("app routes still work and the app server survives ocpp close()", async () => {
    app = createServer((req, res) => {
      if (req.url === "/app") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("app-ok");
      }
    });
    await new Promise<void>((r) => app.listen(0, () => r()));
    const port = (app.address() as AddressInfo).port;

    server = new OCPPServer({ healthEndpoint: true });
    await server.listen(0, undefined, { server: app });

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);

    const appRes = await fetch(`http://127.0.0.1:${port}/app`);
    expect(appRes.status).toBe(200);
    expect(await appRes.text()).toBe("app-ok");

    await server.close({ force: true });
    expect(app.listening).toBe(true); // ocpp close must NOT close the app server
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/external-server.test.ts` — Expected: FAIL — `/app` gets 404 (catch-all) and/or `app.listening` is `false` after close.

- [ ] **Step 3: Implement in `src/server.ts`**

3a. Add fields next to `_httpServers`:

```ts
  /** HTTP servers created by listen() — we own their lifecycle. */
  private _ownedHttpServers = new Set<Server>();
  /** Listeners we attached per server, for removal on close(). */
  private _attachedHttpHandlers = new Map<
    Server,
    {
      upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
      request?: (
        req: IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => void;
    }
  >();
```

3b. In `listen()` after `this._httpServers.add(httpServer);` add:

```ts
    const ownsServer = !options?.server;
    if (ownsServer) this._ownedHttpServers.add(httpServer);
```

3c. In the `healthEndpoint` block, replace `httpServer.on("request", async (req, res) => {` with a named handler and an external-server guard. Full replacement of the block's wrapper:

```ts
    let requestHandler:
      | ((req: IncomingMessage, res: import("node:http").ServerResponse) => void)
      | undefined;
    if (this._options.healthEndpoint) {
      requestHandler = async (req, res) => {
        if (res.headersSent || res.writableEnded) return;
        const url = req.url ?? "";

        if (url === "/health") {
          // ... existing /health body unchanged ...
          return;
        }

        if (url === "/metrics") {
          // ... existing /metrics body unchanged ...
          return;
        }

        // Only 404 unknown routes on servers we created. On a user-provided
        // server the application's own handlers must keep working (report H7).
        if (ownsServer) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      };
      httpServer.on("request", requestHandler);
    }
    this._attachedHttpHandlers.set(httpServer, {
      upgrade: upgradeHandler,
      request: requestHandler,
    });
```

(Keep the existing `/health` and `/metrics` response bodies exactly as they are — only the wrapper, the `headersSent` guard, and the `ownsServer` 404 condition change.)

3d. In `close()`, replace the "Close all HTTP servers" block:

```ts
    // Detach our listeners from every server; only close servers we own.
    const serverClosePromises: Promise<void>[] = [];
    for (const srv of this._httpServers) {
      const handlers = this._attachedHttpHandlers.get(srv);
      if (handlers) {
        srv.removeListener("upgrade", handlers.upgrade);
        if (handlers.request) srv.removeListener("request", handlers.request);
      }
      if (this._ownedHttpServers.has(srv)) {
        serverClosePromises.push(
          new Promise<void>((resolve) => {
            srv.close(() => resolve());
          }),
        );
      }
    }
    await Promise.allSettled(serverClosePromises);
    this._httpServers.clear();
    this._ownedHttpServers.clear();
    this._attachedHttpHandlers.clear();
```

3e. Update the `healthEndpoint` JSDoc in `src/types.ts` to add:

```
   * When attaching to a user-provided server (listen(..., { server })),
   * only /health and /metrics are handled; all other routes are left to
   * the application, and close() will not close the external server.
   * Ensure your app does not also write responses for /health or /metrics.
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run test/external-server.test.ts && npx vitest run` — Expected: green.

```bash
git add src/server.ts src/types.ts test/external-server.test.ts
git commit -m "fix(server): respect external HTTP server ownership (no 404 hijack, no close)"
```

---

### Task 11: H1 — Cross-node `sendToClient` response correlation

Remote calls currently publish and return `undefined`. Add a correlation-ID request/response round trip over the node channels.

**Files:**
- Modify: `src/server.ts` (`sendToClient`, `_onUnicast`, new `_pendingRemoteCalls`, `close()`)
- Test: `test/remote-rpc.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/remote-rpc.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

describe("cross-node RPC correlation (H1)", () => {
  let serverA: OCPPServer;
  let serverB: OCPPServer;
  let client: OCPPClient;

  afterEach(async () => {
    await client?.close({ force: true }).catch(() => {});
    await serverA?.close({ force: true }).catch(() => {});
    await serverB?.close({ force: true }).catch(() => {});
  });

  async function setup() {
    const adapter = new InMemoryAdapter();
    serverA = new OCPPServer({});
    await serverA.setAdapter(adapter);
    const http = await serverA.listen(0);
    const port = (http.address() as AddressInfo).port;

    serverB = new OCPPServer({});
    await serverB.setAdapter(adapter);

    client = new OCPPClient({
      identity: "CP-REMOTE",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    return adapter;
  }

  test("returns the remote client's response", async () => {
    await setup();
    client.handle("Reset", () => ({ status: "Accepted" }));
    await client.connect();

    const res = await serverB.sendToClient("CP-REMOTE", "Reset", {
      type: "Soft",
    });
    expect(res).toEqual({ status: "Accepted" });
  });

  test("propagates remote handler errors", async () => {
    await setup();
    client.handle("Reset", () => {
      throw new Error("boom");
    });
    await client.connect();

    await expect(
      serverB.sendToClient("CP-REMOTE", "Reset", { type: "Soft" }),
    ).rejects.toMatchObject({ rpcErrorCode: "InternalError" });
  });

  test("rejects fast when presence points at a node that lacks the client", async () => {
    const adapter = await setup();
    await client.connect();
    // Stale registry: identity points at a live node (A) that doesn't have it
    await adapter.setPresence("GHOST", (serverA as any)._nodeId, 60);

    await expect(
      serverB.sendToClient("GHOST", "Reset", { type: "Soft" }),
    ).rejects.toThrow(/not found/i);
  });

  test("times out when the presence node is dead", async () => {
    const adapter = await setup();
    await client.connect();
    await adapter.setPresence("DEAD", "no-such-node", 60);

    await expect(
      serverB.sendToClient("DEAD", "Reset", { type: "Soft" }, { timeoutMs: 200 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  }, 5000);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/remote-rpc.test.ts` — Expected: FAIL — `sendToClient` resolves `undefined` instead of the response.

- [ ] **Step 3: Implement in `src/server.ts`**

3a. Add import: `TimeoutError` from `./errors.js` and `createRPCError` is already imported from `./util.js` — verify; if not, add it.

3b. Add fields + message types near `_nodeId`:

```ts
  /** Pending cross-node RPC calls awaiting a correlated response. */
  private _pendingRemoteCalls = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /** Extra wait on top of the call timeout to absorb cross-node transit. */
  private static readonly _REMOTE_RESPONSE_GRACE_MS = 1000;
```

3c. In `sendToClient`, replace the registry/unicast block:

```ts
    // 2. Check Registry & Unicast (with response correlation — report H1)
    if (this._adapter?.getPresence) {
      const nodeId = await this._adapter.getPresence(identity);
      if (nodeId) {
        const correlationId = createId();
        const timeoutMs =
          (options?.timeoutMs ?? this._options.callTimeoutMs ?? 30_000) +
          OCPPServer._REMOTE_RESPONSE_GRACE_MS;

        const resultPromise = new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            this._pendingRemoteCalls.delete(correlationId);
            reject(
              new TimeoutError(
                `Remote call to "${identity}" via node ${nodeId} timed out after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
          this._pendingRemoteCalls.set(correlationId, {
            resolve,
            reject,
            timer,
          });
        });

        await this._adapter.publish(`ocpp:node:${nodeId}`, {
          source: this._nodeId,
          target: identity,
          version,
          method,
          params,
          options,
          correlationId,
        });
        return await resultPromise;
      }
    }
```

3d. In `_onUnicast`, first branch on responses, and publish results back. Replace the method body with:

```ts
  private _onUnicast(msg: unknown) {
    try {
      if (!msg || typeof msg !== "object") return;

      // Response leg: a remote node answering one of our calls
      const asResponse = msg as {
        __type?: string;
        correlationId?: string;
        ok?: boolean;
        result?: unknown;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      if (asResponse.__type === "callResult" && asResponse.correlationId) {
        const pending = this._pendingRemoteCalls.get(asResponse.correlationId);
        if (!pending) return; // late or duplicate response
        this._pendingRemoteCalls.delete(asResponse.correlationId);
        clearTimeout(pending.timer);
        if (asResponse.ok) {
          pending.resolve(asResponse.result);
        } else {
          pending.reject(
            createRPCError(
              asResponse.error?.code ?? "GenericError",
              asResponse.error?.message,
              asResponse.error?.details ?? {},
            ),
          );
        }
        return;
      }

      // Request leg: deliver to a locally connected client
      const payload = msg as {
        source: string;
        target: string;
        version?: string;
        method: string;
        params: unknown;
        options?: CallOptions;
        correlationId?: string;
      };

      const client = this._clientsByIdentity.get(payload.target);
      if (client) {
        const delivery = payload.version
          ? client.call(
              payload.version as any,
              payload.method as any,
              payload.params as any,
              payload.options,
            )
          : client.call(payload.method, payload.params as any, payload.options);
        delivery.then(
          (result) => {
            this._publishRemoteResult(payload, { ok: true, result });
          },
          (err) => {
            this._publishRemoteResult(payload, {
              ok: false,
              error: {
                code: (err as any)?.rpcErrorCode ?? "GenericError",
                message: (err as Error)?.message ?? "",
                details: (err as any)?.details ?? {},
              },
            });
            if ((err as Error).name !== "TimeoutError") {
              this._logger?.error?.("Error delivering unicast to client", {
                identity: payload.target,
                error: err,
              });
            }
          },
        );
        return;
      }

      // Unknown target — the registry is stale. Tell the caller immediately
      // instead of letting it time out, and clean up the stale entry.
      this._logger?.warn?.("Received unicast for unknown client", {
        target: payload.target,
      });
      this._publishRemoteResult(payload, {
        ok: false,
        error: {
          code: "GenericError",
          message: `Client ${payload.target} not found on node ${this._nodeId}`,
        },
      });
      if (this._adapter?.removePresence) {
        this._adapter.removePresence(payload.target).catch(() => {});
      }
    } catch (err) {
      this._logger?.error?.("Error processing unicast", {
        error: (err as Error).message,
      });
    }
  }

  /** Publish the result of a remotely requested call back to the origin node. */
  private _publishRemoteResult(
    request: { source?: string; correlationId?: string },
    body: {
      ok: boolean;
      result?: unknown;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    },
  ): void {
    if (!request.correlationId || !request.source || !this._adapter) return;
    this._adapter
      .publish(`ocpp:node:${request.source}`, {
        __type: "callResult",
        correlationId: request.correlationId,
        ...body,
      })
      .catch((err) => {
        this._logger?.error?.("Failed to publish remote call result", {
          error: err,
        });
      });
  }
```

3e. In `close()`, before disconnecting the adapter, add:

```ts
    // Fail any in-flight cross-node calls
    for (const [, pending] of this._pendingRemoteCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Server closing"));
    }
    this._pendingRemoteCalls.clear();
```

3f. Update the duplicated JSDoc above `sendToClient` — delete the first (stale) copy mentioning "Fallback: Broadcast" and keep one accurate comment:

```ts
  /**
   * Send a request to a specific client (local or remote).
   *
   * 1. Local clients are called directly.
   * 2. Otherwise the presence registry routes the call to the owning node,
   *    and the response is correlated back over the adapter (cross-node RPC).
   * 3. Unknown identity → rejects with "Client <identity> not found".
   *
   * Backward compatibility: nodes running older versions deliver the call
   * but never publish a response — such calls reject with TimeoutError.
   */
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run test/remote-rpc.test.ts && npx vitest run test/unicast.test.ts && npx vitest run` — Expected: green.

```bash
git add src/server.ts test/remote-rpc.test.ts
git commit -m "feat(cluster): correlate cross-node sendToClient responses (real remote RPC)"
```

---

### Task 12: H3 — Prune `_presenceCache` on removePresence

**Files:**
- Modify: `src/adapters/redis/index.ts:346-349`
- Test: `test/redis-adapter.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/redis-adapter.test.ts` (self-contained; stub clients satisfy the IoRedisDriver duck-typing used by `createDriver`):

```ts
describe("presence cache pruning (H3)", () => {
  function stubClients() {
    const pub: any = {
      publish: vi.fn(async () => 1),
      set: vi.fn(async () => "OK"),
      get: vi.fn(async () => null),
      del: vi.fn(async () => 1),
      mget: vi.fn(async () => []),
      xadd: vi.fn(async () => "1-1"),
      xlen: vi.fn(async () => 0),
      expire: vi.fn(async () => 1),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const sub: any = {
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(async () => {}),
      on: vi.fn(),
    };
    return { pub, sub };
  }

  test("removePresence deletes the rehydration cache entry", async () => {
    const { pub, sub } = stubClients();
    const adapter = new RedisAdapter({ pubClient: pub, subClient: sub });
    await adapter.setPresence("CP-X", "node-1", 60);
    expect((adapter as any)._presenceCache.has("CP-X")).toBe(true);

    await adapter.removePresence("CP-X");
    expect((adapter as any)._presenceCache.has("CP-X")).toBe(false);
    expect(pub.del).toHaveBeenCalledWith("ocpp-ws-io:presence:CP-X");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/redis-adapter.test.ts` — Expected: new test FAILS (cache entry survives).

- [ ] **Step 3: Implement** — in `src/adapters/redis/index.ts`:

```ts
  async removePresence(identity: string): Promise<void> {
    const key = `${this._prefix}presence:${identity}`;
    // Drop the rehydration cache entry too — otherwise a Redis reconnect
    // resurrects presence for disconnected clients (report H3).
    this._presenceCache.delete(identity);
    await this._driver.del(key);
  }
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run test/redis-adapter.test.ts && npx vitest run` — Expected: green.

```bash
git add src/adapters/redis/index.ts test/redis-adapter.test.ts
git commit -m "fix(redis): prune presence cache on removePresence (no stale resurrection)"
```

---

## Phase 3 — Medium-Severity Fixes

### Task 13: M2 — `RedisAdapter` direct `driver` option + ClusterDriver repairs

**Files:**
- Modify: `src/adapters/redis/index.ts` (options + constructor)
- Modify: `src/adapters/redis/cluster-driver.ts` (constructor error masking, cross-slot setPresenceBatch, honest docs)
- Test: `test/redis-driver.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `test/redis-driver.test.ts`:

```ts
import { RedisAdapter } from "../src/adapters/redis/index.js";
import type { RedisPubSubDriver } from "../src/adapters/redis/helpers.js";

function stubDriver(overrides: Partial<RedisPubSubDriver> = {}): RedisPubSubDriver {
  return {
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    set: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    mget: vi.fn(async () => []),
    del: vi.fn(async () => {}),
    setPresenceBatch: vi.fn(async () => {}),
    expire: vi.fn(async () => {}),
    xadd: vi.fn(async () => "1-1"),
    xaddBatch: vi.fn(async () => {}),
    xread: vi.fn(async () => null),
    xlen: vi.fn(async () => 0),
    ...overrides,
  };
}

describe("RedisAdapter driver option (M2)", () => {
  test("uses a provided driver directly", async () => {
    const driver = stubDriver();
    const adapter = new RedisAdapter({ driver });
    await adapter.publish("ocpp:broadcast", { hello: 1 });
    expect(driver.publish).toHaveBeenCalledWith(
      "ocpp-ws-io:ocpp:broadcast",
      JSON.stringify({ hello: 1 }),
    );
    await adapter.disconnect();
  });

  test("throws without driver or pub/sub clients", () => {
    expect(() => new RedisAdapter({} as any)).toThrow(/driver|pubClient/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/redis-driver.test.ts` — Expected: FAIL (`driver` not an accepted option).

- [ ] **Step 3: Implement in `src/adapters/redis/index.ts`**

3a. In `RedisAdapterOptions`, make the clients optional and add `driver`:

```ts
  /** Redis client for publishing (required unless `driver` is provided) */
  pubClient?: RedisLikeClient;
  /** Redis client for subscribing — must be a separate connection (required unless `driver` is provided) */
  subClient?: RedisLikeClient;
  /**
   * Pre-built driver (e.g. a ClusterDriver) used directly as the primary
   * driver. When set, pubClient/subClient/blockingClient are ignored.
   */
  driver?: RedisPubSubDriver;
```

3b. In the constructor, replace the primary-driver creation:

```ts
    // Primary driver — either user-provided (e.g. ClusterDriver) or built
    // from raw pub/sub clients.
    if (options.driver) {
      this._driver = options.driver;
    } else if (options.pubClient && options.subClient) {
      this._driver = createDriver(
        options.pubClient,
        options.subClient,
        options.blockingClient,
      );
    } else {
      throw new Error(
        "RedisAdapter requires either `driver` or both `pubClient` and `subClient`",
      );
    }
```

- [ ] **Step 4: Repair `src/adapters/redis/cluster-driver.ts`**

4a. Replace the dynamic-require + constructor so only the missing-dependency case is masked:

```ts
import { createRequire } from "node:module";
```

```ts
  constructor(_options: ClusterDriverOptions) {
    // Dynamically require ioredis to avoid bundling it
    let IoRedis: any;
    try {
      const dynamicRequire = createRequire(
        typeof __filename !== "undefined" ? __filename : import.meta.url,
      );
      IoRedis = dynamicRequire("ioredis");
    } catch {
      throw new Error(
        "ClusterDriver requires 'ioredis' as a peer dependency. Install it with: npm i ioredis",
      );
    }

    const redisOpts = _options.redisOptions ?? {};
    if (_options.natMap) {
      (redisOpts as any).natMap = _options.natMap;
    }

    // Construction errors (bad nodes, auth, etc.) now propagate as-is
    this._cluster = new IoRedis.Cluster(
      _options.nodes.map((n) => ({ host: n.host, port: n.port })),
      { redisOptions: redisOpts },
    );
    this._subscriber = new IoRedis.Cluster(
      _options.nodes.map((n) => ({ host: n.host, port: n.port })),
      { redisOptions: redisOpts },
    );

    this._subscriber.on("message", (channel: string, message: string) => {
      const handler = this._handlers.get(channel);
      if (handler) handler(message);
    });
  }
```

4b. Replace `setPresenceBatch` (cluster pipelines cannot span slots):

```ts
  async setPresenceBatch(
    entries: { key: string; value: string; ttlSeconds: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    // Redis Cluster pipelines cannot span hash slots — issue per-key SETs
    // and let the cluster client route each one (report M2).
    await Promise.all(
      entries.map(({ key, value, ttlSeconds }) =>
        this._cluster.set(key, value, "EX", ttlSeconds),
      ),
    );
  }
```

4c. Fix the class JSDoc: delete the "Hash-tag strategy" paragraph (no hash tags are generated) and replace the `@example` with the now-working construction:

```ts
 * @example
 * ```ts
 * const driver = new ClusterDriver({
 *   nodes: [{ host: '10.0.0.1', port: 6379 }, { host: '10.0.0.2', port: 6379 }],
 * });
 * const adapter = new RedisAdapter({ driver });
 * ```
```

- [ ] **Step 5: Run + commit**

Run: `npx vitest run test/redis-driver.test.ts && npx vitest run` — Expected: green.

```bash
git add src/adapters/redis/index.ts src/adapters/redis/cluster-driver.ts test/redis-driver.test.ts
git commit -m "fix(redis): direct driver option, honest ClusterDriver errors, cross-slot-safe presence batch"
```

---

### Task 14: M1 — Never issue blocking XREAD on the shared pub connection

**Files:**
- Modify: `src/adapters/redis/helpers.ts` (interface + both drivers)
- Modify: `src/adapters/redis/cluster-driver.ts` (flag)
- Modify: `src/adapters/redis/index.ts` (`_pollLoop`)
- Test: `test/redis-driver.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/redis-driver.test.ts` (reuses `stubDriver` from Task 13):

```ts
describe("non-blocking poll fallback (M1)", () => {
  test("polls without BLOCK when the driver has no blocking client", async () => {
    const driver = stubDriver(); // hasBlockingClient undefined → no blocking
    const adapter = new RedisAdapter({ driver });
    await adapter.subscribe("ocpp:node:n1", () => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(driver.xread).toHaveBeenCalled();
    const lastArgs = (driver.xread as any).mock.calls.at(-1);
    expect(lastArgs[2]).toBeUndefined(); // no BLOCK
    await adapter.disconnect();
  });

  test("polls with BLOCK 1000 when a blocking client exists", async () => {
    const driver = stubDriver({ hasBlockingClient: true } as any);
    const adapter = new RedisAdapter({ driver });
    await adapter.subscribe("ocpp:node:n2", () => {});
    await new Promise((r) => setTimeout(r, 50));
    const lastArgs = (driver.xread as any).mock.calls.at(-1);
    expect(lastArgs[2]).toBe(1000);
    await adapter.disconnect();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/redis-driver.test.ts` — Expected: first test FAILS (block is always 1000).

- [ ] **Step 3: Implement**

3a. In `helpers.ts` `RedisPubSubDriver` interface, add:

```ts
  /**
   * True when the driver has a dedicated connection for blocking XREAD.
   * Without it, BLOCK would head-of-line-block every other command on the
   * shared connection, so the adapter falls back to non-blocking polls.
   */
  readonly hasBlockingClient?: boolean;
```

3b. In `IoRedisDriver` and `NodeRedisDriver`, add:

```ts
  get hasBlockingClient(): boolean {
    return !!this.blocking;
  }
```

3c. In `ClusterDriver`, add the field:

```ts
  readonly hasBlockingClient = false;
```

3d. In `src/adapters/redis/index.ts` `_pollLoop`, replace the try/catch xread section:

```ts
      const canBlock = this._driver.hasBlockingClient === true;
      try {
        // With a dedicated blocking connection, BLOCK 1s for low latency.
        // Otherwise poll non-blocking and sleep, so the shared connection
        // never stalls publishes/presence ops (report M1).
        const entries = await this._driver.xread(
          streamsArg,
          undefined,
          canBlock ? 1000 : undefined,
        );

        if (entries) {
          for (const entry of entries) {
            const channel = entry.stream.replace(this._prefix, "");
            for (const msg of entry.messages) {
              this._streamOffsets.set(entry.stream, msg.id);
              const messageContent = msg.data.message;
              if (messageContent) {
                this._handleMessage(channel, messageContent);
              }
            }
          }
        } else if (!canBlock) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (_err) {
        // Avoid tight loop on error
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run test/redis-driver.test.ts && npx vitest run` — Expected: green.

```bash
git add src/adapters/redis/helpers.ts src/adapters/redis/cluster-driver.ts src/adapters/redis/index.ts test/redis-driver.test.ts
git commit -m "fix(redis): non-blocking stream polls when no dedicated blocking client"
```

---

### Task 15: M3 + M5 — Remove dead `__seq` counters (payload mutation) and fix the lag-metric claim

**Files:**
- Modify: `src/adapters/redis/index.ts` (publish, disconnect, metrics comment, remove `_sequenceCounters`)
- Test: `test/redis-driver.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/redis-driver.test.ts`:

```ts
describe("publish does not mutate payloads (M3)", () => {
  test("no __seq is injected into unicast payloads", async () => {
    const driver = stubDriver();
    const adapter = new RedisAdapter({ driver });
    const payload = { source: "n1", target: "CP-1", method: "Reset", params: {} };
    await adapter.publish("ocpp:node:abc", payload);
    expect("__seq" in payload).toBe(false);
    const xaddArgs = (driver.xadd as any).mock.calls[0];
    expect(JSON.parse(xaddArgs[1].message)).not.toHaveProperty("__seq");
    await adapter.disconnect();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (`__seq` present).

- [ ] **Step 3: Implement** — in `src/adapters/redis/index.ts`:
  - Delete the `// Per-stream sequence counter...` field `_sequenceCounters` and its `disconnect()` clear line.
  - In `publish()`, delete the entire "Attach sequence ID to unicast messages for ordering" block (the `payload`/`__seq` mutation). `const message = JSON.stringify(data);` stays.
  - In `metrics()`, replace the comment `// Since we use MAXLEN for trimming, XLEN directly equals pending unread messages` with:

```ts
    // NOTE: XLEN counts all retained entries, including ones already
    // consumed but not yet trimmed by MAXLEN — treat this as an upper-bound
    // approximation of backlog, not an exact unread count (report M5).
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run test/redis-driver.test.ts && npx vitest run` — Expected: green.

```bash
git add src/adapters/redis/index.ts test/redis-driver.test.ts
git commit -m "fix(redis): drop dead __seq payload mutation; document XLEN approximation"
```

---

### Task 16: M4 — Preserve stream offsets across unsubscribe/resubscribe

**Files:**
- Modify: `src/adapters/redis/index.ts` (`subscribe`, `unsubscribe`)
- Test: `test/redis-driver.test.ts` (append)

- [ ] **Step 1: Write the failing test:**

```ts
describe("stream offset preservation (M4)", () => {
  test("re-subscribe resumes after the last consumed id (no replay)", async () => {
    const driver = stubDriver();
    const adapter = new RedisAdapter({ driver });
    await adapter.subscribe("ocpp:node:n3", () => {});
    const offsets = (adapter as any)._streamOffsets as Map<string, string>;
    const key = "ocpp-ws-io:ocpp:node:n3";
    offsets.set(key, "42-1"); // simulate consumed messages

    await adapter.unsubscribe("ocpp:node:n3");
    await adapter.subscribe("ocpp:node:n3", () => {});

    expect(offsets.get(key)).toBe("42-1"); // not reset to "0"
    await adapter.disconnect();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (offset reset to `"0"`).

- [ ] **Step 3: Implement** — in `src/adapters/redis/index.ts`:

In `subscribe()`, replace `this._streamOffsets.set(prefixedChannel, "0");` with:

```ts
          // Fresh stream → start from "0" (a brand-new nodeId stream is
          // empty, so this replays nothing). Re-subscribes keep their last
          // consumed id to avoid replaying retained entries (report M4).
          if (!this._streamOffsets.has(prefixedChannel)) {
            this._streamOffsets.set(prefixedChannel, "0");
          }
```

In `unsubscribe()`, delete `this._streamOffsets.delete(prefixedChannel); // Cleanup offset` and add the comment:

```ts
      // Offsets are intentionally kept so a later re-subscribe resumes
      // where it left off instead of replaying from "0".
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/redis-driver.test.ts && npx vitest run`

```bash
git add src/adapters/redis/index.ts test/redis-driver.test.ts
git commit -m "fix(redis): keep stream offsets across resubscribe (no unicast replay)"
```

---

### Task 17: M6 — Validate inbound CALLRESULT payloads in strict mode

**Files:**
- Modify: `src/client.ts` (`_handleCallResult`)
- Test: `test/validation-inbound.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/validation-inbound.test.ts` (follow that file's existing server/client setup pattern):

```ts
describe("inbound CALLRESULT validation (M6)", () => {
  test("strict client rejects a malformed response payload", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6"] });
    server.on("client", (c) =>
      c.handle("Heartbeat", () => ({ currentTime: 12345 }) as any),
    );
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const client = new OCPPClient({
      identity: "CP-CONF",
      endpoint: `ws://127.0.0.1:${port}`,
      protocols: ["ocpp1.6"],
      strictMode: true,
      reconnect: false,
    });
    await client.connect();

    await expect(client.call("Heartbeat", {})).rejects.toMatchObject({
      rpcErrorCode: "TypeConstraintViolation",
    });

    await client.close({ force: true });
    await server.close({ force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (call resolves with the bad payload).

- [ ] **Step 3: Implement** — in `src/client.ts` `_handleCallResult`, inside the middleware runner, after the latency calculation + message-event emit and **before** `clearTimeout(pendingCtx.timeoutHandle);`, add:

```ts
      // Strict mode: validate the inbound response payload against the
      // method's .conf schema (report M6).
      if (this._options.strictMode && this._protocol) {
        try {
          this._validateInbound(pendingCtx.method, ctxvals.payload, "conf");
        } catch (err) {
          clearTimeout(pendingCtx.timeoutHandle);
          pendingCtx.removeAbortListener?.();
          this._pendingCalls.delete(ctxvals.messageId);
          pendingCtx.reject(err);
          return;
        }
      }
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/validation-inbound.test.ts && npx vitest run`

```bash
git add src/client.ts test/validation-inbound.test.ts
git commit -m "fix(client): validate inbound CALLRESULT payloads in strict mode"
```

---

### Task 18: M7 — Protocol-correct `FormationViolation` for OCPP 1.6

**Files:**
- Modify: `src/validator.ts` (`validate`)
- Modify: `src/client.ts` (`_onBadMessage`)
- Modify: `src/browser/client.ts` (`_onBadMessage`)
- Test: `test/validator.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/validator.test.ts`:

```ts
describe("protocol-aware error codes (M7)", () => {
  test("1.6 format violations use FormationViolation", () => {
    const v16 = getStandardValidators().find((v) => v.subprotocol === "ocpp1.6")!;
    try {
      // chargePointVendor maxLength 20 → FORMAT violation keyword
      v16.validate("urn:BootNotification.req", {
        chargePointVendor: "X".repeat(50),
        chargePointModel: "M",
      });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.rpcErrorCode).toBe("FormationViolation");
    }
  });

  test("2.0.1 format violations keep FormatViolation", () => {
    const v201 = getStandardValidators().find(
      (v) => v.subprotocol === "ocpp2.0.1",
    )!;
    try {
      v201.validate("urn:BootNotification.req", {
        reason: "NotARealReason",
        chargingStation: { model: "M", vendorName: "V" },
      });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(["FormatViolation", "PropertyConstraintViolation"]).toContain(
        err.rpcErrorCode,
      );
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: first test FAILS with `FormatViolation`.

- [ ] **Step 3: Implement**

3a. In `src/validator.ts` `validate()`, replace:

```ts
      const ocppErrorCode = keywordToOCPPError(primaryError.keyword);
```

with:

```ts
      let ocppErrorCode = keywordToOCPPError(primaryError.keyword);
      // OCPP 1.6J names this error "FormationViolation"; 2.0.1+ renamed it
      // to "FormatViolation" (report M7).
      if (
        ocppErrorCode === "FormatViolation" &&
        this.subprotocol.startsWith("ocpp1.6")
      ) {
        ocppErrorCode = "FormationViolation";
      }
```

3b. In `src/client.ts` `_onBadMessage`, replace the hardcoded `"FormatViolation"` element with a protocol-aware constant — before building `errorResponse`, add:

```ts
    const formatCode =
      this._protocol === "ocpp1.6" ? "FormationViolation" : "FormatViolation";
```

and use `formatCode` in the `errorResponse` tuple.

3c. Same change in `src/browser/client.ts` `_onBadMessage`.

- [ ] **Step 4: Run + commit** — `npx vitest run test/validator.test.ts && npx vitest run`

```bash
git add src/validator.ts src/client.ts src/browser/client.ts test/validator.test.ts
git commit -m "fix(spec): emit FormationViolation on ocpp1.6, FormatViolation on 2.x"
```

---

### Task 19: M8 — `createValidator` must not silently ignore custom schemas

**Files:**
- Modify: `src/validator.ts` (remove global registry from `createValidator`)
- Test: `test/validator.test.ts` (append)

- [ ] **Step 1: Write the failing test:**

```ts
describe("createValidator custom schemas (M8)", () => {
  test("custom schemas are not shadowed by the standard registry", () => {
    getStandardValidators(); // ensure standard ocpp1.6 validator exists first
    const custom = createValidator("ocpp1.6", [
      {
        $id: "urn:MyCustom.req",
        type: "object",
        properties: { x: { type: "number" } },
        required: ["x"],
      },
    ]);
    expect(custom.hasSchema("urn:MyCustom.req")).toBe(true);
    expect(() => custom.validate("urn:MyCustom.req", {})).toThrow();
  });

  test("getStandardValidators still returns cached instances", () => {
    expect(getStandardValidators()[0]).toBe(getStandardValidators()[0]);
  });
});
```

(Import `createValidator` from `../src/validator.js` at the top if missing.)

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (`hasSchema("urn:MyCustom.req")` is `false` — standard validator returned).

- [ ] **Step 3: Implement** — in `src/validator.ts`, delete the `_validatorRegistry` map and replace `createValidator` with:

```ts
/**
 * Create a validator for a specific subprotocol version.
 *
 * Always returns a fresh instance so custom schema sets are never shadowed
 * by previously created validators for the same subprotocol (report M8).
 * Standard validators are cached separately by getStandardValidators().
 */
export function createValidator(
  subprotocol: string,
  schemas: ValidatorSchema[],
): Validator {
  return new Validator(subprotocol, schemas);
}
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/validator.test.ts && npx vitest run`

```bash
git add src/validator.ts test/validator.test.ts
git commit -m "fix(validator): createValidator no longer shadows custom schemas via global cache"
```

---

### Task 20: M9 — `sendBatch` without mutating shared client concurrency

**Files:**
- Modify: `src/client.ts` (new `callImmediate`)
- Modify: `src/server.ts` (`sendBatch`)
- Test: `test/send-batch.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/send-batch.test.ts` (self-contained fixture):

```ts
describe("sendBatch concurrency isolation (M9)", () => {
  test("does not reconfigure the client's callConcurrency", async () => {
    const server = new OCPPServer({ callConcurrency: 1 });
    server.on("client", (c) =>
      c.handle("GetConfiguration", () => ({ configurationKey: [] })),
    );
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const station = new OCPPClient({
      identity: "CP-BATCH",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    station.handle("GetConfiguration", () => ({ configurationKey: [] }));
    await station.connect();
    await new Promise((r) => setTimeout(r, 50));

    const serverClient = server.getLocalClient("CP-BATCH")!;
    const spy = vi.spyOn(serverClient, "reconfigure");

    const results = await server.sendBatch("CP-BATCH", [
      { method: "GetConfiguration", params: {} },
      { method: "GetConfiguration", params: {} },
      { method: "GetConfiguration", params: {} },
    ]);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r !== undefined)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(serverClient.options.callConcurrency).toBe(1);

    await station.close({ force: true });
    await server.close({ force: true });
  });
});
```

(Reuse the file's existing `OCPPServer`/`OCPPClient`/`AddressInfo`/`vi` imports; add any that are missing.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/send-batch.test.ts`
Expected: FAIL — `reconfigure` is called twice by the current implementation.

- [ ] **Step 3: Implement**

3a. In `src/client.ts`, add next to `call()`:

```ts
  /**
   * Execute a call immediately, bypassing the callConcurrency queue.
   * Used by OCPPServer.sendBatch to pipeline warm-up calls without
   * mutating the client's configured concurrency (report M9).
   */
  callImmediate<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<TResult> {
    if (this._state !== OPEN) {
      return Promise.reject(
        new Error(`Cannot call: client is in state ${this._state}`),
      );
    }
    return this._sendCall(method, params ?? {}, options ?? {}) as Promise<TResult>;
  }
```

3b. In `src/server.ts` `sendBatch`, delete the concurrency juggling (`originalConcurrency`, both `reconfigure` calls, the try/finally) and call directly:

```ts
    const results = await Promise.allSettled(
      calls.map((c) => client.callImmediate(c.method, c.params, c.options ?? {})),
    );

    return results.map((r) => {
      if (r.status === "fulfilled") return r.value;
      this._logger?.warn?.("sendBatch: individual call failed", {
        identity,
        error: (r.reason as Error)?.message,
      });
      return undefined;
    });
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/send-batch.test.ts && npx vitest run`

```bash
git add src/client.ts src/server.ts test/send-batch.test.ts
git commit -m "fix(server): sendBatch bypasses the call queue instead of mutating concurrency"
```

---

### Task 21: M10 — Single shared backpressure drain per client

**Files:**
- Modify: `src/client.ts` (`_safeSend`, new queue/timer, `_cleanup`)
- Test: `test/backpressure-drain.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/backpressure-drain.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OCPPClient } from "../src/client.js";

describe("shared backpressure drain (M10)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("queued sends share one timer and flush FIFO", () => {
    const sent: string[] = [];
    const fakeWs: any = {
      readyState: 1, // WebSocket.OPEN
      bufferedAmount: 600 * 1024, // above the 512KB threshold
      send: (d: string, cb?: (err?: Error) => void) => {
        sent.push(d);
        cb?.();
      },
    };
    const client = new OCPPClient({ identity: "X", endpoint: "ws://x" });

    (client as any)._safeSend(fakeWs, "a");
    (client as any)._safeSend(fakeWs, "b");
    expect(sent).toEqual([]);
    expect((client as any)._backpressureTimer).not.toBeNull();

    fakeWs.bufferedAmount = 0;
    vi.advanceTimersByTime(100);

    expect(sent).toEqual(["a", "b"]);
    expect((client as any)._backpressureTimer).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (`_backpressureTimer` is not a field; per-send intervals).

- [ ] **Step 3: Implement in `src/client.ts`** — replace the entire `_safeSend` backpressure branch with a shared queue:

3a. Add fields next to `_BACKPRESSURE_THRESHOLD`:

```ts
  /** Sends queued while the socket is backpressured (FIFO). */
  private _backpressureQueue: Array<{
    data: string;
    cb?: (err?: Error) => void;
    enqueuedAt: number;
  }> = [];
  private _backpressureTimer: ReturnType<typeof setInterval> | null = null;
```

3b. Replace `_safeSend`:

```ts
  /**
   * Wraps ws.send() with backpressure protection. When bufferedAmount
   * exceeds the threshold, sends are queued and flushed FIFO by a single
   * shared 50ms drain timer (one per client, not one per send — report M10).
   * Entries older than 10s are sent regardless, preserving the previous
   * timeout semantics.
   */
  private _safeSend(
    ws: WebSocket | null,
    data: string,
    cb?: (err?: Error) => void,
  ): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      cb?.(new Error("WebSocket is not open"));
      return;
    }

    if (
      ws.bufferedAmount > OCPPClient._BACKPRESSURE_THRESHOLD ||
      this._backpressureQueue.length > 0
    ) {
      if (this._backpressureQueue.length === 0) {
        this._logger?.warn?.("Backpressure — pausing send", {
          identity: this._identity,
          bufferedAmount: ws.bufferedAmount,
          threshold: OCPPClient._BACKPRESSURE_THRESHOLD,
        });
        this.emit("backpressure", {
          identity: this._identity,
          bufferedAmount: ws.bufferedAmount,
        });
      }
      this._backpressureQueue.push({ data, cb, enqueuedAt: Date.now() });
      this._startBackpressureDrain(ws);
      return;
    }

    ws.send(data, cb);
  }

  private _startBackpressureDrain(ws: WebSocket): void {
    if (this._backpressureTimer) return;
    this._backpressureTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        this._stopBackpressureDrain();
        const failed = this._backpressureQueue.splice(0);
        for (const entry of failed) {
          entry.cb?.(new Error("WebSocket closed during backpressure wait"));
        }
        return;
      }
      const now = Date.now();
      while (this._backpressureQueue.length > 0) {
        const head = this._backpressureQueue[0];
        const timedOut = now - head.enqueuedAt >= 10_000;
        if (
          ws.bufferedAmount <= OCPPClient._BACKPRESSURE_THRESHOLD ||
          timedOut
        ) {
          this._backpressureQueue.shift();
          ws.send(head.data, head.cb);
        } else {
          break;
        }
      }
      if (this._backpressureQueue.length === 0) {
        this._stopBackpressureDrain();
      }
    }, 50);
  }

  private _stopBackpressureDrain(): void {
    if (this._backpressureTimer) {
      clearInterval(this._backpressureTimer);
      this._backpressureTimer = null;
    }
  }
```

3c. In `_cleanup()`, add:

```ts
    this._stopBackpressureDrain();
    const queued = this._backpressureQueue.splice(0);
    for (const entry of queued) {
      entry.cb?.(new Error("Connection closed"));
    }
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/backpressure-drain.test.ts && npx vitest run`

```bash
git add src/client.ts test/backpressure-drain.test.ts
git commit -m "fix(client): single shared backpressure drain timer per connection"
```

---

### Task 22: M11 — Dedup plugin: only dedup CALLs, replay cached responses

**Files:**
- Modify: `src/plugins/message-dedup.ts`
- Test: `test/plugins.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `test/plugins.test.ts`:

```ts
describe("messageDedupPlugin replay (M11)", () => {
  function fakeRedis() {
    const store = new Map<string, string>();
    return {
      store,
      async set(key: string, value: string, ...args: unknown[]) {
        if (args.includes("NX") && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      },
      async get(key: string) {
        return store.get(key) ?? null;
      },
    };
  }
  const makeClient = () =>
    ({ identity: "CP-D", sendRaw: vi.fn() }) as any;

  test("only CALL messages are deduplicated", async () => {
    const plugin = messageDedupPlugin({ redis: fakeRedis() });
    const client = makeClient();
    const callResult = JSON.stringify([3, "m1", { ok: 1 }]);
    expect(await plugin.onBeforeReceive!(client, callResult)).toBeUndefined();
    expect(await plugin.onBeforeReceive!(client, callResult)).toBeUndefined();
  });

  test("duplicate CALL replays the cached response", async () => {
    const plugin = messageDedupPlugin({ redis: fakeRedis() });
    const client = makeClient();
    const call = JSON.stringify([2, "m2", "Heartbeat", {}]);
    const response: any = [3, "m2", { currentTime: "t" }];

    expect(await plugin.onBeforeReceive!(client, call)).toBeUndefined();
    plugin.onBeforeSend!(client, response); // server responds → cached
    await new Promise((r) => setTimeout(r, 10));

    const second = await plugin.onBeforeReceive!(client, call);
    expect(second).toBe(false); // dropped
    expect(client.sendRaw).toHaveBeenCalledWith(JSON.stringify(response));
  });
});
```

(Import `messageDedupPlugin` at the top of the file if missing.)

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (CALLRESULT deduped / no replay).

- [ ] **Step 3: Implement in `src/plugins/message-dedup.ts`**

3a. Extend `DedupRedisLike`:

```ts
  /**
   * Fetch a cached value (used to replay responses for duplicate CALLs).
   * Optional — without it duplicates are silently dropped.
   */
  get?(key: string): Promise<string | null> | (string | null);
```

3b. Inside `messageDedupPlugin`, add a PX-set helper next to `setNX`:

```ts
  /** Plain SET with PX expiry, used to cache responses for replay */
  async function setPX(key: string, value: string): Promise<void> {
    if (style === "options") {
      await redis.set(key, value, { PX: ttlMs });
    } else {
      await redis.set(key, value, "PX", ttlMs);
    }
  }
```

3c. Replace the returned plugin object with:

```ts
  return {
    name: "message-dedup",

    /**
     * Intercepts CALL messages before they are parsed or routed.
     * Duplicates are dropped; if the original's response is already cached,
     * it is replayed so retrying chargers are not left to time out.
     */
    async onBeforeReceive(client, rawData) {
      let parsed: unknown;
      try {
        const str =
          typeof rawData === "string" ? rawData : rawData?.toString() || "";
        parsed = JSON.parse(str);
      } catch {
        return undefined; // let the core validator emit protocol errors
      }

      // Only CALLs are idempotency-checked — CALLRESULT/CALLERROR ids
      // legitimately repeat the CALL id they answer (report M11).
      if (
        !Array.isArray(parsed) ||
        parsed[0] !== 2 ||
        typeof parsed[1] !== "string"
      ) {
        return undefined;
      }
      const messageId = parsed[1];
      const key = `${prefix}${client.identity}:${messageId}`;

      try {
        const acquired = await setNX(key);
        if (!acquired) {
          // Duplicate. Replay the original response when available so the
          // retrying charger gets its answer (idempotent retry semantics).
          if (redis.get) {
            const cached = await redis.get(
              `${prefix}resp:${client.identity}:${messageId}`,
            );
            if (cached) {
              try {
                client.sendRaw(cached);
              } catch {
                // socket gone — nothing to replay to
              }
            }
          }
          log?.warn?.(`[message-dedup] Dropping duplicate message: ${key}`);
          return false;
        }
      } catch (err) {
        // If Redis is down, fail open to keep the charging station online.
        log?.error?.(`[message-dedup] Redis failure, falling through:`, err);
      }

      return undefined;
    },

    /**
     * Caches outbound CALLRESULT/CALLERROR frames keyed by message id so
     * duplicate CALL retries can be replayed.
     */
    onBeforeSend(client, message) {
      if (
        Array.isArray(message) &&
        (message[0] === 3 || message[0] === 4) &&
        typeof message[1] === "string" &&
        redis.get // replay only useful when reads are possible
      ) {
        const respKey = `${prefix}resp:${client.identity}:${message[1]}`;
        Promise.resolve(setPX(respKey, JSON.stringify(message))).catch(
          () => {},
        );
      }
      return true;
    },
  };
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/plugins.test.ts && npx vitest run`

```bash
git add src/plugins/message-dedup.ts test/plugins.test.ts
git commit -m "fix(dedup): only dedup CALLs and replay cached responses for retries"
```

---

### Task 23: M12 — Server-level `maxConnections` enforced at upgrade time

**Files:**
- Modify: `src/types.ts` (`ServerOptions`, `SecurityEvent` union)
- Modify: `src/server.ts` (`_handleUpgrade`)
- Test: `test/max-connections.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `test/max-connections.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

describe("maxConnections (M12)", () => {
  let server: OCPPServer;
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients) await c.close({ force: true }).catch(() => {});
    clients.length = 0;
    await server?.close({ force: true }).catch(() => {});
  });

  test("rejects the upgrade with 503 once the cap is reached", async () => {
    server = new OCPPServer({ maxConnections: 1 });
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;

    const c1 = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    clients.push(c1);
    await c1.connect();

    const c2 = new OCPPClient({
      identity: "CP-2",
      endpoint: `ws://127.0.0.1:${port}`,
      reconnect: false,
    });
    clients.push(c2);
    await expect(c2.connect()).rejects.toMatchObject({ statusCode: 503 });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (second connect succeeds).

- [ ] **Step 3: Implement**

3a. `src/types.ts` — `ServerOptions` gains:

```ts
  /**
   * Hard cap on concurrent client connections, enforced before the TLS/auth
   * handshake work is done (the connection-guard plugin only closes after
   * the fact). Excess upgrades are rejected with HTTP 503.
   */
  maxConnections?: number;
```

and add `"CONNECTION_LIMIT"` to the `SecurityEvent` `type` union.

3b. `src/server.ts` `_handleUpgrade` — directly after the server-state guard, add:

```ts
    // Hard connection cap — reject before any expensive handshake work
    const maxConnections = this._options.maxConnections;
    if (maxConnections !== undefined && this._clients.size >= maxConnections) {
      const secEvt = {
        type: "CONNECTION_LIMIT" as const,
        ip: req.socket.remoteAddress ?? "unknown",
        timestamp: new Date().toISOString(),
        details: {
          activeConnections: this._clients.size,
          maxConnections,
        },
      };
      this.emit("securityEvent", secEvt);
      for (const plugin of this._plugins) {
        try {
          plugin.onSecurityEvent?.(secEvt);
        } catch {}
      }
      abortHandshake(socket, 503, "Connection limit reached");
      return;
    }
```

3c. Update `connectionGuardPlugin`'s JSDoc in `src/plugins/connection-guard.ts` to recommend the server option:

```
 * NOTE: prefer `new OCPPServer({ maxConnections })` for the hard cap — it
 * rejects at upgrade time, before TLS/auth work. This plugin's cap closes
 * connections only after they complete the handshake; its main value is the
 * pong-timeout / backpressure slot-reclaim options.
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/max-connections.test.ts && npx vitest run`

```bash
git add src/types.ts src/server.ts src/plugins/connection-guard.ts test/max-connections.test.ts
git commit -m "feat(server): maxConnections cap enforced at upgrade time"
```

---

### Task 24: M13 — Stop leaking stack traces in detailed CALLERRORs

**Files:**
- Modify: `src/util.ts` (`getErrorPlainObject`)
- Modify: `src/client.ts` (call site)
- Test: `test/util.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/util.test.ts`:

```ts
describe("getErrorPlainObject stack handling (M13)", () => {
  test("includeStack=false omits the stack", () => {
    const obj = getErrorPlainObject(new Error("x"), false);
    expect(obj.stack).toBeUndefined();
    expect(obj.message).toBe("x");
  });

  test("default keeps backward-compatible behavior", () => {
    const obj = getErrorPlainObject(new Error("x"));
    expect(obj.stack).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (no second parameter).

- [ ] **Step 3: Implement** — in `src/util.ts`:

```ts
export function getErrorPlainObject(
  err: Error,
  includeStack = true,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const prop of ERROR_PROPERTIES) {
    if (prop === "stack" && !includeStack) continue;
    // ... rest of the loop unchanged ...
```

In `src/client.ts` `_handleIncomingCall`'s error branch, change:

```ts
          const details = this._options.respondWithDetailedErrors
            ? getErrorPlainObject(err as Error)
            : {};
```

to:

```ts
          // Never ship stack traces to remote peers (report M13)
          const details = this._options.respondWithDetailedErrors
            ? getErrorPlainObject(err as Error, false)
            : {};
```

Apply the same change in `src/browser/client.ts` if it builds detailed error objects with `getErrorPlainObject` (check its `respondWithDetailedErrors` path; the browser `util.ts` has its own copy of the function — give it the same `includeStack` parameter).

- [ ] **Step 4: Run + commit** — `npx vitest run test/util.test.ts && npx vitest run`

```bash
git add src/util.ts src/client.ts src/browser/util.ts src/browser/client.ts test/util.test.ts
git commit -m "fix(security): omit stack traces from detailed CALLERROR payloads"
```

---

### Task 25: M14 — Survive malformed percent-encoding in URL paths

**Files:**
- Modify: `src/util.ts` (new `safeDecodeURIComponent`)
- Modify: `src/radix-trie.ts:188`
- Modify: `src/server.ts` (identity extraction ~line 894, regex group decode ~line 868)
- Test: `test/routing.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/routing.test.ts`:

```ts
describe("malformed percent-encoding (M14)", () => {
  test("trie match does not throw on bad %-sequences", () => {
    const trie = new RadixTrie();
    const router = new OCPPRouter();
    trie.insert("/ocpp/:identity", router);

    expect(() => trie.match("/ocpp/CP%E0%A4%A")).not.toThrow();
    expect(trie.match("/ocpp/CP%E0%A4%A")!.params.identity).toBe("CP%E0%A4%A");
  });
});
```

(Import `RadixTrie` from `../src/radix-trie.js` and `OCPPRouter` from `../src/router.js` if missing.)

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL with `URIError: URI malformed`.

- [ ] **Step 3: Implement**

3a. In `src/util.ts` add:

```ts
/**
 * decodeURIComponent that returns the raw input instead of throwing on
 * malformed percent-encoding (e.g. "/ocpp/CP%E0%A4%A"). Prevents handshake
 * crashes from hostile or buggy URLs (report M14).
 */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
```

3b. In `src/radix-trie.ts`, import it and replace `decodeURIComponent(segment)` with `safeDecodeURIComponent(segment)`.

3c. In `src/server.ts`, replace both `decodeURIComponent(...)` call sites (regex `match.groups` values and the legacy identity extraction) with `safeDecodeURIComponent(...)` (add to the existing `./util.js` import).

- [ ] **Step 4: Run + commit** — `npx vitest run test/routing.test.ts && npx vitest run`

```bash
git add src/util.ts src/radix-trie.ts src/server.ts test/routing.test.ts
git commit -m "fix(routing): tolerate malformed percent-encoding in upgrade paths"
```

---

## Phase 4 — Low-Severity / Polish

### Task 26: Correct `getPackageIdent()` version + drift guard

**Files:**
- Modify: `src/util.ts:113-114`
- Test: `test/util.test.ts` (append)

- [ ] **Step 1: Write the failing test:**

```ts
import { readFileSync } from "node:fs";

describe("getPackageIdent version (low)", () => {
  test("matches package.json version", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(getPackageIdent()).toBe(`ocpp-ws-io/${pkg.version}`);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (`ocpp-ws-io/1.0.1` vs `2.2.4`).

- [ ] **Step 3: Implement** — in `src/util.ts`:

```ts
const PKG_NAME = "ocpp-ws-io";
// Keep in sync with package.json — guarded by test/util.test.ts so a
// version bump without updating this constant fails CI.
const PKG_VERSION = "2.2.4";
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/util.test.ts`

```bash
git add src/util.ts test/util.test.ts
git commit -m "fix(util): report correct package version in User-Agent (with drift test)"
```

---

### Task 27: `_buildEndpoint` handles endpoints with query strings

**Files:**
- Modify: `src/client.ts` (`_buildEndpoint`)
- Modify: `src/browser/client.ts` (same method)
- Test: `test/client.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/client.test.ts`:

```ts
describe("_buildEndpoint (low)", () => {
  const build = (endpoint: string, query?: Record<string, string>) =>
    (
      new OCPPClient({ identity: "CP/1", endpoint, query }) as any
    )._buildEndpoint() as string;

  test("identity goes into the path, not the query string", () => {
    expect(build("ws://h/base?x=1")).toBe("ws://h/base/CP%2F1?x=1");
  });

  test("query option merges with endpoint query", () => {
    expect(build("ws://h/base?x=1", { y: "2" })).toBe(
      "ws://h/base/CP%2F1?x=1&y=2",
    );
  });

  test("plain endpoint unchanged behavior", () => {
    expect(build("ws://h/base")).toBe("ws://h/base/CP%2F1");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (`ws://h/base?x=1/CP%2F1`).

- [ ] **Step 3: Implement** — in `src/client.ts` replace `_buildEndpoint`:

```ts
  private _buildEndpoint(): string {
    // Use URL so identities land in the pathname even when the configured
    // endpoint carries a query string (report: low/_buildEndpoint).
    const url = new URL(this._options.endpoint);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.pathname += encodeURIComponent(this._identity);

    if (this._options.query) {
      for (const [k, v] of new URLSearchParams(this._options.query)) {
        url.searchParams.append(k, v);
      }
    }
    return url.toString();
  }
```

Apply the identical replacement to `_buildEndpoint` in `src/browser/client.ts` (it has the same string-concatenation implementation).

- [ ] **Step 4: Run + commit** — `npx vitest run test/client.test.ts && npx vitest run`

```bash
git add src/client.ts src/browser/client.ts test/client.test.ts
git commit -m "fix(client): build endpoint via URL so query strings don't swallow the identity"
```

---

### Task 28: Late `router.route()` calls register with the server

**Files:**
- Modify: `src/router.ts` (`route()`, new internal hook)
- Modify: `src/server.ts` (`_registerRouter`)
- Test: `test/routing.test.ts` (append)

- [ ] **Step 1: Write the failing test:**

```ts
describe("late route() registration (low)", () => {
  test("patterns added after attachment still match", async () => {
    const server = new OCPPServer({});
    const router = server.route("/a/:identity");
    router.route("/b/:identity"); // late addition

    let seen = "";
    router.on("client", (c) => {
      seen = c.handshake.pathname;
    });

    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;
    const client = new OCPPClient({
      identity: "CP-LATE",
      endpoint: `ws://127.0.0.1:${port}/b`,
      reconnect: false,
    });
    await client.connect();
    await new Promise((r) => setTimeout(r, 50));

    expect(seen).toBe("/b/CP-LATE");

    await client.close({ force: true });
    await server.close({ force: true });
  });
});
```

(Reuse the file's existing `OCPPServer`/`OCPPClient`/`AddressInfo` imports.)

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL — connect rejected with 404 "Endpoint Not Found".

- [ ] **Step 3: Implement**

3a. `src/router.ts` — add the hook field to `OCPPRouter` and fire it in `route()`:

```ts
  /**
   * @internal Set by OCPPServer when the router is registered, so patterns
   * added after registration still reach the trie / regex list.
   */
  _onPatternAdded?: (pattern: string | RegExp) => void;
```

```ts
  route(...patterns: Array<string | RegExp>): this {
    this.patterns.push(...patterns);
    for (const p of patterns) {
      if (typeof p !== "string") {
        // RegExp — compile for fallback linear matching
        this._regexPatterns.push({ regex: p, paramNames: [] });
      }
      this._onPatternAdded?.(p);
    }
    return this;
  }
```

3b. `src/server.ts` `_registerRouter` — at the end of the method, add:

```ts
    // Sync patterns added after registration (e.g. server.route("/a").route("/b"))
    router._onPatternAdded = (pattern) => {
      // A router that was registered as global middleware becomes scoped
      // the moment it gains a pattern.
      const globalIdx = this._globalMiddlewareRouters.indexOf(router);
      if (globalIdx !== -1) this._globalMiddlewareRouters.splice(globalIdx, 1);

      if (typeof pattern === "string") {
        this._trie.insert(pattern, router);
      } else if (!this._regexRouters.includes(router)) {
        this._regexRouters.push(router);
      }
    };
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/routing.test.ts && npx vitest run`

```bash
git add src/router.ts src/server.ts test/routing.test.ts
git commit -m "fix(router): patterns added after attachment now register with the server"
```

---

### Task 29: `hasHandler()` + heartbeat plugin no longer collides with user handlers

**Files:**
- Modify: `src/client.ts` (new `hasHandler`)
- Modify: `src/plugins/heartbeat.ts`
- Test: `test/plugins.test.ts` (append)

- [ ] **Step 1: Write the failing test:**

```ts
describe("heartbeatPlugin handler collision (low)", () => {
  test("does not throw when a Heartbeat handler already exists", () => {
    const client: any = new OCPPClient({ identity: "x", endpoint: "ws://x" });
    client.handle("Heartbeat", () => ({ currentTime: "user" }));

    expect(() => heartbeatPlugin().onConnection!(client)).not.toThrow();
    expect(client.hasHandler("Heartbeat")).toBe(true);
  });

  test("registers the default handler when none exists", () => {
    const client: any = new OCPPClient({ identity: "y", endpoint: "ws://x" });
    heartbeatPlugin().onConnection!(client);
    expect(client.hasHandler("Heartbeat")).toBe(true);
  });
});
```

(Import `heartbeatPlugin` and `OCPPClient` at the top if missing.)

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (`hasHandler` is not a function / plugin throws).

- [ ] **Step 3: Implement**

3a. `src/client.ts` — add next to `removeHandler`:

```ts
  /**
   * Check whether a handler is registered for a method
   * (optionally version-scoped, matching the handle() overloads).
   */
  hasHandler(method: string, version?: string): boolean {
    return version
      ? this._handlers.has(`${version}:${method}`)
      : this._handlers.has(method);
  }
```

3b. `src/plugins/heartbeat.ts`:

```ts
    onConnection(client) {
      // Don't clobber an application-registered Heartbeat handler
      if (client.hasHandler("Heartbeat")) return;
      client.handle("Heartbeat", () => ({
        currentTime: new Date().toISOString(),
      }));
    },
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/plugins.test.ts && npx vitest run`

```bash
git add src/client.ts src/plugins/heartbeat.ts test/plugins.test.ts
git commit -m "fix(plugins): heartbeat plugin defers to existing Heartbeat handlers"
```

---

### Task 30: Webhook plugin — check HTTP status, clear timers, backoff between retries

**Files:**
- Modify: `src/plugins/webhook.ts:78-97`
- Test: `test/plugins.test.ts` (append)

- [ ] **Step 1: Write the failing test:**

```ts
describe("webhookPlugin retries (low)", () => {
  test("retries non-2xx responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = webhookPlugin({
      url: "https://example.test/hook",
      events: ["connect"],
      retries: 1,
    });
    plugin.onConnection!({
      identity: "CP-W",
      handshake: { remoteAddress: "1.1.1.1" },
      protocol: "ocpp1.6",
    } as any);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    vi.unstubAllGlobals();
  });
});
```

(Import `webhookPlugin` if missing.)

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (HTTP 500 treated as success; fetch called once).

- [ ] **Step 3: Implement** — replace the retry loop in `sendWebhook`:

```ts
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(options.url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Webhook responded with HTTP ${res.status}`);
        }
        return; // Success
      } catch {
        if (attempt < maxRetries) {
          // Exponential backoff between attempts (250ms, 500ms, 1s, ...)
          await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        }
        // Final failure is swallowed — webhooks must never crash the server
      } finally {
        clearTimeout(timer);
      }
    }
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/plugins.test.ts && npx vitest run`

```bash
git add src/plugins/webhook.ts test/plugins.test.ts
git commit -m "fix(webhook): treat non-2xx as failure, clear timers, backoff retries"
```

---

### Task 31: redis-pubsub plugin — make the `closing` event publishable

**Files:**
- Modify: `src/plugins/redis-pubsub.ts:21-27`
- Test: `test/plugins.test.ts` (append)

- [ ] **Step 1: Write the failing test:**

```ts
describe("redisPubSubPlugin closing event (low)", () => {
  test("publishes ocpp:closing when enabled", async () => {
    const client = { publish: vi.fn(async () => 1) };
    const plugin = redisPubSubPlugin({ client, events: ["closing"] });
    plugin.onClosing!();
    await vi.waitFor(() =>
      expect(client.publish).toHaveBeenCalledWith(
        "ocpp:closing",
        expect.any(String),
      ),
    );
  });
});
```

(Import `redisPubSubPlugin` if missing.)

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL — TypeScript rejects `"closing"` / publish never called.

- [ ] **Step 3: Implement** — in `src/plugins/redis-pubsub.ts`, extend the union:

```ts
type RedisPubSubEvent =
  | "connect"
  | "disconnect"
  | "message"
  | "security"
  | "auth_failed"
  | "eviction"
  | "closing";
```

(The `send("closing", …)` call in `onClosing` already exists — it was just unfilterable.)

- [ ] **Step 4: Run + commit** — `npx vitest run test/plugins.test.ts && npx vitest run`

```bash
git add src/plugins/redis-pubsub.ts test/plugins.test.ts
git commit -m "fix(plugins): redis-pubsub 'closing' event is now subscribable"
```

---

### Task 32: Timing-safe Basic-Auth identity comparison

**Files:**
- Modify: `src/ws-util.ts` (`parseBasicAuth`)
- Test: existing `test/parse-basic-auth.test.ts` must stay green

- [ ] **Step 1: Implement** — in `src/ws-util.ts`, add `import { timingSafeEqual } from "node:crypto";` and replace the comparison section of `parseBasicAuth`:

```ts
  try {
    const decoded = Buffer.from(match[1], "base64");
    const prefix = Buffer.from(`${identity}:`);

    // Identity-prefix matching: the decoded buffer must start with `identity:`
    // (constant-time to avoid a timing oracle on the identity).
    if (
      decoded.length > prefix.length &&
      timingSafeEqual(decoded.subarray(0, prefix.length), prefix)
    ) {
      return decoded.subarray(prefix.length);
    }

    // Fallback: standard first-colon split (for non-OCPP or mismatched identity)
    const colonIdx = decoded.indexOf(0x3a); // ':'
    if (colonIdx !== -1) {
      const user = decoded.subarray(0, colonIdx);
      const expected = Buffer.from(identity);
      if (user.length === expected.length && timingSafeEqual(user, expected)) {
        return decoded.subarray(colonIdx + 1);
      }
    }
  } catch {
    // Malformed base64 — treat as no password
  }
```

- [ ] **Step 2: Run + commit**

Run: `npx vitest run test/parse-basic-auth.test.ts && npx vitest run` — Expected: green (behavior identical, timing hardened).

```bash
git add src/ws-util.ts
git commit -m "fix(security): timing-safe identity comparison in Basic-Auth parsing"
```

---

### Task 33: `server.reconfigure()` actually applies transport/limiter changes

**Files:**
- Modify: `src/server.ts` (`reconfigure`, adaptive-multiplier closure)
- Test: `test/server-coverage.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `test/server-coverage.test.ts`:

```ts
describe("reconfigure applies changes (low)", () => {
  test("maxPayloadBytes rebuilds the WebSocketServer", async () => {
    const server = new OCPPServer({ maxPayloadBytes: 65536 });
    server.reconfigure({ maxPayloadBytes: 1024 });
    expect(((server as any)._wss.options as any).maxPayload).toBe(1024);
    await server.close({ force: true });
  });

  test("rateLimit.adaptive toggles the limiter", async () => {
    const server = new OCPPServer({});
    expect((server as any)._adaptiveLimiter).toBeNull();
    server.reconfigure({
      rateLimit: { limit: 10, windowMs: 1000, adaptive: true },
    });
    expect((server as any)._adaptiveLimiter).not.toBeNull();
    server.reconfigure({ rateLimit: { limit: 10, windowMs: 1000 } });
    expect((server as any)._adaptiveLimiter).toBeNull();
    await server.close({ force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (old wss kept; limiter unchanged).

- [ ] **Step 3: Implement** — replace `reconfigure` in `src/server.ts`:

```ts
  reconfigure(options: Partial<ServerOptions>): void {
    const oldOptions = { ...this._options } as ServerOptions;
    Object.assign(this._options, options);

    // Transport-level settings only apply to a fresh WebSocketServer —
    // rebuild so new connections pick them up (existing sockets keep theirs).
    if (
      options.maxPayloadBytes !== undefined ||
      options.compression !== undefined
    ) {
      this._wss?.close();
      this._wss = this._createWss();
    }

    // Toggle the adaptive limiter to match the new rateLimit config
    if (options.rateLimit !== undefined) {
      const wantAdaptive = !!options.rateLimit?.adaptive;
      if (wantAdaptive && !this._adaptiveLimiter) {
        const rl = options.rateLimit!;
        this._adaptiveLimiter = new AdaptiveLimiter({
          cpuThresholdPercent: rl.cpuThresholdPercent,
          memThresholdPercent: rl.memThresholdPercent,
          cooldownMs: rl.cooldownMs,
        });
        this._adaptiveLimiter.on("adapted", (event) => {
          this._logger?.info?.("Adaptive rate limit adjusted", event);
          this.emit("rateLimit:adapted" as any, event);
        });
        this._adaptiveLimiter.start();
      } else if (!wantAdaptive && this._adaptiveLimiter) {
        this._adaptiveLimiter.stop();
        this._adaptiveLimiter = null;
      }
    }

    // Plugin: onReconfigure
    for (const plugin of this._plugins) {
      try {
        plugin.onReconfigure?.(options, oldOptions);
      } catch (err) {
        this._logger?.error?.("Plugin onReconfigure error", {
          name: plugin.name,
          error: (err as Error).message,
        });
      }
    }
  }
```

Also harden the multiplier closure passed to clients in `_handleUpgrade` (it must survive the limiter being nulled):

```ts
        adaptiveMultiplier: this._adaptiveLimiter
          ? () => this._adaptiveLimiter?.multiplier ?? 1
          : undefined,
```

- [ ] **Step 4: Run + commit** — `npx vitest run test/server-coverage.test.ts && npx vitest run`

```bash
git add src/server.ts test/server-coverage.test.ts
git commit -m "fix(server): reconfigure applies transport and adaptive-limiter changes"
```

---

### Task 34: Documentation & repo hygiene sweep

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.gitignore`, `src/client.ts`, `src/server-client.ts`, `src/types.ts`
- No new tests (docs/comments only) — full suite must stay green.

- [ ] **Step 1: README.md**
  - Replace `Zero-dependency WebSocket RPC framework` with `Lightweight WebSocket RPC framework (runtime deps: ws, ajv, ajv-formats, voltlog-io)`.
  - Replace the heading text `Message Observability & Event Handling (v3.0.0+)` with `Message Observability & Event Handling (v2.2+)`.
  - In the clustering/Redis section, add one sentence: `Cross-node sendToClient returns the remote client's response (correlated over the adapter); sessions remain node-local.`

- [ ] **Step 2: Comment fixes**
  - `src/client.ts` `_onMessage`: change `// Zero-copy — JSON.parse accepts Buffer directly (Node 18+), avoiding an intermediate string allocation per message.` to `// JSON.parse accepts a Buffer directly (implicit utf8 toString).`
  - `src/server-client.ts` `_processInboundMessage`: same comment fix (done in Task 7's code — verify).
  - `src/client.ts` `_startPing`: delete the commented-out `// console.log("doPing called", ...)` line.
  - `src/types.ts` `maxBadMessages` JSDoc: append `Default: Infinity (never disconnects on bad messages) — set a finite value in production.`

- [ ] **Step 3: .gitignore + committed coverage**

In `packages/ocpp-ws-io/.gitignore` add a `coverage/` line (if missing), then:

```bash
git rm -r --cached coverage
```

- [ ] **Step 4: CHANGELOG.md** — add at the top:

```markdown
## Unreleased

### Fixed
- Worker-thread parse pool now ships `parse-worker.cjs` in dist and decodes binary frames (was silently non-functional).
- OCPP 2.1 strict-mode validation resolves `Request`/`Response`-style schema ids (was a silent no-op).
- Cluster presence TTL is heartbeat-refreshed; long-lived connections stay routable.
- Cross-node `sendToClient` now returns the remote client's response (correlation ids over the adapter).
- AbortSignal listeners detach when calls settle; offline-queue overflow rejects the dropped call.
- Inbound message processing is serialized per connection (ordering with async plugins/worker parsing).
- Per-IP connection-rate buckets are garbage-collected; `x-forwarded-proto` requires `trustProxy`.
- External HTTP servers are no longer 404-hijacked by `healthEndpoint` nor closed by `server.close()`.
- Redis adapter: presence cache pruned on removal, no `__seq` payload mutation, offsets survive resubscribe, non-blocking polls without a dedicated blocking client, direct `driver` option (ClusterDriver usable).
- Strict mode validates inbound CALLRESULT payloads; OCPP 1.6 uses `FormationViolation`.
- `message-dedup` only dedups CALLs and replays cached responses; webhook retries non-2xx with backoff.
- Detailed CALLERRORs no longer include stack traces; Basic-Auth identity check is timing-safe.

### Added
- `ServerOptions.maxConnections` (upgrade-time cap), `ServerOptions.presenceTtlSeconds`, `CORSOptions.trustProxy`, `RedisAdapterOptions.driver`, `OCPPClient.hasHandler()`, `OCPPClient.callImmediate()`, `OCPPClient.bufferedAmount`.
```

- [ ] **Step 5: Run + commit**

Run: `npx vitest run` — Expected: green.

```bash
git add -A
git commit -m "docs: README accuracy, CHANGELOG for review fixes, untrack coverage artifacts"
```

---

## Phase 5 — Final Verification

### Task 35: Full verification gate

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all tests pass (788 baseline + ~40 new). Zero failures, zero unhandled rejections in output.

- [ ] **Step 2: Build & artifact check**

Run: `npx tsup`
Then: `node -e "const fs=require('node:fs');['dist/index.js','dist/index.mjs','dist/parse-worker.cjs','dist/adapters/redis.js','dist/browser.js'].forEach(f=>fs.accessSync(f));console.log('dist artifacts OK')"`
Expected: `dist artifacts OK`

- [ ] **Step 3: Type check & lint**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx biome check src test` — Expected: no errors (run `npx biome check --write src test` to fix formatting if needed, re-run tests after).

- [ ] **Step 4: Smoke the worker pool against the built output**

Run:
```bash
node -e "
const { WorkerPool } = require('./dist/index.js');
" 2>nul || echo "WorkerPool not exported from index — OK, internal API"
node -e "
const { Worker } = require('node:worker_threads');
const w = new Worker(require('node:path').resolve('dist/parse-worker.cjs'));
w.on('message', (m) => { console.log('worker replied:', JSON.stringify(m)); w.terminate(); });
w.postMessage({ id: 1, buffer: Buffer.from('[2,\"x\",\"Heartbeat\",{}]') });
"
```
Expected: `worker replied: {"id":1,"message":[2,"x","Heartbeat",{}]}`

- [ ] **Step 5: Review `git log` — one commit per task, clean tree**

Run: `git status` — Expected: clean working tree.

- [ ] **Step 6: Update `packages/ocpp-ws-io/report.md`** — append at the top:

```markdown
> **Status update (2026-06-10):** All findings in this report have been addressed.
> See `docs/superpowers/plans/2026-06-10-ocpp-ws-io-review-fixes.md` and the
> `Unreleased` section of CHANGELOG.md for the fix list.
```

```bash
git add packages/ocpp-ws-io/report.md
git commit -m "docs: mark review findings as addressed"
```

---

## Coverage Matrix (spec → task)

| Report finding | Task |
|---|---|
| C1 worker pool broken | 1 |
| C2 OCPP 2.1 strict no-op | 2 |
| C3 presence TTL expiry | 3 |
| H1 remote RPC no response | 11 |
| H2 offline queue hang | 6 |
| H3 presence resurrection | 12 |
| H4 bucket map growth | 8 |
| H5 x-forwarded-proto spoof | 9 |
| H6 message ordering | 7 |
| H7 external server hijack | 10 |
| H8 abort listener leak | 5 |
| M1 blocking XREAD HOL | 14 |
| M2 ClusterDriver unusable | 13 |
| M3 `__seq` dead code | 15 |
| M4 stream replay | 16 |
| M5 XLEN metric claim | 15 |
| M6 CALLRESULT unvalidated | 17 |
| M7 FormationViolation | 18 |
| M8 createValidator shadowing | 19 |
| M9 sendBatch concurrency race | 20 |
| M10 backpressure timer storm | 21 |
| M11 dedup drop-no-replay | 22 |
| M12 post-handshake conn cap | 23 |
| M13 stack trace leak | 24 |
| M14 malformed %-encoding | 25 |
| Low: version ident | 26 |
| Low: endpoint query bug | 27 |
| Low: late route() ignored | 28 |
| Low: heartbeat collision | 29 |
| Low: webhook status/timer/backoff | 30 |
| Low: redis-pubsub closing event | 31 |
| Low: timing-safe Basic-Auth | 32 |
| Low: reconfigure no-op | 33 |
| Low: @ts-expect-error private access | 4 |
| Low: README/comments/CHANGELOG/coverage | 34 |
| Low: maxBadMessages default | 34 (documented, default unchanged — breaking to change) |
| Low: sessions node-local | 34 (documented in README) |



