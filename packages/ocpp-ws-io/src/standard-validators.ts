import ocpp16 from "./schemas/ocpp1_6.json";
import ocpp201 from "./schemas/ocpp2_0_1.json";
import ocpp21 from "./schemas/ocpp2_1.json";
import {
  createValidator,
  type Validator,
  type ValidatorSchema,
} from "./validator.js";

const SCHEMAS: Record<string, ValidatorSchema[]> = {
  "ocpp1.6": ocpp16 as ValidatorSchema[],
  "ocpp2.0.1": ocpp201 as ValidatorSchema[],
  "ocpp2.1": ocpp21 as ValidatorSchema[],
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

  const validator = createValidator(protocol, schemas);
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

/**
 * Throws when strict mode covers a protocol that has no validator, built in or
 * among `strictModeValidators`: its messages would go unvalidated while strict
 * mode is on. Names the protocol and the ways out.
 */
export function assertStrictValidators(
  protocols: readonly string[] | undefined,
  strictMode: boolean | readonly string[] | undefined,
  strictModeValidators: readonly Validator[] | undefined,
): void {
  if (!strictMode) return;
  const strict = Array.isArray(strictMode) ? strictMode : (protocols ?? []);
  const custom = new Set(
    (strictModeValidators ?? []).map((v) => v.subprotocol),
  );
  const builtIn = new Set(getStandardProtocols());
  const covered = strict.filter((p) => custom.has(p) || builtIn.has(p));
  for (const protocol of strict) {
    if (custom.has(protocol) || builtIn.has(protocol)) continue;
    const limit = covered.length
      ? `, or limit strictMode to the protocols that have one, such as strictMode: ${JSON.stringify(covered)}`
      : "";
    throw new TypeError(
      `Missing strictMode validator for subprotocol "${protocol}": add one to strictModeValidators${limit}`,
    );
  }
}
