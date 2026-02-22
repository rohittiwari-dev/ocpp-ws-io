import { describe, expect, it, vi } from "vitest";
import {
  combineAuth,
  defineAuth,
  defineMiddleware,
  defineRpcMiddleware,
} from "../src/helpers/index.js";
import type { HandshakeInfo } from "../src/types.js";

describe("Auth and Middleware Utilities", () => {
  const mockHandshake = {} as HandshakeInfo;
  const mockSignal = new AbortController().signal;

  it("should accept connection if the first callback accepts", async () => {
    const cb1 = vi.fn((ctx) => ctx.accept({ protocol: "ocpp1.6" }));
    const cb2 = vi.fn(); // Should not be reached

    const combined = combineAuth(cb1, cb2);

    const acceptSpy = vi.fn();
    const rejectSpy = vi.fn();
    const mockCtx = {
      handshake: mockHandshake,
      signal: mockSignal,
      accept: acceptSpy,
      reject: rejectSpy,
      state: {},
    } as any;

    await combined(mockCtx);

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
    expect(acceptSpy).toHaveBeenCalledWith({ protocol: "ocpp1.6" });
    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("should sequentially fall through to the second callback if the first neither accepts nor rejects", async () => {
    // cb1 does nothing (maybe standard validation passed but no explicit accept)
    const cb1 = vi.fn(async () => {});
    const cb2 = vi.fn((ctx) => ctx.accept({ protocol: "ocpp2.0.1" }));

    const combined = combineAuth(cb1, cb2);

    const acceptSpy = vi.fn();
    const rejectSpy = vi.fn();
    const mockCtx = {
      handshake: mockHandshake,
      signal: mockSignal,
      accept: acceptSpy,
      reject: rejectSpy,
      state: {},
    } as any;

    await combined(mockCtx);

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(acceptSpy).toHaveBeenCalledWith({ protocol: "ocpp2.0.1" });
    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("should instantly reject if any callback rejects, skipping subsequent callbacks", async () => {
    const cb1 = vi.fn((ctx) => ctx.reject(403, "Forbidden via CB1"));
    const cb2 = vi.fn((ctx) => ctx.accept()); // Should not be reached

    const combined = combineAuth(cb1, cb2);

    const acceptSpy = vi.fn();
    const rejectSpy = vi.fn();
    const mockCtx = {
      handshake: mockHandshake,
      signal: mockSignal,
      accept: acceptSpy,
      reject: rejectSpy,
      state: {},
    } as any;

    await combined(mockCtx);

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
    expect(acceptSpy).not.toHaveBeenCalled();
    expect(rejectSpy).toHaveBeenCalledWith(403, "Forbidden via CB1");
  });

  it("should reject with 401 Unauthorized if all callbacks fall through without accepting", async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn(async () => {});

    const combined = combineAuth(cb1, cb2);

    const acceptSpy = vi.fn();
    const rejectSpy = vi.fn();
    const mockCtx = {
      handshake: mockHandshake,
      signal: mockSignal,
      accept: acceptSpy,
      reject: rejectSpy,
      state: {},
    } as any;

    await combined(mockCtx);

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(acceptSpy).not.toHaveBeenCalled();
    expect(rejectSpy).toHaveBeenCalledWith(
      401,
      expect.stringContaining("Unauthorized"),
    );
  });

  it("should catch unhandled exceptions in callbacks and reject with 500 External Error", async () => {
    const cb1 = vi.fn(async () => {
      throw new Error("Simulated Native Exception");
    });
    const cb2 = vi.fn(); // Should not be reached

    const combined = combineAuth(cb1, cb2);

    const acceptSpy = vi.fn();
    const rejectSpy = vi.fn();
    const mockCtx = {
      handshake: mockHandshake,
      signal: mockSignal,
      accept: acceptSpy,
      reject: rejectSpy,
      state: {},
    } as any;

    await combined(mockCtx);

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
    expect(acceptSpy).not.toHaveBeenCalled();
    expect(rejectSpy).toHaveBeenCalledWith(
      500,
      expect.stringContaining("Internal Server Error"),
    );
  });

  describe("defineAuth and defineMiddleware", () => {
    it("should natively passthrough auth functions for IDE typings", () => {
      const cb = defineAuth((ctx) => ctx.accept());
      expect(typeof cb).toBe("function");
    });

    it("should natively passthrough middleware functions for IDE typings", () => {
      const mw = defineMiddleware(async (ctx) => ctx.next());
      expect(typeof mw).toBe("function");
    });

    it("should natively passthrough RPC middleware functions for IDE typings", () => {
      const rw = defineRpcMiddleware(async (ctx, next) => next());
      expect(typeof rw).toBe("function");
    });
  });
});
