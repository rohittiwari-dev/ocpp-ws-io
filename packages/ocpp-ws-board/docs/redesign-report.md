# Board redesign and compatibility report

Scope: `packages/ocpp-ws-board` only. Existing core work is untouched.

## Implementation ledger

| What | Where | Why | What it adds or fixes |
|---|---|---|---|
| Charcoal operator workspace | Shell, routes, CSS | Follow supplied reference | Two-level navigation, responsive layout, light/dark themes |
| Station workspace | Connections and detail routes | Make fleet inspection actionable | Search, filters, favorites, sorting, pagination, exports, safe controls |
| Command center | Command route and board API | Expose public RPC functionality | Protocol-specific presets, JSON editor, timeout, response and bounded audit history |
| Traffic inspector | Messages | Investigate exchanges | Pause, filtering, correlation, payload inspection, JSON export |
| Diagnostics | Security, errors, system events | Surface already available observations | Searchable event records, details and exports |
| Integration status | Integrations and server APIs | Avoid pretending optional systems are active | Server stats, adapter metrics, smart-charge/proxy state |
| Typed public hooks | Plugin and src/types | Existing hook arguments are incorrect | Correct error reporting, OCPP 2.1 frames, replacement-connection fencing |
| Embedded deployment | API paths, static serving, adapters | Support mounted applications | Prefix-aware routing/assets/API/SSE and streaming cleanup |

## Direction contract
THESIS: A station operations desk, built around a dense, legible fleet table.
OWN-WORLD: Three charcoal planes, fine neutral rules, soft blue actions, mint/yellow/rose/lavender status accents, simple line icons and clear sans-serif text.
STORY: Find a station, inspect its traffic, understand failures, then issue an intentional command.
FIRST VIEWPORT: A 204px primary rail, 224px contextual rail, breadcrumb and stream status, station heading and compact toolbar, then a full-width table. Controls remain in place during refresh.
FORM: User-pinned reference; no randomized alternative. Implement the functional console directly in code. Signature interaction: selecting a station leads to correlated traffic and a preselected command target.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Verification
Pending implementation. Record exact commands and outcomes here before completion.

## Core changes
None proposed or required for the implemented scope. Public read/control APIs are sufficient. A server cannot initiate a disconnected physical station's WebSocket connection; the former reconnect endpoint must not silently impersonate a station.
