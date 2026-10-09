import { expectTypeOf } from "vitest";
import { BrowserOCPPClient } from "../../src/browser/client.js";
import { OCPPClient } from "../../src/client/client.js";
import type { CallOptions } from "../../src/types.js";

export function optionalCallOptions(options?: CallOptions) {
  const settings = {
    identity: "cp",
    endpoint: "ws://localhost:9220",
    protocols: ["ocpp1.6"] as const,
  };
  const node = new OCPPClient(settings);
  const browser = new BrowserOCPPClient(settings);
  for (const client of [node, browser]) {
    expectTypeOf(client.call("Heartbeat", {}, options))
      .toEqualTypeOf<Promise<{ currentTime: string }>>();
    expectTypeOf(client.call("Heartbeat", {}, undefined))
      .toEqualTypeOf<Promise<{ currentTime: string }>>();
    expectTypeOf(client.call("Heartbeat", {}))
      .toEqualTypeOf<Promise<{ currentTime: string }>>();
    expectTypeOf(client.call("ocpp1.6", "Heartbeat", {}, options))
      .toEqualTypeOf<Promise<{ currentTime: string }>>();
    expectTypeOf(client.call("Heartbeat", {}, { noReply: true }))
      .toEqualTypeOf<Promise<void>>();
    // @ts-expect-error accepting undefined must not bypass payload checks
    void client.call("Heartbeat", { extra: true }, options);
    const widened = { noReply: true };
    // @ts-expect-error noReply still requires a literal true
    void client.call("Heartbeat", {}, widened);
    // @ts-expect-error options still require a numeric timeout
    void client.call("Heartbeat", {}, { timeoutMs: "1000" });
  }
}
