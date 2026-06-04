# Changelog

## [0.2.0] — 2026-06-04

A major correctness, safety, and capability release. The allocator is now a true
constraint solver (headroom redistribution), grid-safety is guaranteed end-to-end,
inputs are validated, and several long-requested features ship. Backward compatible
at the API level; allocation **outputs** change because the grid is now fully
utilized (see "Changed").

### Added

- **In-place session updates** — `updateSession(txId, patch)` changes a session's
  parameters without `remove`+`add`. Preserves `addedAt`, keeps `transactionId`/
  `clientId` immutable, validates the result, and does **not** trigger
  `autoClearOnRemove`. Emits `sessionUpdated`.
- **Persistence** — `getSnapshot()` returns a JSON-serializable copy of all
  sessions (incl. `addedAt`); `loadSnapshot(sessions, { clear })` restores them
  after a restart. Validation runs up front, so a bad entry throws **before**
  anything is applied (atomic). Emits `snapshotLoaded`.
- **Custom strategies** — `algorithm` and `setAlgorithm()` now accept a
  `StrategyFn` in addition to the built-in `Strategy` names; `config.algorithm`
  reports `"CUSTOM"`. Strategy functions receive a `StrategyContext { voltageV }`.
- **`getSession(txId)`** — single-session read returning a copy (or `undefined`).
- **Time-of-Use timezone** — `timeOfUseTimezone` (IANA) evaluates peak windows in
  the site's local time instead of the server's.
- **Split-phase support** — `phases` widened to `1 | 2 | 3` (e.g. US-240 V
  split-phase), with correct amps-per-phase math.
- **`gridOverCommitted` event** — fires when the per-session minimum floors exceed
  the grid; carries `feasible` and a `starvedSessions[]` list naming exactly which
  sessions were scaled below their `minChargeRateKw`.
- **`config.timeOfUseWindows`** is now exposed (as a defensive copy) in the
  `config` snapshot.
- **New exported types** — `SessionUpdate`, `StarvedSession`, `GridOverCommitInfo`,
  `StrategyContext`.

### Changed

- **Headroom redistribution (water-filling)** — `EQUAL_SHARE`, `PRIORITY`, and
  `TIME_OF_USE` now redistribute power a capped session cannot use to the
  remaining sessions, fully utilizing the grid. Previously the surplus from a
  capped session was wasted (single-pass divide). Allocation outputs change
  accordingly; the total still never exceeds the grid and no session exceeds its
  caps.
- **`voltageV` is now honored** in the amps-per-phase calculation (it was
  effectively hardcoded to 230 V before). Sites on 400 V / 120 V / 208 V now get
  correct amperage.
- **`SessionProfile`** now includes `phases` and `voltageV` fields.
- Strategy functions now receive a third `StrategyContext` argument.

### Fixed

- **Grid limit could be exceeded** by `minChargeRateKw` floors — a final
  grid-budget guard now guarantees `Σ allocated ≤ effective grid` and emits
  `gridOverCommitted` when it has to scale down.
- **Minimum floor could override the hardware/EV cap** — the floor is now clamped
  to the caps; a session never receives more than its hardware can deliver.
- **`PRIORITY` produced `NaN`** when all priorities were 0 — now falls back to an
  equal split.
- **`addSession()` did not validate inputs** — negative / `NaN` / non-finite
  `maxHardwarePowerKw`, `maxEvAcceptancePowerKw`, `minChargeRateKw`, `priority`,
  and `connectorId` are now rejected with `SmartChargingConfigError` (so negative
  or `NaN` power limits can no longer reach a charger).
- **`getSessions()` leaked mutable internal references** — it (and `getSession()`)
  now return copies, honoring the documented read-only contract.
- **`setAlgorithm("TIME_OF_USE")` threw at runtime** — the constructor's
  `timeOfUseWindows` are now retained and reused.
- **Auto-dispatch timer kept the process alive** — it is now `unref()`'d.
- **`dispatch()` had no overlap guard** — concurrent calls now coalesce onto the
  in-flight run, preventing interleaved / out-of-order `SetChargingProfile` sends.
- **Negative `minChargeRateKw`** is clamped to 0; Time-of-Use windows are validated
  (multiplier 0–1, hours 0–23); `voltageV` and `phases` are validated.

