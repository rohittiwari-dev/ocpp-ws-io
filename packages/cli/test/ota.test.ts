import { promises as fs } from "fs";
import * as fsPromises from "fs/promises";
import http from "http";
import { Readable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otaCommand } from "../src/commands/ota.js";

vi.mock("http");
vi.mock("fs/promises");
vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn(),
    open: vi.fn(),
  },
}));

describe("otaCommand", () => {
  let logSpy: any;
  let errorSpy: any;
  let exitSpy: any;
  let serverMock: any;
  let requestHandler: (req: any, res: any) => Promise<void>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    serverMock = {
      listen: vi.fn((port, cb) => cb && cb()),
      close: vi.fn(),
    };

    (http.createServer as any).mockImplementation((handler: any) => {
      requestHandler = handler;
      return serverMock;
    });

    // Mock fs/promises stat
    (fsPromises.stat as any).mockResolvedValue({
      isDirectory: () => true,
      size: 1024,
    });

    // Mock fs readdir
    (fs.readdir as any).mockResolvedValue(["firmware.bin"]);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should start server if directory exists", async () => {
    await otaCommand("./firmware", { port: 4000 });

    expect(fsPromises.stat).toHaveBeenCalled();
    expect(http.createServer).toHaveBeenCalled();
    expect(serverMock.listen).toHaveBeenCalledWith(4000, expect.any(Function));
  });

  it("should exit if directory does not exist", async () => {
    (fsPromises.stat as any).mockRejectedValue(new Error("ENOENT"));

    await otaCommand("./invalid", {});

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("does not exist"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should serve directory listing", async () => {
    await otaCommand(".", {});

    const req = { url: "/", method: "GET", headers: {} };
    const res = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    await requestHandler(req, res);

    expect(fs.readdir).toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/html" }),
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("firmware.bin"),
    );
  });

  it("should serve file download", async () => {
    await otaCommand(".", {});

    // Mock stat for file
    (fsPromises.stat as any).mockResolvedValue({
      isDirectory: () => false,
      size: 100,
    });

    // Mock fs.open
    const streamMock = new Readable();
    streamMock.push("content");
    streamMock.push(null);

    const fileHandleMock = {
      createReadStream: vi.fn().mockReturnValue(streamMock),
      close: vi.fn(),
    };
    (fs.open as any).mockResolvedValue(fileHandleMock);

    const req = { url: "/firmware.bin", method: "GET", headers: {} };
    const res = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
    };
    // stream.pipe calls stream.on('data') and dest.write()
    // It also checks dest type. Simple mock might not be enough for pipe.
    // But we mock pipe on streamMock? No, Readable has pipe.

    // Actually, the code calls `stream.pipe(res)`.
    // I need to ensure res is writable.
    // Or I can mock `pipe` on the stream returned by createReadStream.
    streamMock.pipe = vi.fn();

    await requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Content-Length": 100,
        "Accept-Ranges": "bytes",
      }),
    );
    expect(fileHandleMock.createReadStream).toHaveBeenCalled();
    expect(streamMock.pipe).toHaveBeenCalledWith(res);
  });

  it("should handle range request", async () => {
    await otaCommand(".", {});

    (fsPromises.stat as any).mockResolvedValue({
      isDirectory: () => false,
      size: 100,
    });

    const streamMock = {
      pipe: vi.fn(),
      on: vi.fn(),
    };
    const fileHandleMock = {
      createReadStream: vi.fn().mockReturnValue(streamMock),
      close: vi.fn(),
    };
    (fs.open as any).mockResolvedValue(fileHandleMock);

    const req = {
      url: "/firmware.bin",
      method: "GET",
      headers: { range: "bytes=0-49" },
    };
    const res = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    await requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      206,
      expect.objectContaining({
        "Content-Range": "bytes 0-49/100",
        "Content-Length": 50,
      }),
    );
    expect(fileHandleMock.createReadStream).toHaveBeenCalledWith({
      start: 0,
      end: 49,
    });
  });

  it("should handle 405 Method Not Allowed", async () => {
    await otaCommand(".", {});
    const req = { method: "POST" };
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await requestHandler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(405);
  });
});
