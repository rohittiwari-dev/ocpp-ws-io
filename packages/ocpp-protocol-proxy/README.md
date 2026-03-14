# ocpp-protocol-proxy

A version-agnostic, generic proxy library for translating messages between different OCPP (Open Charge Point Protocol) versions (e.g. 1.6 ↔ 2.0.1 ↔ 2.1).

Built on top of `ocpp-ws-io`, this proxy allows you to connect an EVSE (Charger) running one version of OCPP to a CSMS (Central System) running another version, simply by defining a translation map.

## Features

- **Version Agnostic**: Translate from any protocol to any protocol. You define the mappings.
- **Bidirectional Mapping**: Supports translating `CALL`s and `CALLRESULT`s in both upstream (EVSE -> CSMS) and downstream (CSMS -> EVSE) directions.
- **Extensible Auto-Translation**: Comes with customizable translation preset templates for common conversions (like 1.6 to 2.1).
- **Asynchronous Handlers**: Write complex mapping logic dynamically (e.g., look up state from a database during translation).

## Installation

```sh
npm install ocpp-protocol-proxy
```

## Quick Start

```typescript
import { OCPPProtocolProxy } from 'ocpp-protocol-proxy';
import { presets } from 'ocpp-protocol-proxy/presets';

const proxy = new OCPPProtocolProxy({
  listenPort: 3001,
  listenProtocols: ['ocpp1.6'], // Accept 1.6 chargers
  upstreamEndpoint: 'wss://csms.example.com/ocpp',
  upstreamProtocol: 'ocpp2.1', // Connect to 2.1 CSMS
});

// Use automatic translations for standard flows (1.6 <-> 2.1)
// but override specific ones if needed!
proxy.translate({
  upstream: {
    ...presets.ocpp16_to_ocpp21.upstream,
    
    // Override standard mapping with custom business logic
    'ocpp1.6:StartTransaction': (params) => {
      console.log("Custom processing for StartTransaction", params);
      return {
        action: 'TransactionEvent',
        payload: { /* mapped 2.1 fields + custom defaults */ }
      };
    }
  },
  
  downstream: {
    ...presets.ocpp16_to_ocpp21.downstream,
  },

  responses: {
     ...presets.ocpp16_to_ocpp21.responses,
  }
});

// Start the proxy
proxy.listen().then(() => {
    console.log("OCPP Protocol Proxy running on port 3001");
});
```

## Architecture Flow

The proxy effectively sits in the middle acting as:
1. `OCPPServer` terminating the EVSE WebSockets (dynamic protocol negotiation)
2. `OCPPClient` initiating WebSockets upstream to the final CSMS endpoint.

```
[EVSE (1.6)]  <--->  [Proxy (1.6 -> 2.1)]  <--->  [CSMS (2.1)]
```

Calls initiated by the EVSE trigger the `upstream` translation map. Calls initiated by the CSMS trigger the `downstream` translation map.
