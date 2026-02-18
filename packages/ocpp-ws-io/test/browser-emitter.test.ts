import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "../src/browser/emitter.js";

describe("Browser EventEmitter", () => {
  // ─── on / emit ────────────────────────────────────────────────

  it("should register and invoke a listener", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("test", fn);
    emitter.emit("test", "arg1", "arg2");
    expect(fn).toHaveBeenCalledWith("arg1", "arg2");
  });

  it("should return true when listeners exist for an event", () => {
    const emitter = new EventEmitter();
    emitter.on("test", () => {});
    expect(emitter.emit("test")).toBe(true);
  });

  it("should return false when no listeners exist", () => {
    const emitter = new EventEmitter();
    expect(emitter.emit("test")).toBe(false);
  });

  it("should support multiple listeners on the same event", () => {
    const emitter = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on("test", fn1);
    emitter.on("test", fn2);
    emitter.emit("test", "data");
    expect(fn1).toHaveBeenCalledWith("data");
    expect(fn2).toHaveBeenCalledWith("data");
  });

  it("should support chaining on()", () => {
    const emitter = new EventEmitter();
    const result = emitter.on("test", () => {});
    expect(result).toBe(emitter);
  });

  // ─── once ─────────────────────────────────────────────────────

  it("should invoke a once() listener only once", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.once("test", fn);
    emitter.emit("test", "a");
    emitter.emit("test", "b");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("should support chaining once()", () => {
    const emitter = new EventEmitter();
    const result = emitter.once("test", () => {});
    expect(result).toBe(emitter);
  });

  // ─── off ──────────────────────────────────────────────────────

  it("should remove a specific listener with off()", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("test", fn);
    emitter.off("test", fn);
    emitter.emit("test");
    expect(fn).not.toHaveBeenCalled();
  });

  it("should be able to remove a once() listener by original function", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.once("test", fn);
    emitter.off("test", fn);
    emitter.emit("test");
    expect(fn).not.toHaveBeenCalled();
  });

  it("should not fail when removing a listener from a non-existent event", () => {
    const emitter = new EventEmitter();
    expect(() => emitter.off("nonexistent", () => {})).not.toThrow();
  });

  it("should only remove the specified listener", () => {
    const emitter = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on("test", fn1);
    emitter.on("test", fn2);
    emitter.off("test", fn1);
    emitter.emit("test");
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  it("should support chaining off()", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("test", fn);
    const result = emitter.off("test", fn);
    expect(result).toBe(emitter);
  });

  // ─── addListener / removeListener ─────────────────────────────

  it("addListener should alias on()", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.addListener("test", fn);
    emitter.emit("test");
    expect(fn).toHaveBeenCalled();
  });

  it("removeListener should alias off()", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("test", fn);
    emitter.removeListener("test", fn);
    emitter.emit("test");
    expect(fn).not.toHaveBeenCalled();
  });

  // ─── removeAllListeners ────────────────────────────────────────

  it("should remove all listeners for a specific event", () => {
    const emitter = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on("test", fn1);
    emitter.on("test", fn2);
    emitter.removeAllListeners("test");
    expect(emitter.emit("test")).toBe(false);
  });

  it("should remove all listeners for all events when no event specified", () => {
    const emitter = new EventEmitter();
    emitter.on("a", vi.fn());
    emitter.on("b", vi.fn());
    emitter.removeAllListeners();
    expect(emitter.emit("a")).toBe(false);
    expect(emitter.emit("b")).toBe(false);
  });

  // ─── listenerCount ────────────────────────────────────────────

  it("should return correct listener count", () => {
    const emitter = new EventEmitter();
    expect(emitter.listenerCount("test")).toBe(0);
    emitter.on("test", () => {});
    expect(emitter.listenerCount("test")).toBe(1);
    emitter.on("test", () => {});
    expect(emitter.listenerCount("test")).toBe(2);
  });

  it("listenerCount should decrease after off()", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("test", fn);
    expect(emitter.listenerCount("test")).toBe(1);
    emitter.off("test", fn);
    expect(emitter.listenerCount("test")).toBe(0);
  });

  // ─── Edge Cases ────────────────────────────────────────────────

  it("should handle emit with no arguments", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("test", fn);
    emitter.emit("test");
    expect(fn).toHaveBeenCalledWith();
  });

  it("should not interfere between different events", () => {
    const emitter = new EventEmitter();
    const fnA = vi.fn();
    const fnB = vi.fn();
    emitter.on("a", fnA);
    emitter.on("b", fnB);
    emitter.emit("a");
    expect(fnA).toHaveBeenCalled();
    expect(fnB).not.toHaveBeenCalled();
  });

  it("should safely iterate when a listener removes itself", () => {
    const emitter = new EventEmitter();
    const selfRemover = vi.fn(() => {
      emitter.off("test", selfRemover);
    });
    const other = vi.fn();
    emitter.on("test", selfRemover);
    emitter.on("test", other);
    emitter.emit("test");
    expect(selfRemover).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("should cleanup map entry when last listener is removed", () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on("test", fn);
    emitter.off("test", fn);
    // No remaining listeners → emit returns false
    expect(emitter.emit("test")).toBe(false);
    expect(emitter.listenerCount("test")).toBe(0);
  });
});
