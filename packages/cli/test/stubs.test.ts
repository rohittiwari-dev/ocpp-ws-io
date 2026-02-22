import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStubCommand } from "../src/commands/stubs.js";

describe("createStubCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create a function that logs description", () => {
    const command = createStubCommand("test-cmd", "Test Description");
    command({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("test-cmd"));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Test Description"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("under development"),
    );
  });
});
