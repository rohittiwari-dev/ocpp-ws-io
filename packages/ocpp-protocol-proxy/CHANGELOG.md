# Changelog

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
