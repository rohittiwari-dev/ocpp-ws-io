import { describe, test, expect, vi } from "vitest";
import { OCPPClient } from "../src/client";

class TestClient extends OCPPClient {
  constructor() {
    super({ identity: "test", endpoint: "" });
  }

  // Override call to simulate failure
  // @ts-ignore
  override async call(...args: any[]): Promise<any> {
    throw new Error("Simulated Failure");
  }
}

describe("OCPPClient safeCall", () => {
  test("returns null when call throws", async () => {
    const client = new TestClient();

    // Mock logger to verify warning and avoid voltlog issues in test
    const warnSpy = vi.fn();
    // @ts-ignore - reaching into private/protected
    client._logger = {
      warn: warnSpy,
      debug: () => {},
      info: () => {},
      error: () => {},
      child: () =>
        ({
          warn: warnSpy,
          debug: () => {},
          info: () => {},
          error: () => {},
        } as any),
    };

    // We expect safeCall to catch the error from our overridden call()
    const result = await client.safeCall("Test", {});
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "SafeCall failed",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });
});
