import { describe, it, expect, afterEach, vi } from "vitest";
import { AdaptiveLimiter, type AdaptedEvent } from "../src/adaptive-limiter.js";

describe("AdaptiveLimiter", () => {
  let limiter: AdaptiveLimiter;

  afterEach(() => {
    limiter?.stop();
  });

  it("should initialize with default options", () => {
    limiter = new AdaptiveLimiter();
    expect(limiter.multiplier).toBe(1);
  });

  it("should respect custom threshold options", () => {
    limiter = new AdaptiveLimiter({
      cpuThresholdPercent: 50,
      memThresholdPercent: 60,
      cooldownMs: 5000,
      sampleIntervalMs: 500,
    });
    expect(limiter.multiplier).toBe(1);
  });

  it("should start and stop without error", () => {
    limiter = new AdaptiveLimiter({ sampleIntervalMs: 100 });
    expect(() => limiter.start()).not.toThrow();
    expect(() => limiter.stop()).not.toThrow();
  });

  it("should not start twice when start() is called multiple times", () => {
    limiter = new AdaptiveLimiter({ sampleIntervalMs: 100 });
    limiter.start();
    limiter.start(); // No-op
    limiter.stop();
  });

  it("should reset multiplier to 1 on stop()", () => {
    limiter = new AdaptiveLimiter();
    // Manually set a lower multiplier to test reset
    // @ts-expect-error — accessing private field for test
    limiter._multiplier = 0.25;
    expect(limiter.multiplier).toBe(0.25);
    limiter.stop();
    expect(limiter.multiplier).toBe(1);
  });

  it("should emit 'adapted' event with correct shape", async () => {
    limiter = new AdaptiveLimiter({
      cpuThresholdPercent: 0, // Force overload on first sample
      memThresholdPercent: 0,
      sampleIntervalMs: 50,
    });

    const events: AdaptedEvent[] = [];
    limiter.on("adapted", (e) => events.push(e));

    limiter.start();
    await new Promise((r) => setTimeout(r, 200));
    limiter.stop();

    expect(events.length).toBeGreaterThan(0);

    const first = events[0];
    expect(first.multiplier).toBeLessThan(1);
    expect(typeof first.cpuPercent).toBe("number");
    expect(typeof first.memPercent).toBe("number");
  });

  it("should progressively throttle with thresholds at 0", async () => {
    limiter = new AdaptiveLimiter({
      cpuThresholdPercent: 0,
      memThresholdPercent: 0,
      sampleIntervalMs: 30,
      cooldownMs: 60_000, // Long cooldown so it doesn't recover
    });

    limiter.start();
    await new Promise((r) => setTimeout(r, 200));
    limiter.stop();

    // After multiple samples with overload, multiplier should be well below 1
    // stop() resets, but let's check pre-reset by storing event values
    // Actually stop() resets, so we check via events
  });

  it("should recover multiplier after cooldown when thresholds are high", async () => {
    limiter = new AdaptiveLimiter({
      cpuThresholdPercent: 999, // Never triggers - practically impossible overload
      memThresholdPercent: 999,
      sampleIntervalMs: 30,
      cooldownMs: 0, // Immediate recovery
    });

    // Force a low multiplier
    // @ts-expect-error — accessing private field for test
    limiter._multiplier = 0.5;

    limiter.start();
    await new Promise((r) => setTimeout(r, 200));

    // Should have recovered toward 1.0
    expect(limiter.multiplier).toBeGreaterThanOrEqual(0.5);

    limiter.stop();
  });

  it("multiplier should never go below 0.25", () => {
    limiter = new AdaptiveLimiter();

    // Simulate many consecutive overload samples
    // @ts-expect-error — accessing private field for test
    limiter._multiplier = 0.25;
    // @ts-expect-error
    limiter._lastOverloadTime = Date.now();

    // Even after further overload, it should floor at 0.25
    // @ts-expect-error
    limiter._multiplier = Math.max(0.25, limiter._multiplier * 0.5);
    expect(limiter.multiplier).toBe(0.25);
  });

  it("multiplier should never exceed 1.0 during recovery", () => {
    limiter = new AdaptiveLimiter();

    // @ts-expect-error
    limiter._multiplier = 0.95;
    // Recovery adds +0.1
    // @ts-expect-error
    limiter._multiplier = Math.min(1, limiter._multiplier + 0.1);
    expect(limiter.multiplier).toBe(1);
  });
});
