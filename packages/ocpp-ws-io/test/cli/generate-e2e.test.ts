import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateProtocolFiles } from "../../src/cli/lib/protocol-files.js";
import type { SchemaEntry } from "../../src/cli/lib/type-generator.js";

/**
 * `ocpp generate` end to end: the files it writes for a vendor protocol must
 * compile against the library and type a server and a client using it, and
 * its validator must validate what the types describe.
 */
const libraryDir = fileURLToPath(new URL("../../", import.meta.url));

const schema: SchemaEntry[] = [
  {
    $id: "urn:VendorPing.req",
    type: "object",
    additionalProperties: false,
    properties: { n: { type: "integer" } },
    required: ["n"],
  },
  {
    $id: "urn:VendorPing.conf",
    type: "object",
    additionalProperties: false,
    properties: { status: { type: "string", enum: ["Accepted", "Rejected"] } },
    required: ["status"],
  },
  // OCPP 2.1 style ids, a shared definition the schema leaves open.
  {
    $id: "urn:VendorConfigRequest",
    type: "object",
    additionalProperties: false,
    definitions: {
      SettingsType: { type: "object", properties: { mode: { type: "string" } } },
    },
    properties: { settings: { $ref: "#/definitions/SettingsType" } },
    required: ["settings"],
  },
  {
    $id: "urn:VendorConfigResponse",
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  // An unconfirmed (SEND) message.
  {
    $id: "urn:VendorNotify",
    type: "object",
    additionalProperties: false,
    properties: { at: { type: "string" } },
    required: ["at"],
  },
];

const usage = `
import { OCPPClient, OCPPServer } from "ocpp-ws-io";
import { vendorProtoValidator } from "./vendorproto.validator.js";

const server = new OCPPServer({
  protocols: ["ocpp2.0.1", "vendor-proto"],
  strictMode: ["vendor-proto"],
  strictModeValidators: [vendorProtoValidator],
  strictModeMethods: ["VendorPing", "VendorNotify", "BootNotification"],
});
server.on("client", (client) => {
  client.handle("vendor-proto", "VendorPing", ({ params }) => ({
    status: params.n > 0 ? "Accepted" : "Rejected",
  }));
  // @ts-expect-error a key the schema does not define
  client.handle("vendor-proto", "VendorPing", () => ({ status: "Accepted", bogus: 1 }));
});

const client = new OCPPClient({
  identity: "CP1",
  endpoint: "ws://localhost:9000",
  protocols: ["vendor-proto"],
  strictMode: true,
  strictModeValidators: [vendorProtoValidator],
});

export async function use(): Promise<void> {
  const res = await client.call("VendorPing", { n: 1 });
  const status: "Accepted" | "Rejected" = res.status;
  void status;
  // @ts-expect-error n is a number
  await client.call("VendorPing", { n: "1" });
  // @ts-expect-error a key the schema does not define
  await client.call("VendorPing", { n: 1, bogus: 1 });
  // The schema leaves SettingsType open: it takes any JSON keys.
  await client.call("VendorConfig", { settings: { mode: "eco", vendorKey: 1 } });
  // A SEND message is sent, never called.
  await client.send("VendorNotify", { at: "2026-10-03T00:00:00Z" });
  // @ts-expect-error a SEND message is not a CALL action
  await client.call("VendorNotify", { at: "" });
}

// @ts-expect-error a validator for a protocol the client does not use
new OCPPClient({ identity: "CP2", endpoint: "ws://localhost:9000", protocols: ["ocpp1.6"], strictMode: true, strictModeValidators: [vendorProtoValidator] });
`;

/** The part of the generated validator this test uses. */
interface GeneratedValidator {
  subprotocol: string;
  validate(schemaId: string, params: object): void;
}

describe("ocpp generate, end to end", () => {
  let dir: string;
  const generated = generateProtocolFiles(schema, "vendor-proto", "vendor.json");

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ocpp-generate-"));
    for (const [name, content] of generated.files) {
      writeFileSync(join(dir, name), content);
    }
    writeFileSync(join(dir, "usage.ts"), usage);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the types, the augmentation and the validator", () => {
    expect([...generated.files.keys()]).toEqual([
      "vendorproto.ts",
      "augment.d.ts",
      "vendorproto.validator.ts",
    ]);
    expect(generated.files.get("augment.d.ts")).toContain(
      '    "vendor-proto": VendorProtoSendMethods;',
    );
  });

  it("types a server and a client against the library", () => {
    const config = ts.getParsedCommandLineOfConfigFile(
      join(libraryDir, "tsconfig.json"),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
        },
      },
    );
    if (!config) throw new Error("the library's tsconfig.json did not parse");
    const program = ts.createProgram(
      [join(dir, "usage.ts"), join(dir, "augment.d.ts")],
      {
        ...config.options,
        noEmit: true,
        rootDir: undefined,
        outDir: undefined,
        paths: { "ocpp-ws-io": [join(libraryDir, "src", "index.ts")] },
      },
    );
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map(
        (d) =>
          `${d.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
      );
    expect(errors).toEqual([]);
  }, 120_000);

  it("validates what the types describe", async () => {
    const mod: { vendorProtoValidator: GeneratedValidator } = await import(
      pathToFileURL(join(dir, "vendorproto.validator.ts")).href
    );
    const validator = mod.vendorProtoValidator;
    expect(validator.subprotocol).toBe("vendor-proto");
    validator.validate("urn:VendorPing.req", { n: 1 });
    expect(() => validator.validate("urn:VendorPing.req", { n: "1" })).toThrow();
    expect(() =>
      validator.validate("urn:VendorPing.conf", { status: "Accepted", bogus: 1 }),
    ).toThrow();
    // 2.1 style ids are looked up as .req / .conf; the open object takes any key.
    validator.validate("urn:VendorConfig.req", {
      settings: { mode: "eco", vendorKey: 1 },
    });
  });
});
