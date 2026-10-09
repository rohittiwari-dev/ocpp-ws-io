import { EventEmitter } from "node:events";

/** The EventEmitter methods TypedEventEmitter replaces with typed ones. */
type EventMethod =
  | "on"
  | "once"
  | "off"
  | "emit"
  | "removeListener"
  | "addListener"
  | "removeAllListeners";

/**
 * Node's EventEmitter, typed without its event methods, for a class generic
 * over its protocols to declare typed ones: a base class expression cannot
 * refer to the class's own type parameters. The same constructor at runtime.
 */
export const EventEmitterBase = EventEmitter as new () => Omit<
  EventEmitter,
  EventMethod
>;
