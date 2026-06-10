import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OCPPClient } from "../src/client.js";

describe("shared backpressure drain (M10)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("queued sends share one timer and flush FIFO", () => {
    const sent: string[] = [];
    const fakeWs: any = {
      readyState: 1, // WebSocket.OPEN
      bufferedAmount: 600 * 1024, // above the 512KB threshold
      send: (d: string, cb?: (err?: Error) => void) => {
        sent.push(d);
        cb?.();
      },
    };
    const client = new OCPPClient({ identity: "X", endpoint: "ws://x" });

    (client as any)._safeSend(fakeWs, "a");
    (client as any)._safeSend(fakeWs, "b");
    expect(sent).toEqual([]);
    expect((client as any)._backpressureTimer).not.toBeNull();

    fakeWs.bufferedAmount = 0;
    vi.advanceTimersByTime(100);

    expect(sent).toEqual(["a", "b"]);
    expect((client as any)._backpressureTimer).toBeNull();
  });
});
