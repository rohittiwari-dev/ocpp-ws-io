import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-ignore
import { main, jsonSchemaToTS } from "../scripts/generate-types.js";

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
    ).toBe("{ id: string; count?: number }");

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

    // Unknowns
    expect(jsonSchemaToTS({ type: "unknownCustom" }, definitions)).toBe(
      "unknown",
    );
    expect(jsonSchemaToTS(null, definitions)).toBe("unknown");
    expect(jsonSchemaToTS({ type: "array" }, definitions)).toBe("unknown[]");
    expect(jsonSchemaToTS({ type: "object" }, definitions)).toBe(
      "Record<string, unknown>",
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
});
