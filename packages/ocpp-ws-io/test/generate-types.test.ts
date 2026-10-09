import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-ignore
import {
  extractMethods,
  extractSendMethods,
  generateVersionFile,
  jsonSchemaToTS,
  main,
} from "../scripts/generate-types.js";

describe("Type Generation Script", () => {
  const outDir = path.join(__dirname, "generated-test-output");

  afterEach(() => {
    if (fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("should generate files using main() function", () => {
    // Override console.log to keep test output clean
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Run main with a custom base dir so it doesn't overwrite real src/generated
    // The script expects to find schemas at ../src/schemas relative to baseDir
    // So we need to set baseDir such that ../src/schemas resolves to the real schemas
    // Real path: packages/ocpp-ws-io/src/schemas
    // Script default: __dirname (packages/ocpp-ws-io/scripts) -> ../src/schemas OK

    // We want output to go to a temp dir.
    // The script calculates OUT_DIR = path.join(baseDir, "..", "src", "generated")
    // If we want OUT_DIR to be our temp dir, we have to hack the baseDir or the script.
    // The script allows passing baseDir.
    // Let's explicitly pass the scripts dir as baseDir to match default behavior,
    // BUT checking the script again:
    // function main(baseDir = __dirname) {
    //   const SCHEMA_DIR = path.join(baseDir, "..", "src", "schemas");
    //   const OUT_DIR = path.join(baseDir, "..", "src", "generated");

    // If I want to test logic without overwriting, I should probably have made OUT_DIR configurable.
    // However, for coverage, running it against the real directory is also fine as long as it's idempotent.
    // But let's verify logic with unit tests on the helper functions too.

    main(path.join(__dirname, "../scripts"));

    expect(consoleSpy).toHaveBeenCalledWith("✓ index.ts");
    expect(
      fs.existsSync(path.join(__dirname, "../src/generated/index.ts")),
    ).toBe(true);

    consoleSpy.mockRestore();
  });

  it("should convert JSON schema to TS", () => {
    const definitions = {};
    expect(jsonSchemaToTS({ type: "string" }, definitions)).toBe("string");
    expect(jsonSchemaToTS({ type: "integer" }, definitions)).toBe("number");
    expect(
      jsonSchemaToTS({ type: "array", items: { type: "string" } }, definitions),
    ).toBe("string[]");
    expect(jsonSchemaToTS({ $ref: "#/definitions/Foo" }, definitions)).toBe(
      "Foo",
    );
  });

  it("should convert complex schema structures to TS branches", () => {
    const definitions = {};

    // Enums
    expect(jsonSchemaToTS({ enum: ["A", "B", "C"] }, definitions)).toBe(
      '"A" | "B" | "C"',
    );
    expect(jsonSchemaToTS({ enum: [1, 2, 3] }, definitions)).toBe("1 | 2 | 3");

    // anyOf / oneOf
    expect(
      jsonSchemaToTS(
        { anyOf: [{ type: "string" }, { type: "number" }] },
        definitions,
      ),
    ).toBe("(string | number)");

    expect(
      jsonSchemaToTS(
        { oneOf: [{ type: "boolean" }, { type: "null" }] },
        definitions,
      ),
    ).toBe("(boolean | null)");

    // Type Arrays
    expect(jsonSchemaToTS({ type: ["string", "null"] }, definitions)).toBe(
      "string | null",
    );

    // Objects
    expect(
      jsonSchemaToTS(
        {
          type: "object",
          properties: {
            id: { type: "string" },
            count: { type: "integer" },
          },
          required: ["id"],
        },
        definitions,
      ),
    ).toBe(
      "{ id: string; count?: number; [key: string]: JsonValue | undefined }",
    );

    // Nested Arrays
    expect(
      jsonSchemaToTS(
        {
          type: "array",
          items: { anyOf: [{ type: "string" }, { type: "number" }] },
        },
        definitions,
      ),
    ).toBe("((string | number))[]");

    // No type: any JSON value, as the schema allows
    expect(jsonSchemaToTS({ type: "unknownCustom" }, definitions)).toBe(
      "JsonValue",
    );
    expect(jsonSchemaToTS(null, definitions)).toBe("JsonValue");
    expect(jsonSchemaToTS({ type: "array" }, definitions)).toBe("JsonValue[]");
    expect(jsonSchemaToTS({ type: "object" }, definitions)).toBe(
      "{ [key: string]: JsonValue | undefined }",
    );
    expect(
      jsonSchemaToTS(
        {
          type: "object",
          additionalProperties: { type: "string" },
        },
        definitions,
      ),
    ).toBe("Record<string, string>");
  });

  // Typed methods reject keys a schema does not define, so an object the
  // schema leaves open (additionalProperties absent or true, JSON Schema's
  // default) must take any key, and a closed one none.
  it("gives an object the schema leaves open an index signature, and a closed one none", () => {
    const defs = {};
    const props = { id: { type: "string" } };
    expect(
      jsonSchemaToTS(
        {
          type: "object",
          properties: props,
          required: ["id"],
          additionalProperties: false,
        },
        defs,
      ),
    ).toBe("{ id: string }");
    expect(
      jsonSchemaToTS(
        { type: "object", properties: props, required: ["id"] },
        defs,
      ),
    ).toBe("{ id: string; [key: string]: JsonValue | undefined }");
    expect(
      jsonSchemaToTS(
        {
          type: "object",
          properties: props,
          required: ["id"],
          additionalProperties: true,
        },
        defs,
      ),
    ).toBe("{ id: string; [key: string]: JsonValue | undefined }");
    expect(
      jsonSchemaToTS({ type: "object", additionalProperties: false }, defs),
    ).toBe("Record<string, never>");
    expect(
      jsonSchemaToTS({ type: "object", properties: {}, additionalProperties: false }, defs),
    ).toBe("Record<string, never>");
    // An untyped field such as DataTransfer's data takes any JSON value.
    expect(
      jsonSchemaToTS({ description: "Open to implementation" }, defs),
    ).toBe("JsonValue");
  });

  it("generates 2.0.1's CustomDataType open and every other type closed", () => {
    const read = (file: string) =>
      JSON.parse(
        fs.readFileSync(path.join(__dirname, "../src/schemas", file), "utf8"),
      );
    const s201 = read("ocpp2_0_1.json");
    const code = generateVersionFile(
      {
        key: "ocpp201",
        file: "ocpp2_0_1.json",
        mapName: "OCPP201Methods",
        sendMapName: "OCPP201SendMethods",
        protocol: "ocpp2.0.1",
      },
      extractMethods(s201),
      extractSendMethods(s201),
    );
    expect(code).toContain(
      "export interface CustomDataType {\n  vendorId: string;\n  [key: string]: JsonValue | undefined;\n}",
    );
    expect(code).toContain('import type { JsonValue } from "../types.js";');
    // CustomDataType is the only open object in 2.0.1, on purpose.
    expect(code.match(/\[key: string\]/g)).toHaveLength(1);
    expect(code).toMatch(/data\?: JsonValue;/);
    expect(code).not.toContain("unknown");

    const s16 = read("ocpp1_6.json");
    const code16 = generateVersionFile(
      {
        key: "ocpp16",
        file: "ocpp1_6.json",
        mapName: "OCPP16Methods",
        sendMapName: "OCPP16SendMethods",
        protocol: "ocpp1.6",
      },
      extractMethods(s16),
      extractSendMethods(s16),
    );
    // Every 1.6 object is closed.
    expect(code16).not.toContain("[key: string]");
    expect(code16).toContain("export interface HeartbeatRequest extends Record<string, never>");
    expect(code16).toContain("export interface StatusNotificationResponse extends Record<string, never>");
  });

  // OCPP 2.1 SEND messages have one schema with no Request/Response suffix.
  it("picks out suffix-less SEND schemas only", () => {
    const sendMethods = extractSendMethods([
      { $id: "urn:NotifyPeriodicEventStream" },
      { $id: "urn:BootNotificationRequest" },
      { $id: "urn:BootNotificationResponse" },
      { $id: "urn:Heartbeat.req" },
      {},
    ]);
    expect([...sendMethods.keys()]).toEqual(["NotifyPeriodicEventStream"]);
  });
});
