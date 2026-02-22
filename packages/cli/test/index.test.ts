import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock all command modules
vi.mock("../src/commands/audit.js", () => ({ auditCommand: vi.fn() }));
vi.mock("../src/commands/call.js", () => ({ callCommand: vi.fn() }));
vi.mock("../src/commands/certs.js", () => ({ certsCommand: vi.fn() }));
vi.mock("../src/commands/fuzz.js", () => ({ fuzzCommand: vi.fn() }));
vi.mock("../src/commands/generate.js", () => ({ generateCommand: vi.fn() }));
vi.mock("../src/commands/init.js", () => ({ initCommand: vi.fn() }));
vi.mock("../src/commands/load-test.js", () => ({ loadTestCommand: vi.fn() }));
vi.mock("../src/commands/mock.js", () => ({ mockCommand: vi.fn() }));
vi.mock("../src/commands/ota.js", () => ({ otaCommand: vi.fn() }));
vi.mock("../src/commands/parse.js", () => ({ parseCommand: vi.fn() }));
vi.mock("../src/commands/proxy.js", () => ({ proxyCommand: vi.fn() }));
vi.mock("../src/commands/replay.js", () => ({ replayCommand: vi.fn() }));
vi.mock("../src/commands/sdk.js", () => ({ sdkCommand: vi.fn() }));
vi.mock("../src/commands/simulate.js", () => ({ simulateCommand: vi.fn() }));
vi.mock("../src/commands/tail.js", () => ({ tailCommand: vi.fn() }));
vi.mock("../src/commands/top.js", () => ({ topCommand: vi.fn() }));
vi.mock("../src/commands/virtual-station.js", () => ({
  virtualStationCommand: vi.fn(),
}));

// Mock fs to avoid reading package.json
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue('{"version": "1.0.0"}'),
}));

// Mock cac
vi.mock("cac", () => {
  const cacMock = {
    command: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
    parse: vi.fn(),
    help: vi.fn().mockReturnThis(),
    version: vi.fn().mockReturnThis(),
    runMatchedCommand: vi.fn(),
  };
  return { cac: vi.fn(() => cacMock) };
});

describe("CLI Entry Point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should register all commands", async () => {
    // We need to re-import index.ts to trigger execution
    await import("../src/index.js");

    const { cac } = await import("cac");
    expect(cac).toHaveBeenCalledWith("ocpp");

    const cli = cac("ocpp");

    expect(cli.command).toHaveBeenCalledWith("generate", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("init [dir]", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("simulate", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith(
      "virtual-station",
      expect.any(String),
    );
    expect(cli.command).toHaveBeenCalledWith(
      "call <method> [payload]",
      expect.any(String),
    );
    expect(cli.command).toHaveBeenCalledWith("load-test", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("audit", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("fuzz", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith(
      "replay <file>",
      expect.any(String),
    );
    expect(cli.command).toHaveBeenCalledWith("top", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("tail", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("proxy", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("mock", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("ota [dir]", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith("certs", expect.any(String));
    expect(cli.command).toHaveBeenCalledWith(
      "parse <payload>",
      expect.any(String),
    );
    expect(cli.command).toHaveBeenCalledWith("sdk", expect.any(String));

    expect(cli.parse).toHaveBeenCalled();
    expect(cli.runMatchedCommand).toHaveBeenCalled();
  });
});
