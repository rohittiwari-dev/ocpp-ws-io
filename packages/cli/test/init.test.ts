import { promises as fs } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "../src/commands/init.js";

vi.mock("fs", () => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe("initCommand", () => {
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

  it("should create project directory and write default configuration files", async () => {
    const dir = "test-project";

    // We expect successful execution
    await initCommand(dir);

    const expectedPath = join(process.cwd(), dir);

    // Check if correct directories were created
    expect(fs.mkdir).toHaveBeenCalledWith(expectedPath, { recursive: true });
    expect(fs.mkdir).toHaveBeenCalledWith(join(expectedPath, "src"), {
      recursive: true,
    });

    // Check if package.json was written
    expect(fs.writeFile).toHaveBeenCalledWith(
      join(expectedPath, "package.json"),
      expect.stringContaining('"name": "ocpp-charging-network"'),
    );

    // Check if tsconfig.json was written
    expect(fs.writeFile).toHaveBeenCalledWith(
      join(expectedPath, "tsconfig.json"),
      expect.stringContaining('"target": "ESNext"'),
    );

    // Check if index.ts was written
    expect(fs.writeFile).toHaveBeenCalledWith(
      join(expectedPath, "src/index.ts"),
      expect.stringContaining("new OCPPServer({"),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("created successfully"),
    );
  });
});
