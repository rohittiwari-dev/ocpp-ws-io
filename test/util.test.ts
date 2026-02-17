import { describe, it, expect } from "vitest";
import {
  createRPCError,
  getErrorPlainObject,
  getPackageIdent,
} from "../src/util.js";
import {
  RPCGenericError,
  RPCNotImplementedError,
  RPCFormatViolationError,
  RPCInternalError,
  RPCSecurityError,
  RPCFrameworkError,
} from "../src/errors.js";

describe("createRPCError", () => {
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
});

describe("getErrorPlainObject", () => {
  it("should convert Error to plain object", () => {
    const err = new Error("hello");
    const obj = getErrorPlainObject(err);
    expect(obj.message).toBe("hello");
    expect(typeof obj.stack).toBe("string");
  });

  it("should handle RPCError with custom properties", () => {
    const err = createRPCError("NotImplemented", "no handler");
    const obj = getErrorPlainObject(err);
    expect(obj.rpcErrorCode).toBe("NotImplemented");
    expect(obj.message).toBe("no handler");
  });

  it("should handle errors with circular references gracefully", () => {
    const err = new Error("circular");
    (err as unknown as Record<string, unknown>).self = err;
    // Should not throw, should return at least name and message
    const obj = getErrorPlainObject(err);
    expect(obj.name).toBe("Error");
    expect(obj.message).toBe("circular");
  });
});

describe("getPackageIdent", () => {
  it("should return package identifier string", () => {
    const ident = getPackageIdent();
    expect(ident).toContain("ocpp-ws-io");
  });

  it("should return consistent value on repeated calls", () => {
    expect(getPackageIdent()).toBe(getPackageIdent());
  });
});
