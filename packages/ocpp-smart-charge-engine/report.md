> **Status update (2026-06-11):** All findings below have been addressed —
> H1/H2/M1–M5 fixed with regression tests (90 tests passing), L1–L7 fixed or
> documented. See the `Unreleased` section of CHANGELOG.md.

# ocpp-smart-charge-engine — Deep-Dive Review

**Date:** 2026-06-11 · **Version reviewed:** 0.2.0 · **Scope:** full package (src 2 080 LoC, 73 tests)

## Verdict

A well-architected, genuinely library-agnostic smart-charging constraint solver. The weighted
water-fill allocator is correct (caps honored, surplus redistributed, `Σ ≤ grid` invariant enforced
by a final budget pass), the snapshot/restore design is atomic, the dispatch path has a re-entrancy
guard, and the 73-test suite covers strategies, validation, redistribution, starvation, and
timezone handling. Zero runtime dependencies, dual CJS/ESM with type declarations, `tsc` clean.

Two **high-severity** defects were found and empirically confirmed, plus a handful of mediums —
all small, localized fixes.

---

## High

### H1 — Auto-dispatch with no `error` listener crashes the host process *(confirmed)*

`engine.ts` emits `"error"` in two places (`optimize()` catch, `startAutoDispatch()` catch).
Node's `EventEmitter` **throws** when `"error"` is emitted with no listener. Under
`startAutoDispatch()`, that throw happens inside a `setInterval` callback → **uncaught exception →
process exit**. Reproduced: a custom strategy that throws + no `error` listener killed the process
on the first tick. One misbehaving strategy (or a `dispatch()` rejection) can take down the whole
CSMS.

**Fix:** guard every `this.emit("error", …)` with `if (this.listenerCount("error") > 0)`, and
log otherwise.

### H2 — `clearDispatch(0)` clears ALL sessions *(confirmed)*

`engine.ts:496` — `transactionId ? [one] : [all]`. A numeric transactionId `0` (legal in OCPP 1.6)
is falsy, so `clearDispatch(0)` broadcasts `ClearChargingProfile` to **every charger on the site**
instead of one. Reproduced: with sessions `0` and `1` registered, `clearDispatch(0)` dispatched
clears for both.

**Fix:** `transactionId !== undefined ? … : …`.

---

## Medium

### M1 — Spurious `gridOverCommitted` alarm from round-half-up *(confirmed)*

`buildSessionProfile` rounds allocations with `toFixed(2)` (round-half-up), so equal shares like
`95 / 3 = 31.666…` become `31.67 × 3 = 95.01 kW` — **0.01 kW over budget**. The budget pass then
scales back down (final sum 94.98, invariant holds) but unconditionally emits `gridOverCommitted`.
Result: the "site over-subscribed" alarm fires on virtually every optimize whose division isn't
exact — operators alerting on this event get constant false positives.

