<p align="center">
  <img src="https://raw.githubusercontent.com/rohittiwari-dev/ocpp-ws-io/main/assets/ocpp-smart-engine.png" alt="ocpp-smart-charge-engine" width="420" />
</p>

<p align="center">
Library-agnostic OCPP smart charging constraint solver for EV charge point operators.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ocpp-smart-charge-engine">
    <img src="https://img.shields.io/npm/v/ocpp-smart-charge-engine.svg?style=flat-square&color=cb3837" alt="npm version" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License: MIT" />
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

---

## What is this?

`ocpp-smart-charge-engine` solves one problem: **how to distribute your site's grid power fairly and safely among EV chargers** using OCPP's `SetChargingProfile` command.

It is **completely library-agnostic**. It does not care whether you use `ocpp-ws-io`, raw WebSockets, or any other OCPP implementation. You supply a `dispatcher` callback, and the engine calls it with the computed charging profile — what you do inside the callback is entirely up to you.

> **Note on Charger Compatibility**
> `SetChargingProfile` is part of the OCPP 1.6 Smart Charging optional feature profile and is mandatory in OCPP 2.0.1. If a charger rejects the command (e.g., older hardware without Smart Charging support), your dispatcher should catch the error. The engine handles this gracefully — it emits a `'dispatchError'` event for the failing session and **continues dispatching to all other sessions**.

---

## Documentation

