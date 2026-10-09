import type { UncheckedAction } from "../types.js";

/**
 * Marks an action name the types do not check: a vendor action not declared
 * in the method maps, a name passed through from the wire, or a test that
 * sends an invalid payload on purpose. Returns the name unchanged, so nothing
 * differs at runtime.
 *
 * ```ts
 * await client.call(unchecked("VendorPing"), { n: 1 });
 * client.handle(unchecked("VendorPing"), () => ({ pong: true }));
 * ```
 *
 * To type a vendor action instead, declare it once by augmenting the method
 * map (see the TypeScript guide).
 */
export function unchecked(action: string): UncheckedAction {
  return action as UncheckedAction;
}
