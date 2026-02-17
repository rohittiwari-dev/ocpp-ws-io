import { describe, it, expect } from "vitest";
import {
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
  RPCOccurenceConstraintViolationError,
  RPCTypeConstraintViolationError,
  RPCMessageTypeNotSupportedError,
  RPCFrameworkError,
  TimeoutError,
  UnexpectedHttpResponse,
  WebsocketUpgradeError,
} from "../src/errors.js";

describe("Error Classes", () => {
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

  it("UnexpectedHttpResponse should include status code and headers", () => {
    const err = new UnexpectedHttpResponse("bad response", 401, {
      "www-authenticate": "Basic",
    });
    expect(err.name).toBe("UnexpectedHttpResponse");
    expect(err.statusCode).toBe(401);
    expect(err.headers["www-authenticate"]).toBe("Basic");
  });

  it("WebsocketUpgradeError should have default message", () => {
    const err = new WebsocketUpgradeError();
    expect(err.name).toBe("WebsocketUpgradeError");
    expect(err.message).toBe("WebSocket upgrade failed");
  });

  it("RPCGenericError should have correct code", () => {
    const err = new RPCGenericError("test");
    expect(err.rpcErrorCode).toBe("GenericError");
    expect(err.name).toBe("RPCGenericError");
  });

  it("RPCNotImplementedError should have correct code and message", () => {
    const err = new RPCNotImplementedError("test");
    expect(err.rpcErrorCode).toBe("NotImplemented");
    expect(err.rpcErrorMessage).toBe("Requested method is not known");
  });

  it("RPCNotSupportedError should have correct code", () => {
    const err = new RPCNotSupportedError();
    expect(err.rpcErrorCode).toBe("NotSupported");
  });

  it("RPCInternalError should have correct code", () => {
    const err = new RPCInternalError();
    expect(err.rpcErrorCode).toBe("InternalError");
  });

  it("RPCProtocolError should have correct code", () => {
    const err = new RPCProtocolError();
    expect(err.rpcErrorCode).toBe("ProtocolError");
  });

  it("RPCSecurityError should have correct code", () => {
    const err = new RPCSecurityError();
    expect(err.rpcErrorCode).toBe("SecurityError");
  });

  it("RPCFormationViolationError should have correct code", () => {
    const err = new RPCFormationViolationError();
    expect(err.rpcErrorCode).toBe("FormationViolation");
  });

  it("RPCFormatViolationError should have correct code", () => {
    const err = new RPCFormatViolationError();
    expect(err.rpcErrorCode).toBe("FormatViolation");
  });

  it("RPCPropertyConstraintViolationError should have correct code", () => {
    const err = new RPCPropertyConstraintViolationError();
    expect(err.rpcErrorCode).toBe("PropertyConstraintViolation");
  });

  it("RPCOccurrenceConstraintViolationError should have correct code", () => {
    const err = new RPCOccurrenceConstraintViolationError();
    expect(err.rpcErrorCode).toBe("OccurrenceConstraintViolation");
  });

  it("RPCOccurenceConstraintViolationError (legacy typo) should have correct code", () => {
    const err = new RPCOccurenceConstraintViolationError();
    expect(err.rpcErrorCode).toBe("OccurenceConstraintViolation");
  });

  it("RPCTypeConstraintViolationError should have correct code", () => {
    const err = new RPCTypeConstraintViolationError();
    expect(err.rpcErrorCode).toBe("TypeConstraintViolation");
  });

  it("RPCMessageTypeNotSupportedError should have correct code", () => {
    const err = new RPCMessageTypeNotSupportedError();
    expect(err.rpcErrorCode).toBe("MessageTypeNotSupported");
  });

  it("RPCFrameworkError should have correct code", () => {
    const err = new RPCFrameworkError();
    expect(err.rpcErrorCode).toBe("RpcFrameworkError");
  });

  it("all RPC errors should extend RPCGenericError chain", () => {
    const errors = [
      new RPCGenericError(),
      new RPCNotImplementedError(),
      new RPCInternalError(),
      new RPCFormatViolationError(),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("RPC errors should carry details", () => {
    const err = new RPCGenericError("msg", { foo: "bar" });
    expect(err.details).toEqual({ foo: "bar" });
  });
});
