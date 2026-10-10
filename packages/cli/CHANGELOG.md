# ocpp-ws-cli

## 1.3.0

### Minor Changes

- **Deprecated: the CLI now ships in `ocpp-ws-io` as its `ocpp` command** (also named `ocpp-ws-cli`, and `ocpp-ws-io` for `npx ocpp-ws-io`). This release's binary only runs that one, from `ocpp-ws-io` (`^3.1.0-beta.1`), so existing scripts keep working; new commands and fixes ship in `ocpp-ws-io`. Move with `npm uninstall -g ocpp-ws-cli` and `npm install -g ocpp-ws-io@beta`, as both install the `ocpp` command.
- Commands and options are unchanged. `--version` reports `ocpp-ws-io`'s version, and a types file `ocpp generate` writes starts with `// Auto-generated from <schema> — DO NOT EDIT`, as `ocpp-ws-io`'s own do.
- The package's only dependency is `ocpp-ws-io`.

## 1.2.1

### Patch Changes

- **`ocpp generate` writes request and response types.** Every action came out as `{ request: Record<string, never>; response: Record<string, never> }`: the generator never kept the schemas it read, so the types were unusable. Generated types from an earlier version should be regenerated.
- **`ocpp generate` writes the validator too**, `<name>.validator.ts`: `createValidator("<protocol>", schemas)` from the same schemas as the types, for `strictModeValidators`. It compiles with `ocpp-ws-io` 2.x and 3.0.
- **SEND messages are declared.** A schema whose `$id` has no request or response suffix (`urn:VendorNotify`) is an unconfirmed message, as in OCPP 2.1: typed for `send()` and declared in `OCPPSendMethodMap`. It was written as a CALL with an empty response.
- **Open objects take any JSON keys.** An object the schema leaves open (no `additionalProperties: false`) gets an index signature, so `ocpp-ws-io`'s exact-keys check accepts what the schema allows; a field with no type is `JsonValue`, not `unknown`.
- Generation follows `ocpp-ws-io`'s own generator: tests compare the two on the OCPP 1.6, 2.0.1 and 2.1 schemas, and an end-to-end test compiles a server and client using generated files. The CLI now has a `test` script.

- **Requires Node.js 20 or later** (new `engines` field: `>=20.0.0`), the same floor as `ocpp-ws-io` 3.0.0; Node 18 reached end of life in April 2025. The build now targets Node 20.

## 1.2.0

### Minor Changes

- `ws` raised to `^8.22.0`, past the memory-exhaustion and uninitialized-memory advisories in 8.20.0 and earlier.
- Removed the unused `json-schema-to-typescript` dependency (type generation uses the built-in generator), and moved `@types/ws` to `devDependencies`. Both reduce what installing the CLI downloads.

## 1.1.3

### Patch Changes

- refactor: replace local clone-and-run workflow in `ocpp studio` with hosted simulator

  - `ocpp studio` now opens `https://ocpp.rohittiwari.me` in the default browser instead of cloning `ocpp-ws-simulator`, running `npm install`, and starting a local Next.js dev server
  - Removes `--dir`, `--skip-install`, and `--skip-dev` flags (no longer applicable)
  - Eliminates Git, Node.js storage, and memory overhead for end users
  - Updated README to reflect the new hosted-only flow

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
