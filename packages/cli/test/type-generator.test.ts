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
} from "../src/lib/type-generator.js";

const libraryDir = fileURLToPath(new URL("../../ocpp-ws-io/", import.meta.url));

function readSchema(file: string): SchemaEntry[] {
  return JSON.parse(
    readFileSync(
      join(libraryDir, "src", "core", "validation", "schemas", file),
      "utf8",
    ),
  ) as SchemaEntry[];
}

/** The OCPP versions, named as the library's own generator names them. */
const VERSIONS: VersionConfig[] = [
  {
    key: "ocpp16",
    file: "ocpp1_6.json",
    mapName: "OCPP16Methods",
    sendMapName: "OCPP16SendMethods",
    protocol: "ocpp1.6",
  },
  {
    key: "ocpp201",
    file: "ocpp2_0_1.json",
    mapName: "OCPP201Methods",
    sendMapName: "OCPP201SendMethods",
    protocol: "ocpp2.0.1",
  },
  {
    key: "ocpp21",
    file: "ocpp2_1.json",
    mapName: "OCPP21Methods",
    sendMapName: "OCPP21SendMethods",
    protocol: "ocpp2.1",
  },
];

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

  // The CLI follows the library's rules: on the OCPP schemas both write the
  // same types, so a rule changed in one and not the other fails here.
  it.each(VERSIONS)("writes $key as the library's generator does", (version) => {
    const schema = readSchema(version.file);
    const code = generateVersionFile(
      version,
      extractMethods(schema),
      extractSendMethods(schema),
      { typesModule: "../types.js" },
    );
    const library = readFileSync(
      join(libraryDir, "src", "generated", `${version.key}.ts`),
      "utf8",
    ).replace(/\r\n/g, "\n");
    // Only the first line, naming the generator, differs.
    expect(code.split("\n").slice(1)).toEqual(library.split("\n").slice(1));
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
    const code = generateVersionFile(
      vendor,
      extractMethods(schema),
      extractSendMethods(schema),
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
