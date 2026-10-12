import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { OCPPResponseType } from "../../src/generated/index.js";
import { InMemorySessionStore } from "../../src/proxy/core/session.js";
import { OCPPTranslator } from "../../src/proxy/core/translator.js";
import {
  MessageType,
  type ProxyPayload,
  type TranslationContext,
  type TranslationMap,
} from "../../src/proxy/core/types.js";

function makeCtx(): TranslationContext {
  return {
    identity: "test-cp",
    sourceProtocol: "ocpp1.6",
    targetProtocol: "ocpp2.1",
    session: new InMemorySessionStore(),
  };
}

const answer = (payload: ProxyPayload) =>
  ({ type: MessageType.CALLRESULT, messageId: "m1", payload }) as const;

/** The 1.6 charger's answer to a RequestStartTransaction sent as RemoteStartTransaction. */
const remoteStartAnswer = (t: OCPPTranslator) =>
  t.translateDownstreamResult(
    answer({ status: "Accepted" }),
    "RemoteStartTransaction",
    "RequestStartTransaction",
    makeCtx(),
  );

// A charger's answer to a CSMS call is keyed by the charger's protocol and the
// action it was sent, the answer the mapper receives (O23).
describe("a charger's answer to a CSMS call", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is mapped by the charger's protocol and the action it was sent", async () => {
    const t = new OCPPTranslator({
      upstream: {},
      downstream: {},
      responses: {
        "ocpp1.6:RemoteStartTransactionResponse": (params) => ({
          status: params.status,
          by: "ocpp1.6",
        }),
      },
    });

    expect((await remoteStartAnswer(t)).payload).toEqual({
      status: "Accepted",
      by: "ocpp1.6",
    });
  });

  it("still finds a mapper keyed by the CSMS's protocol and action, with a deprecation warning once", async () => {
    const warn = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const t = new OCPPTranslator({
      upstream: {},
      downstream: {},
      responses: {
        "ocpp2.1:RequestStartTransactionResponse": () => ({
          status: "Accepted",
          by: "ocpp2.1",
        }),
      },
    });

    expect((await remoteStartAnswer(t)).payload).toEqual({
      status: "Accepted",
      by: "ocpp2.1",
    });
    await remoteStartAnswer(t);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      '"ocpp1.6:RemoteStartTransactionResponse"',
    );
  });

  it("prefers the charger-keyed mapper when both are set", async () => {
    const warn = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const t = new OCPPTranslator({
      upstream: {},
      downstream: {},
      responses: {
        "ocpp1.6:RemoteStartTransactionResponse": () => ({ by: "ocpp1.6" }),
        "ocpp2.1:RequestStartTransactionResponse": () => ({ by: "ocpp2.1" }),
      },
    });

    expect((await remoteStartAnswer(t)).payload).toEqual({ by: "ocpp1.6" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes through without a mapper", async () => {
    const t = new OCPPTranslator({ upstream: {}, downstream: {} });

    expect((await remoteStartAnswer(t)).payload).toEqual({
      status: "Accepted",
    });
  });

  it("types a charger-keyed mapper's params as the charger's answer", () => {
    const map: TranslationMap["responses"] = {
      "ocpp1.6:SetChargingProfileResponse": (params) => {
        expectTypeOf(params).toEqualTypeOf<
          OCPPResponseType<"ocpp1.6", "SetChargingProfile">
        >();
        return {};
      },
    };
    expect(map).toBeDefined();
  });
});
