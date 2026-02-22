import { promises as fs } from "fs";
import { compileFromFile } from "json-schema-to-typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCommand } from "../src/commands/generate.js";

vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock("json-schema-to-typescript", () => ({
  compileFromFile: vi.fn(),
}));

describe("generateCommand", () => {
  let logSpy: any;
  let errorSpy: any;
  let exitSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should aggressively exit if options are missing", async () => {
    await generateCommand({});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("arguments are required"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should recursively compile valid JSON schemas into TypeScript", async () => {
    // Mock readdir simulating valid JSON files
    (fs.readdir as any).mockResolvedValueOnce([
      {
        isDirectory: () => false,
        isFile: () => true,
        name: "BootNotification.json",
      },
    ]);

    (compileFromFile as any).mockResolvedValue(
      "export interface BootNotification {}",
    );

    await generateCommand({ schemas: "./schemas", out: "./out" });

    expect(fs.mkdir).toHaveBeenCalledWith("./out", { recursive: true });
    expect(compileFromFile).toHaveBeenCalledWith(
      expect.stringContaining("BootNotification.json"),
      expect.any(Object),
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("BootNotification.ts"),
      "export interface BootNotification {}",
      "utf-8",
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Successfully generated"),
    );
  });

  it("should warn if no sub-files are found", async () => {
    // Simulate empty directory
    (fs.readdir as any).mockResolvedValueOnce([]);

    await generateCommand({ schemas: "./schemas", out: "./out" });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(fs.mkdir).toHaveBeenCalledWith("./out", { recursive: true });
    expect(compileFromFile).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
