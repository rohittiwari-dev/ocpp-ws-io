<p align="center">
  <img src="https://raw.githubusercontent.com/rohittiwari-dev/ocpp-ws-io/main/assets/ocpp-protocol-proxy.png" alt="ocpp-protocol-proxy" width="420" />
</p>


**Transport-agnostic OCPP version translation proxy** — translate any OCPP version to any other, with pluggable middleware, stateful session management, and spec-compliant presets.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

Part of the [ocpp-ws-io](https://ocpp-ws-io.rohittiwari.me) ecosystem.

> **⚠️ Deprecated: the protocol proxy now ships in [`ocpp-ws-io`](https://www.npmjs.com/package/ocpp-ws-io), as `ocpp-ws-io/proxy`.**
> This package's last release only re-exports it, so existing imports keep working, but new features and fixes ship in `ocpp-ws-io`. Move to:
>
> ```bash
> npm uninstall ocpp-protocol-proxy
> npm install ocpp-ws-io@beta
> ```
>
> It ships in `ocpp-ws-io` from 3.1.0, on npm's `beta` tag until 3.1.0 is released, hence `@beta`.
>
> | Before | Now |
> |:---|:---|
> | `from "ocpp-protocol-proxy"` | `from "ocpp-ws-io/proxy"` |
> | `from "ocpp-protocol-proxy/presets"` | `from "ocpp-ws-io/proxy/presets"` |
> | `from "ocpp-protocol-proxy/adapters"` | `from "ocpp-ws-io/proxy/adapters"` |
>
> The API is the same, with stricter types: a translation map is keyed by `protocol:Action`, so a misspelt key or a wrong field is a compile error. The examples below use the new imports.

---

## Why?

Legacy OCPP 1.6 charge points can't speak to modern OCPP 2.1 central systems. Instead of rewriting firmware or maintaining dual-protocol backends, drop a translation proxy in between.

```
┌─────────┐     OCPP 1.6      ┌───────────┐     OCPP 2.1      ┌──────┐
│  EVSE   │ ───────────────── │   PROXY   │ ───────────────── │ CSMS │
│  (1.6)  │                   │ (translate)│                   │(2.1) │
└─────────┘                   └───────────┘                   └──────┘
```

## Features

- ⚡ **Any-to-any translation** — 1.6 ↔ 2.0.1 ↔ 2.1
- 🔌 **Transport agnostic** — Core logic doesn't depend on WebSockets or Node.js
- 🧩 **Modular presets** — Import only the OCPP profiles you need
- 🔗 **Middleware pipeline** — Pre/post translation hooks for logging, validation, telemetry
- 💾 **Stateful sessions** — UUID ↔ integer transaction ID mapping across messages
- 📊 **Built-in telemetry** — Latency tracking middleware included
- ✅ **All 28 OCPP 1.6 messages** — Complete Core + optional profiles mapped to 2.1

## Install

```bash
npm install ocpp-ws-io@beta
```

## Quick Start

### Basic Usage with Presets

```typescript
import { OCPPProtocolProxy, presets, OcppWsIoAdapter } from "ocpp-ws-io/proxy";

const proxy = new OCPPProtocolProxy({
  upstreamEndpoint: "ws://your-csms:9000",
  upstreamProtocol: "ocpp2.1",
});

// Load all OCPP 1.6 → 2.1 translation presets
proxy.translate(presets.ocpp16_to_ocpp21);

const adapter = new OcppWsIoAdapter({
  port: 9001,
  protocols: ["ocpp1.6"],
});

await proxy.listenOnAdapter(adapter);
```

### Custom Overrides

Use presets as a base and override specific actions:

```typescript
proxy.translate({
  upstream: {
    ...presets.ocpp16_to_ocpp21.upstream,

    // Override with custom business logic
    "ocpp1.6:StartTransaction": async (params, ctx) => {
      console.log(`Custom StartTx for ${ctx.identity}`, params);
      return {
        action: "TransactionEvent",
        payload: { /* your custom 2.1 mapping */ },
      };
    },
  },
  downstream: { ...presets.ocpp16_to_ocpp21.downstream },
  responses: { ...presets.ocpp16_to_ocpp21.responses },
  errors: { ...presets.ocpp16_to_ocpp21.errors },
});
```

## Selective Presets

Import only the OCPP profiles you need for tree-shaking:

```typescript
import {
  corePreset,
  smartChargingPreset,
  firmwarePreset,
  reservationPreset,
  localAuthPreset,
} from "ocpp-ws-io/proxy";
```

| Preset | Profile | Messages |
|:---|:---|:---|
| `corePreset` | Core (mandatory) | 16: Boot, Auth, Start/Stop Tx, MeterValues, StatusNotification, Reset, Unlock, TriggerMessage, and more |
| `smartChargingPreset` | Smart Charging | SetChargingProfile, ClearChargingProfile, GetCompositeSchedule |
| `firmwarePreset` | Firmware Mgmt | UpdateFirmware, FirmwareStatusNotification, GetLog→GetDiagnostics |
| `reservationPreset` | Reservation | ReserveNow, CancelReservation |
| `localAuthPreset` | Local Auth List | GetLocalListVersion, SendLocalList |

## Middleware

Intercept messages before or after translation:

```typescript
import type { ProxyMiddleware } from "ocpp-ws-io/proxy";

const logger: ProxyMiddleware = async (message, context, direction, phase) => {
  console.log(`[${phase}] ${direction} — ${context.identity}`, message);
  return undefined; // pass through unchanged
};

const proxy = new OCPPProtocolProxy({
  upstreamEndpoint: "ws://csms:9000",
  upstreamProtocol: "ocpp2.1",
  middlewares: [logger],
});
```

Middleware runs at 4 lifecycle points:
| Phase | Direction | When |
|:---|:---|:---|
| `pre` | `upstream` | Before translating EVSE→CSMS calls |
| `post` | `upstream` | After translating, before forwarding to CSMS |
| `pre` | `response` | Before translating CSMS response back |
| `post` | `response` | After translating, before returning to EVSE |

## Custom Session Store

The default `InMemorySessionStore` works for single-instance deployments. For clustered setups, implement `ISessionStore`:

```typescript
import type { ISessionStore, ProxyValue } from "ocpp-ws-io/proxy";

class RedisSessionStore implements ISessionStore {
  async set(identity: string, key: string, value: ProxyValue) { /* ... */ }
  async get<T extends ProxyValue = ProxyValue>(identity: string, key: string): Promise<T | undefined> { /* ... */ }
  async delete(identity: string, key: string) { /* ... */ }
  async clear(identity: string) { /* ... */ }
}
```

## Events

```typescript
proxy.on("connection", (identity, protocol) => { /* EVSE connected */ });
proxy.on("disconnect", (identity) => { /* EVSE disconnected */ });
proxy.on("translationError", (err, msg, ctx) => { /* translation failed */ });
proxy.on("middlewareError", (err, msg, ctx) => { /* middleware threw */ });
```

## Architecture

In [`ocpp-ws-io`](https://github.com/rohittiwari-dev/ocpp-ws-io/tree/main/packages/ocpp-ws-io/src/proxy):

```
src/proxy/
├── core/
│   ├── types.ts          # OCPPMessage, TranslationMap, ITransportAdapter
│   ├── translator.ts     # Pure translation engine
│   └── session.ts        # ISessionStore + InMemorySessionStore
├── presets/
│   ├── index.ts          # Merged preset + mergePresets utility
│   ├── core.ts           # Core profile (16 messages)
│   ├── smart-charging.ts # Smart Charging (3 messages)
│   ├── firmware.ts       # Firmware Management (4 messages)
│   ├── reservation.ts    # Reservation (2 messages)
│   ├── local-auth.ts     # Local Auth List (2 messages)
│   └── status-enums.ts   # StatusNotification enum mapping tables
├── adapters/
│   └── ocpp-ws-io.adapter.ts  # WebSocket adapter using ocpp-ws-io
├── middlewares/
│   └── telemetry.ts      # Latency tracking middleware
├── proxy.ts              # OCPPProtocolProxy orchestrator
└── index.ts              # Public API
```

## Related Packages

| Package | Description |
|:---|:---|
| [ocpp-ws-io](https://npmjs.com/ocpp-ws-io) | Core OCPP WebSocket RPC client & server, and this proxy as `ocpp-ws-io/proxy` |
| [ocpp-ws-io CLI](https://ocpp-ws-io.rohittiwari.me/docs/cli) | The `ocpp` command for simulation & testing, in `ocpp-ws-io` |
| [voltlog-io](https://npmjs.com/voltlog-io) | Structured logger |

## License

[MIT](../../LICENSE) © 2026 Rohit Tiwari
