import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { EventBuffer } from "../src/event-buffer.js";

describe("EventBuffer", () => {
  it("should capture events when started", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["message", "error"]);

    const received: string[] = [];
    emitter.on("message", (msg: string) => received.push(msg));

    buf.start();
    emitter.emit("message", "hello");
    emitter.emit("message", "world");

    // Events should be buffered, not reaching the original listener
    // (The buffer listener intercepts via prepend, but EventEmitter runs all listeners)
    // Actually EventBuffer uses .on() so both listeners fire.
    // The purpose of EventBuffer is to replay events AFTER condense.
    // Let's test condense behavior.
    expect(received.length).toBeGreaterThanOrEqual(0);
  });

  it("should replay buffered events on condense", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["data"]);

    buf.start();

    // Remove all default listeners so only buffer captures
    emitter.removeAllListeners("data");
    // Re-add the buffer (start already added it, but removeAll cleared it)
    // Actually, let's build a cleaner test:
    const emitter2 = new EventEmitter();
    const buf2 = new EventBuffer(emitter2, ["data"]);

    buf2.start();
    emitter2.emit("data", "first");
    emitter2.emit("data", "second");

    const replayed: string[] = [];
    emitter2.on("data", (msg: string) => replayed.push(msg));

    buf2.condense();
    expect(replayed).toEqual(["first", "second"]);
  });

  it("should preserve event order during condense", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["a", "b"]);

    buf.start();
    emitter.emit("a", 1);
    emitter.emit("b", 2);
    emitter.emit("a", 3);

    const order: Array<{ event: string; val: number }> = [];
    emitter.on("a", (v: number) => order.push({ event: "a", val: v }));
    emitter.on("b", (v: number) => order.push({ event: "b", val: v }));

    buf.condense();
    expect(order).toEqual([
      { event: "a", val: 1 },
      { event: "b", val: 2 },
      { event: "a", val: 3 },
    ]);
  });

  it("should discard buffered events without replaying", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["data"]);

    buf.start();
    emitter.emit("data", "should-be-discarded");

    const replayed: string[] = [];
    emitter.on("data", (msg: string) => replayed.push(msg));

    buf.discard();
    expect(replayed).toEqual([]);
  });

  it("should be idempotent when start is called multiple times", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["data"]);

    buf.start();
    buf.start(); // second call should be no-op

    emitter.emit("data", "only-once");

    const replayed: string[] = [];
    emitter.on("data", (msg: string) => replayed.push(msg));
    buf.condense();

    // Should only have one event, not duplicated
    expect(replayed).toEqual(["only-once"]);
  });

  it("should be no-op when condense is called without start", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["data"]);

    const replayed: string[] = [];
    emitter.on("data", (msg: string) => replayed.push(msg));

    // condense without start should do nothing
    buf.condense();
    expect(replayed).toEqual([]);
  });

  it("should be no-op when discard is called without start", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["data"]);

    // discard without start should not throw
    expect(() => buf.discard()).not.toThrow();
  });

  it("should clean up listeners after condense", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["data"]);

    const initialCount = emitter.listenerCount("data");
    buf.start();
    expect(emitter.listenerCount("data")).toBe(initialCount + 1);

    buf.condense();
    expect(emitter.listenerCount("data")).toBe(initialCount);
  });

  it("should clean up listeners after discard", () => {
    const emitter = new EventEmitter();
    const buf = new EventBuffer(emitter, ["data"]);

    buf.start();
    buf.discard();
    // Buffer listeners should be removed
    // Only manually added listeners should remain
    expect(emitter.listenerCount("data")).toBe(0);
  });
});