### Internal

- Removed a dead `profileIdCounter` field.
- Test suite expanded to **73** tests covering all of the above.

## 0.1.2

### Patch Changes

- Stable 0.1.1 release. Migrated documentation from the package `docs/` folder to the ecosystem docs site (`ocpp-ws-io.rohittiwari.me`), updated README links, and finalized core API.

All notable changes to `ocpp-smart-charge-engine` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.1] — 2026-03-19

### Changed

- Documentation migrated from package `docs/` folder to the ecosystem docs site at `ocpp-ws-io.rohittiwari.me`
- README documentation table links updated to point to the docs site

### Fixed

- Package version promoted from `0.1.0-alpha` to stable `0.1.1`

---

## [0.1.0-alpha] — 2026-03-12

### Added

**Core engine**

- `SmartChargingEngine` class — library-agnostic OCPP smart charging constraint solver
- `addSession()` / `removeSession()` / `safeRemoveSession()` — session lifecycle management
- `optimize()` — pure calculation without dispatch, returns `SessionProfile[]`
- `dispatch()` — calculate + call user dispatcher with per-session error isolation
- `setGridLimit()`, `setAlgorithm()`, `setSafetyMargin()` — runtime configuration updates
- `getSessions()`, `isEmpty()`, `sessionCount`, `config` (getter) — inspection API

**Allocation strategies**

- `EQUAL_SHARE` — divides grid power equally among all active sessions
- `PRIORITY` — weighted allocation by session `priority` field
- `TIME_OF_USE` — reduces power during configured peak pricing windows

**ClearChargingProfile support**

- `clearDispatcher` config option — send `ClearChargingProfile` to chargers
- `autoClearOnRemove` — automatically fire `clearDispatcher` when `removeSession()` is called
- `clearDispatch(txId?)` — manually clear one or all active session profiles

**Auto-dispatch**

- `startAutoDispatch(ms)` — periodic automatic dispatch (min 1000ms)
- `stopAutoDispatch()` — stop the auto-dispatch interval
- `config.autoDispatchActive` — reflect timer state

**Per-session minimum power floor**

- `minChargeRateKw` on `ChargingSession` — prevents EV faults on low power
- Enforced as a floor in all strategies via `buildSessionProfile()`
- Auto-written to `minChargingRate` in OCPP schedule by all builders

**OCPP version-specific builders** (`ocpp-smart-charge-engine/builders` subpath)

- `buildOcpp16Profile()` — OCPP 1.6 `CsChargingProfiles` shape
- `buildOcpp201Profile()` — OCPP 2.0.1 `ChargingProfile` shape (array schedule, string transactionId)
- `buildOcpp21Profile()` — OCPP 2.1 `ChargingProfile` with V2G `dischargeLimit` (ISO 15118-20)
- `periods[]` option on all builders — multi-period charging schedules
- `minChargingRate` auto-calculated from `sessionProfile.minChargeRateKw`

**Events**

- `sessionAdded`, `sessionRemoved`, `optimized`, `dispatched`, `dispatchError`
- `cleared`, `clearError` — ClearChargingProfile lifecycle
- `autoDispatchStarted`, `autoDispatchStopped` — auto-dispatch lifecycle
- `error` — strategy-level errors

**Typed errors**

- `SmartChargingConfigError`, `DuplicateSessionError`, `SessionNotFoundError`, `StrategyError`

**Build & tooling**

- CJS + ESM dual build via `tsup` (no sourcemaps for clean dist)
- TypeScript strict mode + `exactOptionalPropertyTypes`
- `ocpp-smart-charge-engine/builders` subpath export in `package.json`
- Comprehensive Vitest test suite (~40 tests across engine, strategies, and new features)

---

[0.2.0]: https://github.com/rohittiwari-dev/ocpp-smart-charge-engine/compare/v0.1.3...v0.2.0
[0.1.1]: https://github.com/rohittiwari-dev/ocpp-smart-charge-engine/compare/v0.1.0-alpha...v0.1.1
[0.1.0-alpha]: https://github.com/rohittiwari-dev/ocpp-smart-charge-engine/releases/tag/v0.1.0-alpha
