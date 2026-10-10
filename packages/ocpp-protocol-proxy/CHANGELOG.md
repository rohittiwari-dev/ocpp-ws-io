# Changelog

## 0.3.0

### Minor Changes

- **Deprecated: the proxy now ships in `ocpp-ws-io` as `ocpp-ws-io/proxy`**, with `/proxy/presets` and `/proxy/adapters`. This release only re-exports them from `ocpp-ws-io` (`^3.1.0-beta.1`), so existing imports keep working; new features and fixes ship in `ocpp-ws-io`. Move with `npm install ocpp-ws-io@beta` and the new import paths (see the README).
- **`import` and the `./presets` and `./adapters` subpaths work.** 0.2.1 built only an ESM `dist/index.js`, so `import "ocpp-protocol-proxy"` and both subpaths failed with `ERR_MODULE_NOT_FOUND`; this release ships CJS and ESM for all three.
- **Typed translation maps.** A key names a protocol and an action the types know (`"ocpp1.6:BootNotification"`), so a misspelt key is a compile error, and each mapper's params are that action's request or response. A payload is a `ProxyPayload` (a JSON object); a session store holds `ProxyValue`s instead of `any`.
- **Remote start and stop from a 2.x CSMS are translated.** The core preset kept them under `ocpp2.1:RemoteStartTransaction` and `ocpp2.1:RemoteStopTransaction`, but 2.x names them `RequestStartTransaction` and `RequestStopTransaction`, so they reached the charger untranslated.
- The firmware preset no longer falls back to a top-level `location` or `retrieveDate`, which a 2.x `UpdateFirmware` request does not have.

## 0.2.1

### Patch Changes

- **Requires `ocpp-ws-io` 3.0.0** (`^3.0.0`, was `^2.3.2`). The adapter forwards each translated action with `unchecked()`, which 3.0 added: 3.0's typed calls take only actions their protocols declare, and a proxy forwards actions it only knows at runtime.
- **Requires Node.js 20 or later** (`engines` was `>=18.0.0`), the same floor as `ocpp-ws-io` 3.0.0; Node 18 reached end of life in April 2025. The build now targets Node 20.

## 0.2.0

### Minor Changes

- **`ocpp-ws-io` dependency range is now `^2.3.2`** (was `*`), so a future major release of `ocpp-ws-io` is not installed without a matching proxy release.

## 0.1.1

### Patch Changes

- Initial release: transport-agnostic OCPP version translation proxy (1.6 ↔ 2.1) with pluggable middleware, stateful sessions, and spec-compliant presets.

All notable changes to `ocpp-protocol-proxy` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-03-19

### Added

**Core proxy**

- `OCPPProtocolProxy` class — transport-agnostic OCPP version translation proxy
- `translate()` — register translation maps (layer multiple presets)
- `listenOnAdapter()` — attach any `ITransportAdapter` for incoming connections
- `close()` — graceful shutdown of all connections and adapters

**Translation engine**

- `OCPPTranslator` — pure translation engine with upstream, downstream, response, and error mappings
- `TranslationMap` type — keyed by `sourceProtocol:Action` for upstream and `targetProtocol:Action` for downstream
- `TranslationResult` — action renaming + payload rewriting in a single return
- Async mapper support — use session store for stateful translations

**Middleware pipeline**

- `ProxyMiddleware` type — intercept messages at 4 lifecycle points (pre/post × upstream/downstream/response/error)
- Sequential execution with message mutation support
- Built-in `TelemetryMiddleware` for latency tracking

**Session store**

- `ISessionStore` interface — pluggable state management for correlated messages
- `InMemorySessionStore` — default implementation for single-instance deployments
- Transaction ID mapping (1.6 integer ↔ 2.1 UUID) across correlated messages

**Presets — all 28 OCPP 1.6 messages covered**

- `corePreset` — Core profile (16 messages): BootNotification, Authorize, Start/StopTransaction→TransactionEvent, MeterValues, StatusNotification, RemoteStart/Stop, ChangeAvailability, Reset, UnlockConnector, TriggerMessage, Heartbeat
- `smartChargingPreset` — Smart Charging (3 messages): SetChargingProfile, ClearChargingProfile, GetCompositeSchedule
- `firmwarePreset` — Firmware Management (4 messages): UpdateFirmware, FirmwareStatusNotification, GetLog→GetDiagnostics, LogStatusNotification
- `reservationPreset` — Reservation (2 messages): ReserveNow, CancelReservation
- `localAuthPreset` — Local Auth List (2 messages): GetLocalListVersion, SendLocalList
- `presets.ocpp16_to_ocpp21` — combined preset merging all profiles
- `mergePresets()` utility for composing custom preset combinations
- Status enum mapping tables (1.6 ↔ 2.1) for StatusNotification and error codes

**Transport adapters**

- `ITransportAdapter` / `IConnection` interfaces — bring-your-own transport
- `OcppWsIoAdapter` — WebSocket adapter via `ocpp-ws-io`

**Events**

- `connection`, `disconnect` — client lifecycle
- `translationError`, `middlewareError` — error isolation without crashes

**Package setup**

- ESM + CJS dual build via `tsup`
- TypeScript strict mode
- Subpath exports: `ocpp-protocol-proxy/presets`, `ocpp-protocol-proxy/adapters`
- Comprehensive Vitest test suite (39 tests across 5 files)
- Full npm discovery metadata (keywords, exports map, homepage, repository)

---

[0.1.0]: https://github.com/rohittiwari-dev/ocpp-ws-io/releases/tag/ocpp-protocol-proxy-v0.1.0
