import { describe, it, expect } from "vitest";
import { createRPCError, getErrorPlainObject } from "../src/browser/util.js";
import {
  RPCGenericError,
  RPCNotImplementedError,
  RPCFormatViolationError,
  RPCInternalError,
  RPCSecurityError,
  RPCFrameworkError,
} from "../src/browser/errors.js";

describe("Browser createRPCError", () => {
  it('should create RPCGenericError for "GenericError" code', () => {
    const err = createRPCError("GenericError", "test msg");
    expect(err).toBeInstanceOf(RPCGenericError);
    expect(err.rpcErrorCode).toBe("GenericError");
    expect(err.message).toBe("test msg");
  });

  it('should create RPCNotImplementedError for "NotImplemented" code', () => {
    const err = createRPCError("NotImplemented");
    expect(err).toBeInstanceOf(RPCNotImplementedError);
    expect(err.rpcErrorCode).toBe("NotImplemented");
  });

  it("should create RPCFormatViolationError", () => {
    const err = createRPCError("FormatViolation", "bad format");
    expect(err).toBeInstanceOf(RPCFormatViolationError);
    expect(err.rpcErrorCode).toBe("FormatViolation");
  });

  it("should create RPCInternalError", () => {
    const err = createRPCError("InternalError", "internal");
    expect(err).toBeInstanceOf(RPCInternalError);
  });

  it("should create RPCSecurityError", () => {
    const err = createRPCError("SecurityError");
    expect(err).toBeInstanceOf(RPCSecurityError);
  });

  it("should create RPCFrameworkError", () => {
    const err = createRPCError("RpcFrameworkError");
    expect(err).toBeInstanceOf(RPCFrameworkError);
  });

  it("should fallback to RPCGenericError for unknown error codes", () => {
    const err = createRPCError("SomethingUnknown", "unknown code");
    expect(err).toBeInstanceOf(RPCGenericError);
    expect(err.rpcErrorCode).toBe("GenericError");
  });

  it("should include details in error when provided", () => {
    const details = { key: "value" };
    const err = createRPCError("GenericError", "msg", details);
    expect(err.details).toEqual({ key: "value" });
  });

  it("should default details to empty object", () => {
    const err = createRPCError("GenericError", "msg");
    expect(err.details).toEqual({});
  });

  // All known codes
  const knownCodes = [
    "GenericError",
    "NotImplemented",
    "NotSupported",
    "InternalError",
    "ProtocolError",
    "SecurityError",
    "FormatViolation",
    "FormationViolation",
    "PropertyConstraintViolation",
    "OccurrenceConstraintViolation",
    "TypeConstraintViolation",
    "MessageTypeNotSupported",
    "RpcFrameworkError",
  ];

  for (const code of knownCodes) {
    it(`should create correct error for code "${code}"`, () => {
      const err = createRPCError(code, "test");
      expect(err.rpcErrorCode).toBe(code);
      expect(err.message).toBe("test");
    });
  }
});

describe("Browser getErrorPlainObject", () => {
  it("should convert Error to plain object", () => {
    const err = new Error("hello");
    const obj = getErrorPlainObject(err);
    expect(obj.message).toBe("hello");
    expect(typeof obj.stack).toBe("string");
    expect(obj.name).toBe("Error");
  });

  it("should handle RPCError with custom properties", () => {
    const err = createRPCError("NotImplemented", "no handler");
    const obj = getErrorPlainObject(err);
    expect(obj.rpcErrorCode).toBe("NotImplemented");
    expect(obj.message).toBe("no handler");
  });

  it("should include details from RPCError", () => {
    const err = createRPCError("GenericError", "msg", { foo: "bar" });
    const obj = getErrorPlainObject(err);
    expect(obj.details).toEqual({ foo: "bar" });
  });

  it("should handle errors with circular references gracefully", () => {
    const err = new Error("circular");
    (err as unknown as Record<string, unknown>).self = err;
    const obj = getErrorPlainObject(err);
    expect(obj.name).toBe("Error");
    expect(obj.message).toBe("circular");
    // Circular reference should be skipped
    expect(obj.self).toBeUndefined();
  });

  it("should skip function and symbol properties", () => {
    const err = new Error("test");
    (err as unknown as Record<string, unknown>).fn = () => {};
    (err as unknown as Record<string, unknown>).sym = Symbol("test");
    const obj = getErrorPlainObject(err);
    expect(obj.fn).toBeUndefined();
    expect(obj.sym).toBeUndefined();
  });

  it("should always include name and message", () => {
    const err = new Error("");
    const obj = getErrorPlainObject(err);
    expect(obj.name).toBe("Error");
    expect(obj.message).toBe("");
  });
});
