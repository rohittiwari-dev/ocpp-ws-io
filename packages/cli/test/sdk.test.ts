import { promises as fs } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdkCommand } from "../src/commands/sdk.js";

vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe("sdkCommand", () => {
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

  it("should successfully generate a TypeScript SDK if valid schemas are present", async () => {
    // Mock readdir to return some fake Request.json schemas
    (fs.readdir as any).mockResolvedValue([
      { isFile: () => true, name: "BootNotificationRequest.json" },
      { isFile: () => true, name: "AuthorizeRequest.json" },
      { isFile: () => false, name: "some-folder" },
      { isFile: () => true, name: "BootNotificationResponse.json" }, // Should be ignored
    ]);

    await sdkCommand({ schemas: "./schemas", out: "./sdk/api.ts" });

    // Ensure directory creation was attempted
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("sdk"), {
      recursive: true,
    });

    // Validate the generated TypeScript code string
    const generatedCode = (fs.writeFile as any).mock.calls[0][1];
    expect(fs.writeFile).toHaveBeenCalled();
    expect(generatedCode).toContain("export class OCPPApiClient");
    expect(generatedCode).toContain(
      "bootNotification(payload: BootNotificationRequest): Promise<BootNotificationResponse>",
    );
    expect(generatedCode).toContain(
      "authorize(payload: AuthorizeRequest): Promise<AuthorizeResponse>",
    );

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Success!"));
  });

  it("should exit with code 1 if no request schemas are found", async () => {
    (fs.readdir as any).mockResolvedValue([
      { isFile: () => true, name: "just-a-file.json" },
    ]);

    await sdkCommand({});

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("No *Request.json schemas found"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("should gracefully handle non-existent schema directories", async () => {
    const enoentError = new Error("Not found") as any;
    enoentError.code = "ENOENT";
    (fs.readdir as any).mockRejectedValue(enoentError);

    await sdkCommand({});

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("does not exist"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
