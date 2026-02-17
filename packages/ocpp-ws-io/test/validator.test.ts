import { describe, it, expect } from "vitest";
import { Validator, createValidator } from "../src/validator.js";

// Minimal JSON schema for testing
const testSchemas = [
  {
    $id: "urn:Heartbeat.req",
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  {
    $id: "urn:Authorize.req",
    type: "object",
    properties: {
      idTag: { type: "string", maxLength: 20 },
    },
    required: ["idTag"],
  },
  {
    $id: "urn:StatusNotification.req",
    type: "object",
    properties: {
      status: { type: "string", enum: ["Available", "Occupied", "Faulted"] },
      connectorId: { type: "integer", minimum: 0, maximum: 10 },
    },
    required: ["status", "connectorId"],
  },
  {
    // Schema without urn: prefix (non-standard)
    $id: "custom/TestAction.req",
    type: "object",
    properties: {
      value: { type: "number" },
    },
  },
];

describe("Validator", () => {
  describe("constructor", () => {
    it("should create a validator with subprotocol name", () => {
      const v = new Validator("ocpp1.6", []);
      expect(v.subprotocol).toBe("ocpp1.6");
    });

    it("should normalize urn: schema IDs during construction", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      // The urn: prefix should be normalized to urn/ internally
      expect(v.hasSchema("urn:Heartbeat.req")).toBe(true);
    });

    it("should handle schemas without urn: prefix", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      expect(v.hasSchema("custom/TestAction.req")).toBe(true);
    });
  });

  describe("validate", () => {
    it("should pass validation for a valid payload", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      expect(() => v.validate("urn:Heartbeat.req", {})).not.toThrow();
    });

    it("should pass validation for valid Authorize payload", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      expect(() =>
        v.validate("urn:Authorize.req", { idTag: "ABC123" }),
      ).not.toThrow();
    });

    it("should skip validation for unknown schema ID", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      // Unknown schema should not throw
      expect(() =>
        v.validate("urn:UnknownAction.req", { anything: true }),
      ).not.toThrow();
    });

    it("should throw OccurrenceConstraintViolation for missing required field", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      expect(() => v.validate("urn:Authorize.req", {})).toThrow(/required/i);
    });

    it("should throw TypeConstraintViolation for wrong type", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      try {
        v.validate("urn:Authorize.req", { idTag: 12345 });
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as { rpcErrorCode: string }).rpcErrorCode).toBe(
          "TypeConstraintViolation",
        );
      }
    });

    it("should throw PropertyConstraintViolation for invalid enum value", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      try {
        v.validate("urn:StatusNotification.req", {
          status: "InvalidStatus",
          connectorId: 1,
        });
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as { rpcErrorCode: string }).rpcErrorCode).toBe(
          "PropertyConstraintViolation",
        );
      }
    });

    it("should throw FormatViolation for value exceeding maxLength", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      try {
        v.validate("urn:Authorize.req", {
          idTag: "A".repeat(25), // exceeds maxLength: 20
        });
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as { rpcErrorCode: string }).rpcErrorCode).toBe(
          "FormatViolation",
        );
      }
    });

    it("should throw for additionalProperties violation", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      try {
        v.validate("urn:Heartbeat.req", { extraField: "nope" });
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as { rpcErrorCode: string }).rpcErrorCode).toBe(
          "OccurrenceConstraintViolation",
        );
      }
    });
  });

  describe("hasSchema", () => {
    it("should return true for registered schema with urn: prefix", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      expect(v.hasSchema("urn:Heartbeat.req")).toBe(true);
      expect(v.hasSchema("urn:Authorize.req")).toBe(true);
    });

    it("should return false for unregistered schema", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      expect(v.hasSchema("urn:UnknownAction.req")).toBe(false);
    });

    it("should return true for non-urn schema", () => {
      const v = new Validator("ocpp1.6", testSchemas);
      expect(v.hasSchema("custom/TestAction.req")).toBe(true);
    });
  });

  describe("createValidator", () => {
    it("should create a Validator instance", () => {
      const v = createValidator("ocpp2.0.1", testSchemas);
      expect(v).toBeInstanceOf(Validator);
      expect(v.subprotocol).toBe("ocpp2.0.1");
    });
  });
});
