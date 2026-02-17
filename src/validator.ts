import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { createRPCError } from "./util.js";

/**
 * Map AJV validation keywords to OCPP RPC error codes.
 */
const errorCodeLUT: Record<string, string> = {
  maximum: "FormatViolation",
  minimum: "FormatViolation",
  maxLength: "FormatViolation",
  minLength: "FormatViolation",
  exclusiveMaximum: "OccurrenceConstraintViolation",
  exclusiveMinimum: "OccurrenceConstraintViolation",
  multipleOf: "OccurrenceConstraintViolation",
  maxItems: "OccurrenceConstraintViolation",
  minItems: "OccurrenceConstraintViolation",
  maxProperties: "OccurrenceConstraintViolation",
  minProperties: "OccurrenceConstraintViolation",
  pattern: "FormatViolation",
  format: "FormatViolation",
  type: "TypeConstraintViolation",
  required: "OccurrenceConstraintViolation",
  enum: "PropertyConstraintViolation",
  const: "PropertyConstraintViolation",
  additionalProperties: "OccurrenceConstraintViolation",
  anyOf: "FormatViolation",
  oneOf: "FormatViolation",
  not: "FormatViolation",
  if: "FormatViolation",
};

export interface ValidatorSchema {
  $schema?: string;
  $id?: string;
  [key: string]: unknown;
}

/**
 * Schema validator using AJV for OCPP message validation.
 * Each validator is bound to a specific subprotocol version.
 */
export class Validator {
  readonly subprotocol: string;
  /** @internal */
  _ajv: Ajv;

  constructor(subprotocol: string, schemas: ValidatorSchema[]) {
    this.subprotocol = subprotocol;
    this._ajv = new Ajv({
      allErrors: true,
      strict: false,
      multipleOfPrecision: 4,
    });
    addFormats(this._ajv);

    // OCPP schemas use non-standard URN $id values like "urn:Authorize.req"
    // that fast-uri can't serialize. Normalize $id to simple path-based form.
    for (const schema of schemas) {
      const normalized = { ...schema };
      if (normalized.$id && normalized.$id.startsWith("urn:")) {
        normalized.$id = normalized.$id.replace("urn:", "urn/");
      }
      this._ajv.addSchema(normalized);
    }
  }

  /**
   * Validate a payload against a schema identified by its $id.
   * Throws a typed RPCError if validation fails.
   */
  validate(schemaId: string, params: unknown): void {
    // Normalize to match the urn/ prefix used during schema registration
    const normalizedId = schemaId.startsWith("urn:")
      ? schemaId.replace("urn:", "urn/")
      : schemaId;
    const validate: ValidateFunction | undefined =
      this._ajv.getSchema(normalizedId);
    if (!validate) {
      // Schema not found — skip validation (not all actions have schemas)
      return;
    }

    const valid = validate(params);
    if (!valid && validate.errors && validate.errors.length > 0) {
      const firstError = validate.errors[0];
      const keyword = firstError.keyword;
      const errorCode = errorCodeLUT[keyword] ?? "FormatViolation";
      const errorMessage = this._ajv.errorsText(validate.errors);

      throw createRPCError(errorCode, errorMessage);
    }
  }

  /**
   * Check if a schema exists for the given $id.
   */
  hasSchema(schemaId: string): boolean {
    const normalizedId = schemaId.startsWith("urn:")
      ? schemaId.replace("urn:", "urn/")
      : schemaId;
    return !!this._ajv.getSchema(normalizedId);
  }
}

/**
 * Create a validator for a specific subprotocol version.
 */
export function createValidator(
  subprotocol: string,
  schemas: ValidatorSchema[],
): Validator {
  return new Validator(subprotocol, schemas);
}
