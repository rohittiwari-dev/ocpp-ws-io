/** Sessions, as held, filled and stored. */
import type { JsonValue } from "./json.js";

// ─── Session Data ────────────────────────────────────────────────

/**
 * A connection's session. `client.session` starts as what connection
 * middleware left in `ctx.state` (directly or through `ctx.next(payload)`),
 * then the session stored for the identity (by the cluster adapter, or on
 * this node), then the `session` an auth callback passes to `ctx.accept()`,
 * each over the one before. Declare its keys once, and all of those are typed
 * by them:
 *
 * ```ts
 * declare module "ocpp-ws-io" {
 *   interface OCPPSession {
 *     tenantId: string;
 *     role: "admin" | "charger";
 *   }
 * }
 * ```
 *
 * Values are JSON, as the cluster adapter stores them; a key that is not
 * declared takes any JSON value. A key may hold `undefined` (one charger has
 * a value, another not), which JSON leaves out like an absent key, so a key
 * may be declared optional.
 */
export interface OCPPSession {
  [key: string]: JsonValue | undefined;
}
/**
 * A session as it is held and filled: the keys declared on OCPPSession (or
 * on T), each of which a session may not have yet, and any other key with a
 * SessionValue.
 */
export type SessionData<T extends object = OCPPSession> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : K]?: T[K];
} & { [key: string]: SessionValue };
/**
 * A value a session holds: JSON, a `Date` or `undefined`, at any depth. The
 * cluster adapter stores sessions as JSON, so there a `Date` comes back as
 * its ISO string, and a key holding `undefined` is left out (in an array,
 * written as `null`).
 */
export type SessionValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | SessionValue[]
  | { [key: string]: SessionValue };
/**
 * Session data as an adapter stores it — must be JSON-serializable. A key
 * holding `undefined` is left out by `JSON.stringify`, like an absent key,
 * and a `Date` is written as its ISO string.
 */
export type PersistedSession = { [key: string]: SessionValue };
