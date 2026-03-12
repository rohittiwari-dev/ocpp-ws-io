# ocpp-ws-cli

## 1.1.1

### Patch Changes

- fix: OCPP spec compliance improvements and bug fixes in simulator

  - Fix `ChangeAvailability` Inoperative to correctly set connector to `Unavailable` (not `Faulted`)
  - Add `StatusNotification` for connector 0 (charge point itself) during boot sequence per OCPP spec
  - Add `Unavailable` to connector state type union
  - Fix `StartTransaction` rejection: now sends `StopTransaction` (1.6) or `TransactionEvent(Ended)` (2.0.1) and resets to `Available` per OCPP §3.15
  - Fix `Authorize` rejection: no longer incorrectly sets connector to `Preparing` on Invalid/Expired/Blocked token
  - Fix interactive UI prompt glitching: suppress `renderDashboard` re-renders while interactive prompts are active
  - Handle OCPP 2.0.1 `RequestStartTransaction` and `RequestStopTransaction` CSMS requests
  - Handle OCPP 2.0.1 `GetVariables` and `SetVariables` using internal configuration map
  - Handle OCPP 2.0.1 `GetReport` - responds Accepted and triggers `NotifyReport`
  - Implement real `ReserveNow`/`CancelReservation` state tracking with `reservationId`
  - Fix `GetLocalListVersion` to return `{ listVersion: 1 }` instead of `{ status: "Accepted" }`
  - Track `seqNo` monotonically per transaction across all `TransactionEvent` calls

## 1.1.0

### Minor Changes

- add : simulator commands and more and also added idtag customization , meter value customization

## 1.0.4

### Patch Changes

- update: readme docs for simulator ui addition to ecosystem
-

## 1.0.3

### Patch Changes

- feat: re-enable source maps in build output for improved debugging and stack trace readability

## 1.0.2

### Patch Changes

- feat: add `ocpp bench` command — benchmark your OCPP server's throughput (msg/s) and round-trip latency with p50/p95/p99 percentile tracking, live terminal dashboard, and optional report export (json/md/txt)
- fix: disable source maps and enable treeshake in build config for smaller package size

## 1.0.1

### Patch Changes

- fix: resolve CodeQL security vulnerabilities including dynamic method call invocation issues

  fix: update CI/CD pipeline with Netlify build hooks for reliable monorepo deployments

## 1.0.0-alpha.1

### Patch Changes

- **Publish Workflow**: Added automated GitHub Actions workflow for CLI releases.
- **Documentation**: Updated CLI usage documentation and examples.
- **Linting**: Verified codebase against Biome linting standards.
