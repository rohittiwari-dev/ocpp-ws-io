import { describe, it, expect, vi, beforeEach } from "vitest";
import { MiddlewareStack } from "../src/middleware";
import { createLoggingMiddleware } from "../src/helpers/index.js";
import type { LoggerLike, MiddlewareContext } from "../src/types";

describe("MiddlewareStack", () => {
  it("should execute middleware in order", async () => {
    const stack = new MiddlewareStack<any>();
    const order: number[] = [];

    stack.use(async (ctx, next) => {
      order.push(1);
      await next();
      order.push(4);
    });

    stack.use(async (ctx, next) => {
      order.push(2);
      await next();
      order.push(3);
    });

    await stack.execute({}, () => {
      order.push(99);
    });

    expect(order).toEqual([1, 2, 99, 3, 4]);
  });

  it("should handle empty stack", async () => {
    const stack = new MiddlewareStack<any>();
    const runner = vi.fn();
    await stack.execute({}, runner);
    expect(runner).toHaveBeenCalled();
  });

  it("should throw if next() is called multiple times", async () => {
    const stack = new MiddlewareStack<any>();
    stack.use(async (ctx, next) => {
      await next();
      await next();
    });

    await expect(stack.execute({}, () => {})).rejects.toThrow(
      "next() called multiple times",
    );
  });

  it("should handle errors in middleware", async () => {
    const stack = new MiddlewareStack<any>();
    stack.use(async () => {
      throw new Error("fail");
    });

    await expect(stack.execute({}, () => {})).rejects.toThrow("fail");
  });
});

describe("createLoggingMiddleware", () => {
  let logger: any;
  let next: any;

  beforeEach(() => {
    logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    next = vi.fn().mockResolvedValue(undefined);
  });

  const runMw = async (ctx: any) => {
    const mw = createLoggingMiddleware(logger, "TEST");
    return mw(ctx, next);
  };

  it("should log incoming_call start and end (success)", async () => {
    const ctx: Partial<MiddlewareContext> = {
      type: "incoming_call",
      method: "Test",
      params: { a: 1 },
      messageId: "123",
      protocol: "ocpp1.6",
    };

    next.mockResolvedValue({ status: "Accepted" });

    await runMw(ctx);

    // Start log
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("←  Test  [IN]"),
      expect.objectContaining({ direction: "IN", messageId: "123" }),
    );

    // End log
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("→  Test  [RES]"),
      expect.objectContaining({
        direction: "OUT",
        params: { status: "Accepted" },
      }),
    );
  });

  it("should log outgoing_call start and end (success)", async () => {
    const ctx: Partial<MiddlewareContext> = {
      type: "outgoing_call",
      method: "BootNotification",
      params: {},
      messageId: "456",
    };

    next.mockResolvedValue({ interval: 300 }); // Result from server

    await runMw(ctx);

    // Start log
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("→  BootNotification  [OUT]"),
      expect.objectContaining({ direction: "OUT" }),
    );

    // End log
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("←  BootNotification  [RES]"),
      expect.objectContaining({ direction: "IN", params: { interval: 300 } }),
    );
  });

  it("should log incoming_result", async () => {
    // This happens when client receives a result for a call it sent?
    // Actually logging.ts handles 'incoming_result' in the END switch (lines 77-86)
    // But wait, 'incoming_result' is a distinct context type?
    // Yes, likely used when processing a generic message that is a result.

    const ctx: Partial<MiddlewareContext> = {
      type: "incoming_result",
      method: "PreviouslySent",
      messageId: "789",
      payload: { status: "OK" },
    };

    await runMw(ctx);

    // No START log for incoming_result in current impl (switch only has calls)

    // End log
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("←  PreviouslySent  [RES]"),
      expect.objectContaining({ direction: "IN", payload: { status: "OK" } }),
    );
  });

  it("should log handler error for incoming_call", async () => {
    const ctx: Partial<MiddlewareContext> = {
      type: "incoming_call",
      method: "FailMe",
      messageId: "err1",
    };

    next.mockRejectedValue(new Error("Crash"));

    await expect(runMw(ctx)).rejects.toThrow("Crash");

    expect(logger.error).toHaveBeenCalledWith(
      "Handler error",
      expect.objectContaining({ method: "FailMe", error: "Crash" }),
    );
  });

  it("should log call error for outgoing_call", async () => {
    const ctx: Partial<MiddlewareContext> = {
      type: "outgoing_call",
      method: "FailCall",
      messageId: "err2",
    };

    next.mockRejectedValue(new Error("NetworkFail"));

    await expect(runMw(ctx)).rejects.toThrow("NetworkFail");

    expect(logger.error).toHaveBeenCalledWith(
      "Call error",
      expect.objectContaining({ method: "FailCall", error: "NetworkFail" }),
    );
  });
});
