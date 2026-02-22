import * as child_process from "child_process";
import { promises as fs } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { certsCommand } from "../src/commands/certs.js";

vi.mock("fs", () => ({
  promises: {
    mkdir: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  exec: vi.fn((cmd, cb) => cb(null, "stdout mock", "stderr mock")),
}));

describe("certsCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should successfully generate CA certificates via openssl", async () => {
    await certsCommand({ type: "ca", out: "./certs" });

    // Should create directory
    expect(fs.mkdir).toHaveBeenCalledWith("./certs", { recursive: true });

    // Should execute at least the private key generation
    expect(child_process.exec).toHaveBeenCalledWith(
      expect.stringContaining("openssl req -x509"),
      expect.any(Function),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Success: CA Key and Cert generated"),
    );
  });

  it("should fail gracefully if openssl throws an error", async () => {
    (child_process.exec as any).mockImplementationOnce(
      (cmd: string, cb: any) => {
        cb(new Error("Command not found: openssl"), "", "");
      },
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await certsCommand({ type: "ca", out: "./certs" });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Command not found"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ensure OpenSSL is installed"),
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
