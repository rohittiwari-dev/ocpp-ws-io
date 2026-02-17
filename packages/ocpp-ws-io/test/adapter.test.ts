import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../src/adapters/adapter.js";

describe("InMemoryAdapter", () => {
  it("should publish and receive messages", async () => {
    const adapter = new InMemoryAdapter();
    let received: unknown;

    await adapter.subscribe("test", (data) => {
      received = data;
    });

    await adapter.publish("test", { hello: "world" });
    expect(received).toEqual({ hello: "world" });
  });

  it("should support multiple subscribers", async () => {
    const adapter = new InMemoryAdapter();
    const received: unknown[] = [];

    await adapter.subscribe("ch", (data) => received.push(`a:${data}`));
    await adapter.subscribe("ch", (data) => received.push(`b:${data}`));

    await adapter.publish("ch", "msg1");
    expect(received).toEqual(["a:msg1", "b:msg1"]);
  });

  it("should not deliver to unrelated channels", async () => {
    const adapter = new InMemoryAdapter();
    let received = false;

    await adapter.subscribe("channelA", () => {
      received = true;
    });
    await adapter.publish("channelB", "data");

    expect(received).toBe(false);
  });

  it("should unsubscribe from a channel", async () => {
    const adapter = new InMemoryAdapter();
    let count = 0;

    await adapter.subscribe("ch", () => {
      count++;
    });
    await adapter.publish("ch", "msg1");
    expect(count).toBe(1);

    await adapter.unsubscribe("ch");
    await adapter.publish("ch", "msg2");
    expect(count).toBe(1); // Still 1 after unsubscribe
  });

  it("should clear all channels on disconnect", async () => {
    const adapter = new InMemoryAdapter();
    let count = 0;

    await adapter.subscribe("ch1", () => {
      count++;
    });
    await adapter.subscribe("ch2", () => {
      count++;
    });

    await adapter.disconnect();

    await adapter.publish("ch1", "x");
    await adapter.publish("ch2", "x");
    expect(count).toBe(0);
  });

  it("should swallow handler errors silently", async () => {
    const adapter = new InMemoryAdapter();
    let secondCalled = false;

    await adapter.subscribe("ch", () => {
      throw new Error("oops");
    });
    await adapter.subscribe("ch", () => {
      secondCalled = true;
    });

    // Should not throw
    await adapter.publish("ch", "data");
    expect(secondCalled).toBe(true);
  });
});