| Guide | Description |
|---|---|
| [Grid & Load Management](https://ocpp-ws-io.rohittiwari.me/docs/smart-charge-engine/grid-and-load-management) | Multi-panel sites, mixed fleets, hierarchical grid, OCPP profile types |
| [ocpp-ws-io + Express Example](https://ocpp-ws-io.rohittiwari.me/docs/smart-charge-engine/express-integration) | Full CSMS integration — correct API usage, REST admin endpoints, auto-dispatch |
| [Charging Strategies](https://ocpp-ws-io.rohittiwari.me/docs/smart-charge-engine/strategies) | Equal Share, Priority, Time-of-Use, runtime swap, custom strategy |
| [Database-Driven Config](https://ocpp-ws-io.rohittiwari.me/docs/smart-charge-engine/database-config) | Store panel/charger config in DB — engine registry, hot-reload, charger reassignment |

---

## Install

```bash
npm install ocpp-smart-charge-engine
```

---

## Quick Start

```typescript
import { SmartChargingEngine, Strategies } from "ocpp-smart-charge-engine";
import { buildOcpp16Profile } from "ocpp-smart-charge-engine/builders";

const engine = new SmartChargingEngine({
  siteId: "SITE-HQ-001",
  maxGridPowerKw: 100, // 100kW grid connection
  safetyMarginPct: 5, // Use max 95kW, leave 5% buffer
  algorithm: Strategies.EQUAL_SHARE,

  // The ONLY integration point — use whatever OCPP library you have.
  // `sessionProfile` contains raw numbers (kW, W, A).
  // Use the builder helpers to convert to the correct OCPP version shape.
  dispatcher: async ({
    clientId,
    connectorId,
    transactionId,
    sessionProfile,
  }) => {
    await server.safeSendToClient(clientId, "ocpp1.6", "SetChargingProfile", {
      connectorId,
      csChargingProfiles: buildOcpp16Profile(sessionProfile),
    });
  },

  // Optional: send ClearChargingProfile when sessions end
  clearDispatcher: async ({ clientId, connectorId }) => {
    await server.safeSendToClient(clientId, "ocpp1.6", "ClearChargingProfile", {
      connectorId,
      chargingProfilePurpose: "TxProfile",
      stackLevel: 0,
    });
  },
  autoClearOnRemove: true, // auto-clear when removeSession() is called
});

// When a car connects (from your OCPP StartTransaction handler)
engine.addSession({
  transactionId: payload.transactionId,
  clientId: client.identity,
  connectorId: payload.connectorId,
  maxHardwarePowerKw: 22, // Charger max hardware rating
  minChargeRateKw: 1.4, // Minimum — prevents EV faulting on low power
});

// Recalculate and dispatch profiles to all active chargers
await engine.dispatch();

// Auto-dispatch every 60s (useful for TIME_OF_USE tariffs)
engine.startAutoDispatch(60_000);

// When a car leaves — also sends ClearChargingProfile (autoClearOnRemove)
engine.removeSession(payload.transactionId);
await engine.dispatch(); // Redistribute power to remaining sessions
```

---

## Library-Agnostic Dispatcher Examples

The dispatcher receives a `sessionProfile` with raw calculated numbers.
Use the builder helpers from `ocpp-smart-charge-engine/builders` to convert to
the correct OCPP version-specific shape. **Schemas differ between versions** —
that's exactly why the engine doesn't build the profile itself.

### With `ocpp-ws-io` — OCPP 1.6

```typescript
import { buildOcpp16Profile } from "ocpp-smart-charge-engine/builders";

dispatcher: async ({
  clientId,
  connectorId,
  transactionId,
  sessionProfile,
}) => {
  await server.safeSendToClient(
    clientId,
    "ocpp1.6",
    "SetChargingProfile",
    {
      connectorId,
      csChargingProfiles: buildOcpp16Profile(sessionProfile),
    },
    { idempotencyKey: `profile-${transactionId}` },
  );
};
```

### With `ocpp-ws-io` — OCPP 2.0.1 / 2.1

```typescript
import { buildOcpp201Profile } from "ocpp-smart-charge-engine/builders";

dispatcher: async ({
  clientId,
  connectorId,
  transactionId,
  sessionProfile,
}) => {
  await server.safeSendToClient(
    clientId,
    "ocpp2.0.1",
    "SetChargingProfile",
    {
      evseId: connectorId, // NOTE: connectorId → evseId in 2.0.1
      chargingProfile: buildOcpp201Profile(sessionProfile),
    },
    { idempotencyKey: `profile-${transactionId}` },
  );
};
```

### Mixed fleet (some 1.6, some 2.0.1)

```typescript
import {
  buildOcpp16Profile,
  buildOcpp201Profile,
} from "ocpp-smart-charge-engine/builders";

const protocolMap = new Map<string, "ocpp1.6" | "ocpp2.0.1">(); // populated on connect

dispatcher: async ({
  clientId,
  connectorId,
  transactionId,
  sessionProfile,
}) => {
  const protocol = protocolMap.get(clientId) ?? "ocpp1.6";

  if (protocol === "ocpp1.6") {
    await server.safeSendToClient(clientId, "ocpp1.6", "SetChargingProfile", {
      connectorId,
      csChargingProfiles: buildOcpp16Profile(sessionProfile),
    });
  } else {
    await server.safeSendToClient(clientId, "ocpp2.0.1", "SetChargingProfile", {
      evseId: connectorId,
      chargingProfile: buildOcpp201Profile(sessionProfile),
    });
  }
};
```

### With raw WebSocket

```typescript
import { buildOcpp16Profile } from "ocpp-smart-charge-engine/builders";

dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
  const ws = wsMap.get(clientId);
  ws?.send(
    JSON.stringify([
      2,
      crypto.randomUUID(),
      "SetChargingProfile",
      {
        connectorId,
        csChargingProfiles: buildOcpp16Profile(sessionProfile),
      },
    ]),
  );
};
```

---

## ClearChargingProfile

When a car leaves or you want to remove throttling, you need to send `ClearChargingProfile`. The engine handles this via `clearDispatcher`.

### Auto-clear on session removal

```typescript
const engine = new SmartChargingEngine({
  // ...
  clearDispatcher: async ({ clientId, connectorId }) => {
    // OCPP 1.6
    await server.safeSendToClient(clientId, "ocpp1.6", "ClearChargingProfile", {
      connectorId,
      chargingProfilePurpose: "TxProfile",
      stackLevel: 0,
    });
    // OCPP 2.0.1
    // await server.safeSendToClient(clientId, "ocpp2.0.1", "ClearChargingProfile", {
    //   chargingProfileCriteria: { evseId: connectorId, chargingProfilePurpose: "TxProfile" },
    // });
  },
  autoClearOnRemove: true, // fires clearDispatcher automatically on removeSession()
});
```

### Manual clear

```typescript
await engine.clearDispatch(); // clear ALL active sessions
await engine.clearDispatch(42); // clear only transactionId 42
```

---

## Auto-Dispatch

Instead of manually calling `engine.dispatch()` after every event, use auto-dispatch for periodic recalculation. Ideal for `TIME_OF_USE` strategies that change power limits throughout the day.

```typescript
// Recalculate and push profiles every 60 seconds
engine.startAutoDispatch(60_000);

// Fires only when sessions are active (no-op when no cars connected)
engine.on("dispatched", (profiles) => {
  console.log(`Auto-dispatched ${profiles.length} profiles`);
});

// Stop when shutting down
engine.stopAutoDispatch();

// Check if running
console.log(engine.config.autoDispatchActive); // true | false
```

---

## Minimum Charge Rate (`minChargeRateKw`)

Some EVs and heat pumps fault if power drops below a minimum threshold. Set `minChargeRateKw` per session to guarantee a floor.

```typescript
engine.addSession({
  transactionId: 1,
  clientId: "CP-001",
  minChargeRateKw: 1.4, // 6A × 230V = 1.38kW — IEC 61851 minimum
});
// Even under extreme grid pressure, this session receives at least 1.4kW.
// The value is also written into chargingSchedule.minChargingRate in the profile.
```

---

## Strategies

### `EQUAL_SHARE` (default)

Divides available grid power equally among all active sessions. Each session is additionally capped by `maxHardwarePowerKw` and `maxEvAcceptancePowerKw`.

```typescript
// 3 cars, 100kW grid, 5% margin = 95kW effective
// Each car gets: 95 / 3 = 31.67 kW
```

### `PRIORITY`

Allocates power proportionally to each session's `priority` value (higher number = more power).

```typescript
engine.addSession({ transactionId: 1, clientId: "CP-001", priority: 8 }); // → 80kW
engine.addSession({ transactionId: 2, clientId: "CP-002", priority: 2 }); // → 20kW
// Total: 100kW
```

### `TIME_OF_USE`

Reduces grid usage during configured peak pricing windows. Works best with `startAutoDispatch()`.

```typescript
const engine = new SmartChargingEngine({
  algorithm: Strategies.TIME_OF_USE,
  timeOfUseWindows: [
    { peakStartHour: 18, peakEndHour: 22, peakPowerMultiplier: 0.5 }, // 50% during 6–10pm
  ],
  // ...
});
engine.startAutoDispatch(60_000); // recalculate every minute
// At 7pm: effectiveGrid = 100 * 0.5 = 50kW, divided equally
// At 2pm: effectiveGrid = 100kW, divided equally
```

---

## Builders — `ocpp-smart-charge-engine/builders`

Version-specific helpers to convert raw `SessionProfile` numbers into the correct OCPP `SetChargingProfile` payload.

| Helper                  | OCPP Version | Field name in payload | `chargingSchedule` shape |
| ----------------------- | ------------ | --------------------- | ------------------------ |
| `buildOcpp16Profile()`  | 1.6          | `csChargingProfiles`  | single object            |
| `buildOcpp201Profile()` | 2.0.1        | `chargingProfile`     | **array**                |
| `buildOcpp21Profile()`  | 2.1          | `chargingProfile`     | **array** + V2G fields   |

**Why the difference?** OCPP 2.0.1 made `chargingSchedule` an array, renamed `chargingProfileId` → `id`, and changed `transactionId` from `integer` to `string`. OCPP 2.1 adds `dischargeLimit` for V2G (Vehicle-to-Grid).

### Builder options (all three accept these)

```typescript
buildOcpp16Profile(sessionProfile, {
  stackLevel: 0,
  purpose: "TxProfile", // "TxProfile" | "TxDefaultProfile" | "ChargePointMaxProfile"
  rateUnit: "W", // "W" | "A"
  numberPhases: 3,

  // Multi-period schedule — overrides the calculated single-period
  periods: [
    { startPeriod: 0, limit: 22000, numberPhases: 3 }, // 22kW for first 2h
    { startPeriod: 7200, limit: 7000, numberPhases: 3 }, // 7kW after 2h
  ],
});
```

### OCPP 2.1 — V2G Discharge

```typescript
import { buildOcpp21Profile } from "ocpp-smart-charge-engine/builders";

dispatcher: async ({ clientId, connectorId, sessionProfile }) => {
  await server.safeSendToClient(clientId, "ocpp2.1", "SetChargingProfile", {
    evseId: connectorId,
    chargingProfile: buildOcpp21Profile(sessionProfile, {
      dischargeLimitW: 7400, // Allow 7.4kW V2G discharge (ISO 15118-20)
    }),
  });
};
```

---

## API Reference

### `new SmartChargingEngine(config)`

| Option              | Type                        | Default       | Description                             |
| ------------------- | --------------------------- | ------------- | --------------------------------------- |
| `siteId`            | `string`                    | required      | Human-readable site identifier          |
| `maxGridPowerKw`    | `number`                    | required      | Maximum site grid power in kW           |
| `dispatcher`        | `ChargingProfileDispatcher` | required      | Your OCPP send function                 |
| `clearDispatcher`   | `ClearProfileDispatcher`    | —             | Optional: sends `ClearChargingProfile`  |
| `autoClearOnRemove` | `boolean`                   | `false`       | Auto-clear profile on `removeSession()` |
| `algorithm`         | `Strategy`                  | `EQUAL_SHARE` | Allocation strategy                     |
| `safetyMarginPct`   | `number`                    | `5`           | Power held in reserve (%)               |
| `phases`            | `1 \| 3`                    | `3`           | AC phase count for the site             |
| `voltageV`          | `number`                    | `230`         | Grid voltage for amps calculation       |
| `timeOfUseWindows`  | `TimeOfUseWindow[]`         | `[]`          | Peak windows (TIME_OF_USE only)         |
| `debug`             | `boolean`                   | `false`       | Enable verbose console logging          |

### `addSession(session)` options

| Option                   | Type             | Default | Description                                               |
| ------------------------ | ---------------- | ------- | --------------------------------------------------------- |
| `transactionId`          | `number\|string` | req.    | OCPP transaction ID                                       |
| `clientId`               | `string`         | req.    | Charging station identity                                 |
| `connectorId`            | `number`         | `1`     | Connector / EVSE ID                                       |
| `maxHardwarePowerKw`     | `number`         | `∞`     | Charger hardware limit (upper cap)                        |
| `maxEvAcceptancePowerKw` | `number`         | `∞`     | EV acceptance limit (upper cap)                           |
| `minChargeRateKw`        | `number`         | `0`     | Minimum power floor — prevents EV faults                  |
| `priority`               | `number`         | `1`     | Session priority (PRIORITY strategy only)                 |
| `phases`                 | `1 \| 3`         | site    | Phase count for this connector                            |
| `metadata`               | `object`         | —       | Arbitrary data (RFID, tariff ID, etc.) — stored, not used |

### Methods

| Method                    | Description                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `addSession(session)`     | Register a session. Throws `DuplicateSessionError` if already exists                     |
| `removeSession(txId)`     | Remove a session. Throws `SessionNotFoundError` if not found                             |
| `safeRemoveSession(txId)` | Remove without throwing — returns `undefined` if not found                               |
| `optimize()`              | Calculate profiles **without** dispatching. Returns `SessionProfile[]`                   |
| `dispatch()`              | Calculate profiles **and** call dispatcher for each. Returns `Promise<SessionProfile[]>` |
| `clearDispatch(txId?)`    | Send `ClearChargingProfile` to one or all sessions. No-op if no `clearDispatcher`        |
| `startAutoDispatch(ms)`   | Start periodic dispatch every `ms` milliseconds (min 1000ms)                             |
| `stopAutoDispatch()`      | Stop the auto-dispatch interval                                                          |
| `setGridLimit(kw)`        | Update grid limit at runtime                                                             |
| `setAlgorithm(strategy)`  | Hot-swap algorithm at runtime                                                            |
| `setSafetyMargin(pct)`    | Update safety margin at runtime                                                          |
| `getSessions()`           | Read-only array of active sessions                                                       |
| `isEmpty()`               | Returns `true` when no sessions are registered                                           |

### Events

| Event                 | Payload                            | Fired when                                 |
| --------------------- | ---------------------------------- | ------------------------------------------ |
| `sessionAdded`        | `ActiveSession`                    | A session is registered                    |
| `sessionRemoved`      | `ActiveSession`                    | A session is removed                       |
| `optimized`           | `SessionProfile[]`                 | After `optimize()` completes               |
| `dispatched`          | `SessionProfile[]`                 | After all dispatcher calls settle          |
| `dispatchError`       | `DispatchErrorEvent`               | A dispatcher call throws; engine continues |
| `cleared`             | `ClearDispatchPayload`             | After a `clearDispatcher` call succeeds    |
| `clearError`          | `ClearDispatchPayload & { error }` | A `clearDispatcher` call throws            |
| `autoDispatchStarted` | `number` (intervalMs)              | After `startAutoDispatch()` is called      |
| `autoDispatchStopped` | —                                  | After `stopAutoDispatch()` is called       |
| `error`               | `Error`                            | A strategy function throws                 |

---

## License

MIT © 2026 Rohit Tiwari
