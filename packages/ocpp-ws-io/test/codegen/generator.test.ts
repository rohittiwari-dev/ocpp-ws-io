import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractMethods,
  extractSendMethods,
  generateVersionFile,
  type SchemaEntry,
  type VersionConfig,
} from "../../src/codegen/generator.js";
import { generateIndex, LIBRARY_VERSIONS } from "../../src/codegen/library.js";

const libraryDir = fileURLToPath(new URL("../../", import.meta.url));

function readSchema(file: string): SchemaEntry[] {
  return JSON.parse(
    readFileSync(
      join(libraryDir, "src", "core", "validation", "schemas", file),
      "utf8",
    ),
  ) as SchemaEntry[];
}

const vendor: VersionConfig = {
  key: "vendor",
  file: "vendor.json",
  mapName: "VendorMethods",
  sendMapName: "VendorSendMethods",
  protocol: "vendor-proto",
};

describe("type generator", () => {
  it("keeps each action's request and response schemas", () => {
    const v16 = extractMethods(readSchema("ocpp1_6.json")).get(
      "BootNotification",
    );
    expect(v16?.request?.$id).toBe("urn:BootNotification.req");
    expect(v16?.response?.$id).toBe("urn:BootNotification.conf");

    const v21 = extractMethods(readSchema("ocpp2_1.json")).get(
      "BootNotification",
    );
    expect(v21?.request?.$id).toBe("urn:BootNotificationRequest");
    expect(v21?.response?.$id).toBe("urn:BootNotificationResponse");
  });

  it("finds SEND messages: a schema whose id has no request or response suffix", () => {
    const send21 = extractSendMethods(readSchema("ocpp2_1.json"));
    expect(send21.get("NotifyPeriodicEventStream")?.$id).toBe(
      "urn:NotifyPeriodicEventStream",
    );
    expect(extractMethods(readSchema("ocpp2_1.json")).has("NotifyPeriodicEventStream")).toBe(false);
    expect(extractSendMethods(readSchema("ocpp1_6.json")).size).toBe(0);
  });

  // src/generated is what the generator writes from the schemas: a rule
  // changed without `npm run generate` fails here.
  it.each(LIBRARY_VERSIONS)("src/generated holds what it writes for $key", (version) => {
    const schema = readSchema(version.file);
    const code = generateVersionFile(
      version,
      extractMethods(schema),
      extractSendMethods(schema),
    );
    const committed = readFileSync(
      join(libraryDir, "src", "generated", `${version.key}.ts`),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(code).toBe(committed);
  });

  it("src/generated holds the index it writes", () => {
    const committed = readFileSync(
      join(libraryDir, "src", "generated", "index.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(generateIndex()).toBe(committed);
  });

  it("gives an open object an index signature and an untyped field JsonValue", () => {
    const schema: SchemaEntry[] = [
      {
        $id: "urn:VendorConfig.req",
        type: "object",
        additionalProperties: false,
        properties: {
          settings: { type: "object", properties: { mode: { type: "string" } } },
          extra: {},
        },
        required: ["settings"],
      },
      { $id: "urn:VendorConfig.conf", type: "object", properties: {} },
    ];
    // As `ocpp generate` writes it, for a project outside the library.
    const code = generateVersionFile(
      vendor,
      extractMethods(schema),
      extractSendMethods(schema),
      { typesModule: "ocpp-ws-io" },
    );
    expect(code).toContain('import type { JsonValue } from "ocpp-ws-io";');
    expect(code).toContain(
      "  settings: { mode?: string; [key: string]: JsonValue | undefined };",
    );
    expect(code).toContain("  extra?: JsonValue;");
    // The response leaves additionalProperties unset: open.
    expect(code).toContain(
      "export interface VendorConfigResponse {\n  [key: string]: JsonValue | undefined;\n}",
    );
  });
});
