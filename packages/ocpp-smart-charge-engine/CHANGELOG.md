# Changelog

All notable changes to `ocpp-smart-charge-engine` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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

[Unreleased]: https://github.com/rohittiwari-dev/ocpp-smart-charge-engine/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha]: https://github.com/rohittiwari-dev/ocpp-smart-charge-engine/releases/tag/v0.1.0-alpha
