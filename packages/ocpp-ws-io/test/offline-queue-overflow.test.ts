import { describe, expect, test } from "vitest";
import { OCPPClient } from "../src/client.js";

describe("offline queue overflow (H2)", () => {
  test("oldest queued call is rejected, not stranded", async () => {
    const client = new OCPPClient({
      identity: "CP-OQ",
      endpoint: "ws://127.0.0.1:1",
      reconnect: false,
      offlineQueue: true,
      offlineQueueMaxSize: 1,
    });

    const p1 = client.call("First", {});
    const p2 = client.call("Second", {}); // overflows, drops p1
    p2.catch(() => {}); // stays pending; silence any later rejection

    await expect(p1).rejects.toThrow(/overflow/i);
  });
});
