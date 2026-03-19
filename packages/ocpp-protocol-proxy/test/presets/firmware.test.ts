import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "../../src/core/session.js";
import type { TranslationContext } from "../../src/core/types.js";
import { firmwarePreset } from "../../src/presets/firmware.js";

function makeCtx(): TranslationContext {
  return {
    identity: "test-cp",
    sourceProtocol: "ocpp1.6",
    targetProtocol: "ocpp2.1",
    session: new InMemorySessionStore(),
  };
}

describe("Firmware Preset — Upstream", () => {
  const up = firmwarePreset.upstream!;

  it("FirmwareStatusNotification: passes status", async () => {
    const result = await up["ocpp1.6:FirmwareStatusNotification"](
      { status: "Installed" },
      makeCtx(),
    );
    expect(result.action).toBe("FirmwareStatusNotification");
    expect(result.payload.status).toBe("Installed");
  });

  it("DiagnosticsStatusNotification: maps to LogStatusNotification", async () => {
    const result = await up["ocpp1.6:DiagnosticsStatusNotification"](
      { status: "Uploaded" },
      makeCtx(),
    );
    expect(result.action).toBe("LogStatusNotification");
    expect(result.payload.status).toBe("Uploaded");
  });
});

describe("Firmware Preset — Downstream", () => {
  const down = firmwarePreset.downstream!;

  it("UpdateFirmware: extracts from firmware object", async () => {
    const result = await down["ocpp2.1:UpdateFirmware"](
      {
        firmware: {
          location: "https://fw.example.com/v2.bin",
          retrieveDateTime: "2026-01-01T00:00:00Z",
        },
        retries: 3,
        retryInterval: 60,
      },
      makeCtx(),
    );
    expect(result.payload.location).toBe("https://fw.example.com/v2.bin");
    expect(result.payload.retrieveDate).toBe("2026-01-01T00:00:00Z");
    expect(result.payload.retries).toBe(3);
  });

  it("GetLog: maps to GetDiagnostics", async () => {
    const result = await down["ocpp2.1:GetLog"](
      {
        log: {
          remoteLocation: "ftp://logs.example.com/upload",
          oldestTimestamp: "2026-01-01T00:00:00Z",
          latestTimestamp: "2026-01-02T00:00:00Z",
        },
        retries: 1,
      },
      makeCtx(),
    );
    expect(result.action).toBe("GetDiagnostics");
    expect(result.payload.location).toBe("ftp://logs.example.com/upload");
    expect(result.payload.startTime).toBe("2026-01-01T00:00:00Z");
    expect(result.payload.stopTime).toBe("2026-01-02T00:00:00Z");
  });
});
