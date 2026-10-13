import { describe, expect, it, vi } from "vitest";
import { InMemorySessionStore } from "../../src/proxy/core/session.js";
import {
  MessageType,
  type OCPPMessage,
  type TranslationContext,
} from "../../src/proxy/core/types.js";
import {
  createTelemetryMiddleware,
  TelemetryMiddleware,
} from "../../src/proxy/middlewares/telemetry.js";

function makeCtx(): TranslationContext {
  return {
    identity: "CP-1",
    sourceProtocol: "ocpp1.6",
    targetProtocol: "ocpp2.1",
    session: new InMemorySessionStore(),
  };
}

const call = (action: string): OCPPMessage => ({
  type: MessageType.CALL,
  messageId: "m1",
  action,
  payload: {},
});

// O2: the middleware measured a latency and reported it nowhere.
describe("telemetry middleware", () => {
  it("reports each translation step's latency, from pre to post", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    try {
      const onLatency = vi.fn();
      const mw = createTelemetryMiddleware({ onLatency });
      const ctx = makeCtx();

      await mw(call("StartTransaction"), ctx, "upstream", "pre");
      vi.setSystemTime(1_007);
      await mw(call("TransactionEvent"), ctx, "upstream", "post");

      expect(onLatency).toHaveBeenCalledTimes(1);
      expect(onLatency).toHaveBeenCalledWith(
        "StartTransaction",
        7,
        ctx,
        "upstream",
      );
      // Nothing left behind in the session.
      expect(
        await ctx.session.get(ctx.identity, "telemetryStart_m1"),
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an answer without an action", async () => {
    const onLatency = vi.fn();
    const mw = createTelemetryMiddleware({ onLatency });
    const ctx = makeCtx();
    const answer: OCPPMessage = {
      type: MessageType.CALLRESULT,
      messageId: "m2",
      payload: {},
    };

    await mw(answer, ctx, "response", "pre");
    await mw(answer, ctx, "response", "post");

    expect(onLatency).toHaveBeenCalledWith(
      undefined,
      expect.any(Number),
      ctx,
      "response",
    );
  });

  it("reports nothing for a post without its pre", async () => {
    const onLatency = vi.fn();
    const mw = createTelemetryMiddleware({ onLatency });

    await mw(call("Heartbeat"), makeCtx(), "error", "post");

    expect(onLatency).not.toHaveBeenCalled();
  });

  it("still exports TelemetryMiddleware, which passes messages on", async () => {
    const ctx = makeCtx();
    expect(await TelemetryMiddleware(call("Heartbeat"), ctx, "upstream", "pre")).toBeUndefined();
    expect(await TelemetryMiddleware(call("Heartbeat"), ctx, "upstream", "post")).toBeUndefined();
  });
});
