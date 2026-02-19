import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { createRPCError } from "./util.js";

// ─── Validation Error Mapping ───────────────────────────────────

/**
 * Maps AJV validation keywords to OCPP-J RPC error codes.
 *
 * Rather than listing each keyword individually, this is organized
 * by the OCPP error category that best describes the validation failure.
 * The mapping is derived from the OCPP-J specification sections on error codes.
 */

/** Keywords indicating the data type itself is wrong */
const TYPE_VIOLATIONS = new Set(["type"]);

/** Keywords indicating a value falls outside allowed bounds or format */
const FORMAT_VIOLATIONS = new Set([
  "maximum",
  "minimum",
  "maxLength",
  "minLength",
  "pattern",
  "format",
  "anyOf",
  "oneOf",
  "not",
  "if",
]);

/** Keywords indicating cardinality / presence constraints are broken */
const OCCURRENCE_VIOLATIONS = new Set([
  "required",
  "maxItems",
  "minItems",
  "maxProperties",
  "minProperties",
  "additionalProperties",
  "additionalItems",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "multipleOf",
]);

/** Keywords indicating a property value is not in the allowed set */
const PROPERTY_VIOLATIONS = new Set(["enum", "const"]);

/**
 * Resolve an AJV keyword to the appropriate OCPP RPC error code.
 */
function keywordToOCPPError(keyword: string): string {
  if (TYPE_VIOLATIONS.has(keyword)) return "TypeConstraintViolation";
  if (OCCURRENCE_VIOLATIONS.has(keyword))
    return "OccurrenceConstraintViolation";
  if (PROPERTY_VIOLATIONS.has(keyword)) return "PropertyConstraintViolation";
  if (FORMAT_VIOLATIONS.has(keyword)) return "FormatViolation";
  // Fallback for any unknown keywords
  return "FormatViolation";
}

// ─── Validator Class ────────────────────────────────────────────

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
      if (
        typeof normalized.$id === "string" &&
        normalized.$id.startsWith("urn:")
      ) {
        normalized.$id = normalized.$id.replace("urn:", "urn/");
      }
      this._ajv.addSchema(normalized);
    }
  }

  /**
   * Normalize a schema ID from OCPP URN format to internal path format.
   */
  private _normalizeSchemaId(schemaId: string): string {
    return schemaId.startsWith("urn:")
      ? schemaId.replace("urn:", "urn/")
      : schemaId;
  }

  /**
   * Validate a payload against a schema identified by its $id.
   * Throws a typed RPCError if validation fails.
   */
  validate(schemaId: string, params: unknown): void {
    const resolvedId = this._normalizeSchemaId(schemaId);
    const validateFn: ValidateFunction | undefined =
      this._ajv.getSchema(resolvedId);

    if (!validateFn) {
      // Schema not found — skip validation (not all actions have schemas)
      return;
    }

    const isValid = validateFn(params);
    if (!isValid && validateFn.errors && validateFn.errors.length > 0) {
      const primaryError = validateFn.errors[0];
      const ocppErrorCode = keywordToOCPPError(primaryError.keyword);
      const description = this._ajv.errorsText(validateFn.errors);

      throw createRPCError(ocppErrorCode, description);
    }
  }

  /**
   * Check if a schema exists for the given $id.
   */
  hasSchema(schemaId: string): boolean {
    return !!this._ajv.getSchema(this._normalizeSchemaId(schemaId));
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
