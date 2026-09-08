import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webhookPlugin } from "../src/plugins/webhook.js";

/**
 * Covers the parts a receiver actually depends on: that the signature can be
 * verified and binds the request to a moment, that the idempotency key is
 * unique per event rather than per millisecond, and that a bound on concurrency
 * delays deliveries instead of dropping them.
 */

const client = (identity: string) =>
  ({
    identity,
    protocol: "ocpp1.6",
    handshake: { remoteAddress: "127.0.0.1" },
  }) as never;

type Sent = { headers: Record<string, string>; body: string };

/** Replace global fetch, recording every request. */
function captureFetch(impl?: () => Promise<Response>) {
  const sent: Sent[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async (_url: string, init: RequestInit) => {
      sent.push({
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      });
      return impl ? impl() : ({ ok: true, status: 200 } as Response);
    }) as never);
  return { sent, spy };
}

describe("webhookPlugin", () => {
  afterEach(() => vi.restoreAllMocks());

  it("signs the timestamp together with the body", async () => {
    const { sent } = captureFetch();
    const secret = "shhh";
    const plugin = webhookPlugin({ url: "https://x.test", secret });

    plugin.onConnection?.(client("CP001"));
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const { headers, body } = sent[0]!;
    const ts = headers["X-Signature-Timestamp"];
    expect(ts).toBeTypeOf("string");
    expect(headers["X-Signature-Algorithm"]).toBe("HMAC-SHA256");

    // A receiver must be able to reproduce this exactly.
    const expected = createHmac("sha256", secret)
      .update(`${ts}.${body}`)
      .digest("hex");
    expect(headers["X-Signature"]).toBe(expected);

    // Signing the body alone would leave the timestamp forgeable, so a
    // signature over the body only must NOT verify.
    const bodyOnly = createHmac("sha256", secret).update(body).digest("hex");
    expect(headers["X-Signature"]).not.toBe(bodyOnly);
  });

  it("gives events in the same millisecond distinct idempotency keys", async () => {
    const { sent } = captureFetch();
    const plugin = webhookPlugin({ url: "https://x.test" });

    // Same event type, same instant — the collision that made a deduplicating
    // receiver discard real events.
    plugin.onConnection?.(client("CP001"));
    plugin.onConnection?.(client("CP002"));
    plugin.onConnection?.(client("CP003"));
    await vi.waitFor(() => expect(sent).toHaveLength(3));

    const keys = sent.map((s) => s.headers["X-Idempotency-Key"]);
    expect(new Set(keys).size).toBe(3);
  });

  it("sends an idempotency key even with no secret configured", async () => {
    const { sent } = captureFetch();
    const plugin = webhookPlugin({ url: "https://x.test" });
    plugin.onConnection?.(client("CP001"));
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]!.headers["X-Idempotency-Key"]).toBeTypeOf("string");
    expect(sent[0]!.headers["X-Signature"]).toBeUndefined();
  });

  it("keeps one idempotency key across retries of the same event", async () => {
    let calls = 0;
    const { sent } = captureFetch(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 500 } as Response;
      return { ok: true, status: 200 } as Response;
    });
    const plugin = webhookPlugin({ url: "https://x.test", retries: 1 });

    plugin.onConnection?.(client("CP001"));
    await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 3000 });

    // A retry is the same event; the receiver must be able to deduplicate it.
    expect(sent[0]!.headers["X-Idempotency-Key"]).toBe(
      sent[1]!.headers["X-Idempotency-Key"],
    );
  });

  it("bounds in-flight requests without dropping any", async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const { sent } = captureFetch(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => release.push(r));
      inFlight--;
      return { ok: true, status: 200 } as Response;
    });

    const plugin = webhookPlugin({ url: "https://x.test", maxConcurrent: 2 });
    for (let i = 0; i < 6; i++) plugin.onConnection?.(client(`CP00${i}`));

    await vi.waitFor(() => expect(release.length).toBe(2));
    expect(peak).toBe(2);

    // Drain; everything queued must still be delivered.
    while (release.length || sent.length < 6) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await vi.waitFor(() => expect(sent).toHaveLength(6));
    expect(peak).toBe(2);
  });

  it("does not send message events unless they are asked for", async () => {
    const { sent } = captureFetch();
    const plugin = webhookPlugin({ url: "https://x.test" });

    plugin.onMessage?.(client("CP001"), {
      message: [2, "id1", "Heartbeat", {}],
      direction: "IN",
      ctx: {
        type: "incoming_call",
        messageId: "id1",
        method: "Heartbeat",
        params: {},
        timestamp: new Date().toISOString(),
      },
    } as never);

    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(0);
  });

  it("omits the OCPP payload from message events unless includePayload is set", async () => {
    const { sent } = captureFetch();
    const base = {
      message: [2, "id1", "Authorize", { idTag: "SECRET-TAG" }],
      direction: "IN",
      ctx: {
        type: "incoming_call",
        messageId: "id1",
        method: "Authorize",
        params: {},
        timestamp: new Date().toISOString(),
      },
    };

    const quiet = webhookPlugin({
      url: "https://x.test",
      events: ["message"],
      maxConcurrent: 4,
    });
    quiet.onMessage?.(client("CP001"), base as never);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).not.toContain("SECRET-TAG");
    expect(sent[0]!.body).toContain("Authorize"); // metadata still useful

    const loud = webhookPlugin({
      url: "https://x.test",
      events: ["message"],
      maxConcurrent: 4,
      includePayload: true,
    });
    loud.onMessage?.(client("CP001"), base as never);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.body).toContain("SECRET-TAG");
  });

  it("warns through the server logger when message events are unbounded", () => {
    const warn = vi.fn();
    const plugin = webhookPlugin({ url: "https://x.test", events: ["message"] });
    plugin.onInit?.({ log: { warn } } as never);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("maxConcurrent");
  });

  it("stays quiet when message events are bounded", () => {
    const warn = vi.fn();
    const plugin = webhookPlugin({
      url: "https://x.test",
      events: ["message"],
      maxConcurrent: 5,
    });
    plugin.onInit?.({ log: { warn } } as never);
    expect(warn).not.toHaveBeenCalled();
  });
});
