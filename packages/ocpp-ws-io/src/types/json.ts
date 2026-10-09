/** JSON values, as payloads and sessions carry them. */

/** A JSON object: OCPP params and responses on the wire. */
export type JsonObject = { [key: string]: JsonValue };
// ─── Event Adapter Interface ─────────────────────────────────────

/** A value that survives a JSON round-trip unchanged. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
