import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { OCPPServerClient } from "../src/server-client.js";

/**
 * onBeforeSend and onBeforeReceive fail open, which is right — a broken plugin
 * must not stop OCPP traffic. They failed open *silently*, which is not: a
 * security plugin throwing on every message let everything through with
 * nothing recorded anywhere.
 */

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  protocol = "ocpp1.6";
  send = vi.fn();
  close = vi.fn();
  terminate = vi.fn();
  ping = vi.fn();
  pong = vi.fn();
}

function makeClient(plugins: unknown[], errors: string[]) {
  return new OCPPServerClient(
    {
      identity: "CP001",
      endpoint: "ws://localhost",
      logging: {
        logger: {
          error: (msg: string, meta?: Record<string, unknown>) =>
            errors.push(`${msg}|${meta?.name}`),
          warn: () => {},
          info: () => {},
          debug: () => {},
        },
      },
    } as never,
    {
      ws: new FakeSocket() as never,
      handshake: {
        identity: "CP001",
        remoteAddress: "127.0.0.1",
        headers: {},
        protocols: new Set(["ocpp1.6"]),
        pathname: "/CP001",
        params: {},
        query: new URLSearchParams(),
        request: {} as never,
      },
      session: {},
      protocol: "ocpp1.6",
      plugins: plugins as never,
    },
  );
}

const deliver = (c: OCPPServerClient, frame: string) =>
  (
    c as unknown as { _processInboundMessage(d: unknown): Promise<void> }
  )._processInboundMessage(Buffer.from(frame));

describe("interception hooks that throw", () => {
  const frame = '[2,"id1","Heartbeat",{}]';

  it("reports a synchronous onBeforeReceive throw and still delivers", async () => {
    const errors: string[] = [];
    const client = makeClient(
      [
        {
          name: "broken",
          onBeforeReceive() {
            throw new Error("plugin exploded");
          },
        },
      ],
      errors,
    );
    const onMessage = vi.spyOn(
      client as unknown as { _onMessage(...a: unknown[]): void },
      "_onMessage",
    );

    await deliver(client, frame);

    expect(onMessage).toHaveBeenCalledTimes(1); // fails open, as intended
    expect(errors.some((e) => e.includes("onBeforeReceive"))).toBe(true);
  });

  it("reports an async onBeforeSend rejection and still sends", async () => {
    const errors: string[] = [];
    const client = makeClient(
      [
        {
          name: "broken-send",
          async onBeforeSend() {
            throw new Error("send hook exploded");
          },
        },
      ],
      errors,
    );

    const allowed = await (
      client as unknown as {
        _invokeBeforeSend(m: unknown): boolean | Promise<boolean>;
      }
    )._invokeBeforeSend([2, "id", "Heartbeat", {}]);

    expect(allowed).toBe(true); // fails open
    expect(errors.some((e) => e.includes("onBeforeSend"))).toBe(true);
  });

  it("logs once per plugin rather than once per message", async () => {
    const errors: string[] = [];
    const client = makeClient(
      [
        {
          name: "always-broken",
          onBeforeReceive() {
            throw new Error("every single time");
          },
        },
      ],
      errors,
    );

    // A plugin that throws once throws on every message; logging each would
    // turn a broken plugin into a log flood at wire rate.
    for (let i = 0; i < 25; i++) await deliver(client, frame);
    expect(errors.filter((e) => e.includes("onBeforeReceive"))).toHaveLength(1);
  });

  it("still lets a healthy plugin block a message", async () => {
    const errors: string[] = [];
    const client = makeClient(
      [{ name: "blocker", onBeforeReceive: () => false }],
      errors,
    );
    const onMessage = vi.spyOn(
      client as unknown as { _onMessage(...a: unknown[]): void },
      "_onMessage",
    );

    await deliver(client, frame);
    expect(onMessage).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });
});
