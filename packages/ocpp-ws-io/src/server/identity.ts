// Charging station identities: the length limit and, under strict mode, the
// rules of OCPP-J §3.1.1 for the negotiated version.

/**
 * Charging station identity rules per version (OCPP-J §3.1.1): an
 * identifierString (2.0.1 / 2.1 Part 2) without ":" (2.1 "SHALL NOT",
 * 2.0.1 errata 2023-12 "SHALL not"), at most 48 characters. 1.6J has none.
 */
const IDENTITY_RULES: Readonly<
  Record<string, { maxLength: number; pattern: RegExp }>
> = {
  "ocpp2.0.1": { maxLength: 48, pattern: /^[A-Za-z0-9*\-_=+|@.]+$/ },
  "ocpp2.1": { maxLength: 48, pattern: /^[A-Za-z0-9*\-_=+|@.]+$/ },
};

export function assertMaxIdentityLength(value: number | undefined): void {
  if (value !== undefined && !(Number.isInteger(value) && value > 0)) {
    throw new Error(
      `maxIdentityLength must be a positive integer, got ${value}`,
    );
  }
}

/**
 * Why an identity is refused, if it is. `maxIdentityLength` applies in any
 * mode and replaces the spec's length; strict mode adds the spec's rules for
 * the negotiated version.
 */
export function identityRefusal(
  identity: string,
  protocol: string | undefined,
  strictMode: boolean | readonly string[] | undefined,
  maxIdentityLength: number | undefined,
): string | undefined {
  const strict =
    protocol !== undefined &&
    (strictMode === true ||
      (Array.isArray(strictMode) && strictMode.includes(protocol)));
  const rules = strict ? IDENTITY_RULES[protocol] : undefined;
  const limit = maxIdentityLength ?? rules?.maxLength;
  const length = Array.from(identity).length;
  if (limit !== undefined && length > limit) {
    return `Charging station identity is ${length} characters; the maximum is ${limit}`;
  }
  if (rules && !rules.pattern.test(identity)) {
    return "Charging station identity may only contain a-z A-Z 0-9 * - _ = + | @ .";
  }
  return undefined;
}
