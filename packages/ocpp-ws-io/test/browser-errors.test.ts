import { describe, it, expect } from "vitest";
import {
  TimeoutError,
  RPCGenericError,
  RPCNotImplementedError,
  RPCNotSupportedError,
  RPCInternalError,
  RPCProtocolError,
  RPCSecurityError,
  RPCFormationViolationError,
  RPCFormatViolationError,
  RPCPropertyConstraintViolationError,
  RPCOccurrenceConstraintViolationError,
  RPCTypeConstraintViolationError,
  RPCMessageTypeNotSupportedError,
  RPCFrameworkError,
} from "../src/browser/errors.js";

describe("Browser Error Classes", () => {
  // ─── TimeoutError ──────────────────────────────────────────────

  it("TimeoutError should have correct properties", () => {
    const err = new TimeoutError("custom timeout");
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toBe("custom timeout");
    expect(err).toBeInstanceOf(Error);
  });

  it("TimeoutError should have default message", () => {
    const err = new TimeoutError();
    expect(err.message).toBe("Operation timed out");
  });

  // ─── RPCGenericError ───────────────────────────────────────────

  it("RPCGenericError should have correct code", () => {
    const err = new RPCGenericError("test");
    expect(err.rpcErrorCode).toBe("GenericError");
    expect(err.name).toBe("RPCGenericError");
    expect(err).toBeInstanceOf(Error);
  });

  it("RPCGenericError should default details to empty object", () => {
    const err = new RPCGenericError("test");
    expect(err.details).toEqual({});
  });

  it("RPCGenericError should carry details", () => {
    const err = new RPCGenericError("msg", { foo: "bar" });
    expect(err.details).toEqual({ foo: "bar" });
  });

  // ─── All RPC error subtypes ────────────────────────────────────

  const errorSpecs: Array<{
    name: string;
    Ctor: new (
      msg?: string,
      details?: Record<string, unknown>,
    ) => RPCGenericError;
    expectedCode: string;
    expectedName: string;
  }> = [
    {
      name: "RPCNotImplementedError",
      Ctor: RPCNotImplementedError,
      expectedCode: "NotImplemented",
      expectedName: "RPCNotImplementedError",
    },
    {
      name: "RPCNotSupportedError",
      Ctor: RPCNotSupportedError,
      expectedCode: "NotSupported",
      expectedName: "RPCNotSupportedError",
    },
    {
      name: "RPCInternalError",
      Ctor: RPCInternalError,
      expectedCode: "InternalError",
      expectedName: "RPCInternalError",
    },
    {
      name: "RPCProtocolError",
      Ctor: RPCProtocolError,
      expectedCode: "ProtocolError",
      expectedName: "RPCProtocolError",
    },
    {
      name: "RPCSecurityError",
      Ctor: RPCSecurityError,
      expectedCode: "SecurityError",
      expectedName: "RPCSecurityError",
    },
    {
      name: "RPCFormationViolationError",
      Ctor: RPCFormationViolationError,
      expectedCode: "FormationViolation",
      expectedName: "RPCFormationViolationError",
    },
    {
      name: "RPCFormatViolationError",
      Ctor: RPCFormatViolationError,
      expectedCode: "FormatViolation",
      expectedName: "RPCFormatViolationError",
    },
    {
      name: "RPCPropertyConstraintViolationError",
      Ctor: RPCPropertyConstraintViolationError,
      expectedCode: "PropertyConstraintViolation",
      expectedName: "RPCPropertyConstraintViolationError",
    },
    {
      name: "RPCOccurrenceConstraintViolationError",
      Ctor: RPCOccurrenceConstraintViolationError,
      expectedCode: "OccurrenceConstraintViolation",
      expectedName: "RPCOccurrenceConstraintViolationError",
    },
    {
      name: "RPCTypeConstraintViolationError",
      Ctor: RPCTypeConstraintViolationError,
      expectedCode: "TypeConstraintViolation",
      expectedName: "RPCTypeConstraintViolationError",
    },
    {
      name: "RPCMessageTypeNotSupportedError",
      Ctor: RPCMessageTypeNotSupportedError,
      expectedCode: "MessageTypeNotSupported",
      expectedName: "RPCMessageTypeNotSupportedError",
    },
    {
      name: "RPCFrameworkError",
      Ctor: RPCFrameworkError,
      expectedCode: "RpcFrameworkError",
      expectedName: "RPCFrameworkError",
    },
  ];

  for (const { name, Ctor, expectedCode, expectedName } of errorSpecs) {
    describe(name, () => {
      it("should have correct rpcErrorCode", () => {
        const err = new Ctor();
        expect(err.rpcErrorCode).toBe(expectedCode);
      });

      it("should have correct name", () => {
        const err = new Ctor();
        expect(err.name).toBe(expectedName);
      });

      it("should extend Error", () => {
        const err = new Ctor();
        expect(err).toBeInstanceOf(Error);
      });

      it("should have a non-empty rpcErrorMessage", () => {
        const err = new Ctor();
        expect(err.rpcErrorMessage.length).toBeGreaterThan(0);
      });

      it("should accept custom message and details", () => {
        const err = new Ctor("custom", { key: "val" });
        expect(err.message).toBe("custom");
        expect(err.details).toEqual({ key: "val" });
      });
    });
  }

  // ─── Inheritance chain ─────────────────────────────────────────

  it("all RPC errors should extend RPCGenericError chain", () => {
    const errors = [
      new RPCGenericError(),
      new RPCNotImplementedError(),
      new RPCInternalError(),
      new RPCFormatViolationError(),
      new RPCFrameworkError(),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(RPCGenericError);
    }
  });
});
