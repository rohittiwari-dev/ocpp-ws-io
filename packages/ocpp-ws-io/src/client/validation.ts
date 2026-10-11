import { getStandardValidator } from "../core/validation/standard-validators.js";
import type { Validator } from "../core/validation/validator.js";
import type { ClientContext } from "./context.js";
import type { SchemaKind } from "./frames.js";

/**
 * Schema id for a message. A SEND has a single schema with no request/response
 * suffix (`urn:NotifyPeriodicEventStream`).
 */
function schemaIdFor(method: string, kind: SchemaKind): string {
  return kind === "send" ? `urn:${method}` : `urn:${method}.${kind}`;
}

/**
 * Validate a message against its schema when strict mode covers its protocol
 * and action, emitting strictValidationFailure before rethrowing a failure.
 */
export function validateMessage(
  client: ClientContext,
  method: string,
  params: unknown,
  suffix: SchemaKind,
): void {
  const validator = findValidator(client);
  if (!validator) return;

  if (
    client.options.strictModeMethods &&
    !(client.options.strictModeMethods as readonly string[]).includes(method)
  ) {
    return; // Skip validation if method is not in the explicit strict list
  }

  const schemaId = schemaIdFor(method, suffix);
  try {
    validator.validate(schemaId, params);
  } catch (err) {
    client.emitter.emit("strictValidationFailure", {
      message: params,
      error: err as Error,
    });
    throw err;
  }
}

/**
 * The validator for the negotiated protocol: a custom one for it, else the
 * built-in one; none when strict mode does not cover the protocol.
 */
function findValidator(client: ClientContext): Validator | null {
  if (!client.protocol) return null;

  if (
    client.strictProtocols &&
    !client.strictProtocols.includes(client.protocol)
  ) {
    return null;
  }

  // A custom validator for this subprotocol wins; otherwise the built-in
  // one. Returning null when custom validators were given, as before, left
  // a standard protocol next to a custom one unvalidated.
  const custom = client.validators?.find(
    (v) => v.subprotocol === client.protocol,
  );
  if (custom) return custom;

  // Built on first use and cached process-wide, so this costs one lookup
  // per validated message after the first.
  return getStandardValidator(client.protocol);
}
