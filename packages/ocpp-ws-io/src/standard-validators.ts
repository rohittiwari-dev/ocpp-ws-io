import ocpp16 from "./schemas/ocpp1_6.json";
import ocpp201 from "./schemas/ocpp2_0_1.json";
import ocpp21 from "./schemas/ocpp2_1.json";
import {
  createValidator,
  type Validator,
  type ValidatorSchema,
} from "./validator.js";

const SCHEMAS: Record<string, unknown[]> = {
  "ocpp1.6": ocpp16 as unknown[],
  "ocpp2.0.1": ocpp201 as unknown[],
  "ocpp2.1": ocpp21 as unknown[],
};

/**
 * Validators are cached per protocol rather than as one all-versions batch.
 *
 * A connection only ever speaks one subprotocol, so building all three costs
 * two AJV instances and two full schema registrations that will never be
 * consulted — measured at roughly 1.4 MB for the set. Caching per protocol
 * means a CSMS speaking only OCPP 1.6 pays for OCPP 1.6.
 *
 * Schemas within a validator are still compiled lazily on first use
 * (see Validator), so an action never received is never compiled.
 */
const _byProtocol = new Map<string, Validator>();

/**
 * The cached validator for one protocol, built on first request.
 * Returns null for a protocol with no bundled schemas — a custom subprotocol,
 * for instance, which callers validate with their own `strictModeValidators`.
 */
export function getStandardValidator(protocol: string): Validator | null {
  const cached = _byProtocol.get(protocol);
  if (cached) return cached;

  const schemas = SCHEMAS[protocol];
  if (!schemas) return null;

  const validator = createValidator(protocol, schemas as ValidatorSchema[]);
  _byProtocol.set(protocol, validator);
  return validator;
}

/**
 * Validators for the given protocols, or for every bundled protocol when none
 * are named. Repeated calls reuse the same instances.
 */
export function getStandardValidators(
  protocols?: readonly string[],
): Validator[] {
  const wanted =
    protocols && protocols.length > 0 ? protocols : Object.keys(SCHEMAS);

  const out: Validator[] = [];
  for (const protocol of wanted) {
    const validator = getStandardValidator(protocol);
    if (validator) out.push(validator);
  }
  return out;
}

/** Protocols that ship with bundled OCPP schemas. */
export function getStandardProtocols(): string[] {
  return Object.keys(SCHEMAS);
}