**Fix:** round **down** in `buildSessionProfile` (reuse `rebuildProfileKw`'s `floor2`), so only
genuine floor-induced overcommit triggers the pass/event. Alternatively gate the event on a
material overshoot (e.g. > 0.05 kW).

### M2 — Builders ignore the session's phase count

`buildOcpp16Profile` / `201` / `21`: the schedule period sets `numberPhases: options.numberPhases ?? 3`
and the `minChargingRate` amps conversion divides by `options.numberPhases ?? 3` — but
`sessionProfile.allocatedAmpsPerPhase` was computed with `sessionProfile.phases`. For a
single-phase session with `rateUnit: "A"`, the limit is a 1-phase figure while the profile tells
the charger `numberPhases: 3` (and the min-rate uses a third phase-count). Internally inconsistent
profile.

**Fix:** default both to `sessionProfile.phases`.

### M3 — `dispatch()` coalescing can return stale results

The re-entrancy guard returns the in-flight promise. A deliberate `dispatch()` after
`updateSession()` / `setGridLimit()` while a slow dispatch is running resolves with the **old**
profiles and never schedules a re-run — the update silently waits for the next auto-dispatch tick.

**Fix:** set a `dirty` flag when coalescing; on completion, run once more if dirty (trailing-edge
re-dispatch). Or document the limitation.

### M4 — Module-level profile ID counters reset on restart

`ocpp16IdCounter` (and 201/21 variants) are module globals starting at 1. After a CSMS restart the
counter resets, so new profiles reuse `chargingProfileId` 1, 2, 3… which **replace** profiles still
persisted on chargers from before the restart (OCPP replaces on ID match). Shared across all
engines in the process (cross-site ID interleaving — benign but surprising).

**Fix:** accept an `idProvider?: () => number` option (or seed from `Date.now()`), and document the
restart semantics.

### M5 — `buildOcpp21Profile` drops `dischargeLimitW` when `periods` is supplied

The V2G discharge period is built first, then discarded if `options.periods` is set — passing both
silently loses the discharge limit. Apply `dischargeLimit` to supplied periods, or document the
exclusivity.

---

## Low

- **L1 — Split-phase doc trap:** `phases: 2` docs say "split-phase (e.g. US 240 V)" while the amps
  formula `I = W / (V × phases)` expects the **per-leg** voltage (the test correctly uses 120 V).
  A user following the doc with `voltageV: 240, phases: 2` gets half the real current. Clarify that
  `voltageV` is per-phase/leg voltage.
- **L2 — Missing LICENSE file:** `package.json` declares `license: MIT` and lists `LICENSE` in
  `files`, but no LICENSE file exists in the package directory.
- **L3 — Events leak live state:** `sessionAdded` / `sessionUpdated` emit the *stored* session
  object (listeners can mutate engine state), while `getSessions()`/`getSession()` carefully return
  copies. Emit copies for consistency.
- **L4 — `updateSession` with explicit `undefined`** (e.g. `{ maxHardwarePowerKw: undefined }`)
  removes the cap via spread. Possibly intended (cap removal) — document it either way.
- **L5 — TOU window with `peakStartHour === peakEndHour`** is silently empty (never peak). Either
  validate against it or document (some users will mean "all day").
- **L6 — `loadSnapshot` intra-array duplicates:** duplicate transactionIds within one snapshot
  silently collapse (last wins). Consider rejecting during the validation pass.
- **L7 — `validateSession` doesn't check identity fields:** empty `clientId` / missing
  `transactionId` pass validation and only fail downstream.

---

## Strengths

- **Water-fill allocator** (`strategies/utils.ts`) is the real thing: weighted, cap-aware,
  surplus-redistributing, with epsilon guards and an iteration bound. Zero-weight and all-capped
  edge cases handled.
- **Grid-budget invariant pass** (`enforceGridBudget`) cleanly separates per-session floors from
  the site-level guarantee, with a feasible/infeasible split and a starvation signal
  (`starvedSessions`) — good operator ergonomics.
- **Atomic `loadSnapshot`** (validate-all-then-apply), shallow-copy getters, immutable identity in
  `updateSession`.
- Dispatch isolation per session (`Promise.allSettled` + per-session `dispatchError`), re-entrancy
  guard, `unref()`'d auto-dispatch timer.
- Library-agnostic builders for 1.6 / 2.0.1 / 2.1 (incl. V2G `dischargeLimit`) with correct
  version differences (`chargingProfileId` vs `id`, schedule object vs array, string transactionId).
- 73 tests across 23 suites incl. redistribution, starvation, TOU timezone, custom strategies.

## Verification evidence

- `npx vitest run` → 73/73 passing; `tsc --noEmit` clean; dist ships CJS+ESM+d.ts for all 3 entries.
- H1 reproduced: process crash on first auto-dispatch tick with throwing strategy, no listener.
- H2 reproduced: `clearDispatch(0)` dispatched clears for transactionIds `0` **and** `1`.
- M1 reproduced: 3 uncapped sessions on a 95 kW effective grid → `requestedKw: 95.01`,
  `gridOverCommitted` fired with `feasible: true` (final allocations correct at 31.66 × 3).
