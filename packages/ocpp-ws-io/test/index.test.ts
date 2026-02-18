import { describe, it, expect } from "vitest";
import * as index from "../src/index.js";

describe("Index Exports", () => {
  it("should export all public members", () => {
    expect(index.OCPPServer).toBeDefined();
    expect(index.OCPPClient).toBeDefined();
    // RedisAdapter is not exported from index.ts by design

    expect(index.InMemoryAdapter).toBeDefined();
    expect(index.createValidator).toBeDefined();
  });
});
