import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractMethods,
  extractSendMethods,
  generateVersionFile,
  type SchemaEntry,
  type VersionConfig,
} from "./generator.js";

/** The protocols the library ships types for. */
export const LIBRARY_VERSIONS: VersionConfig[] = [
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

/** src/generated/index.ts: the protocol maps and the types derived from them. */
export function generateIndex(): string {
  const lines = [
    "// Auto-generated index — DO NOT EDIT",
    "/* eslint-disable */",
    "",
    'import type { OCPP16Methods, OCPP16SendMethods } from "./ocpp16.js";',
    'import type { OCPP201Methods, OCPP201SendMethods } from "./ocpp201.js";',
    'import type { OCPP21Methods, OCPP21SendMethods } from "./ocpp21.js";',
    "",
    "/**",
    " * Maps OCPP protocol strings to their method type maps.",
    " * Used by OCPPClient<P> and OCPPServer to provide auto-typed",
    " * handle(), call(), and event listener signatures.",
    " */",
    "export interface OCPPMethodMap {",
    '  "ocpp1.6": OCPP16Methods;',
    '  "ocpp2.0.1": OCPP201Methods;',
    '  "ocpp2.1": OCPP21Methods;',
    "}",
    "",
    "/** All valid OCPP protocol strings (auto-generated, extensible via module augmentation). */",
    "export type OCPPProtocolKey = keyof OCPPMethodMap;",
    "",
    "/** All valid method names for a given protocol. */",
    "export type OCPPMethodNames<P extends keyof OCPPMethodMap> =",
    "  string & keyof OCPPMethodMap[P];",
    "",
    "/** Distributes over union protocols to get all method names. */",
    "export type AllMethodNames<P extends keyof OCPPMethodMap> =",
    "  P extends keyof OCPPMethodMap ? keyof OCPPMethodMap[P] & string : never;",
    "",
    "/** Request type for a given protocol + method. */",
    "export type OCPPRequestType<",
    "  P extends keyof OCPPMethodMap,",
    "  M extends string,",
    "> = P extends keyof OCPPMethodMap",
    "  ? M extends keyof OCPPMethodMap[P] ? OCPPMethodMap[P][M] extends { request: infer R } ? R : never : never",
    "  : never;",
    "",
    "/** Response type for a given protocol + method. */",
    "export type OCPPResponseType<",
    "  P extends keyof OCPPMethodMap,",
    "  M extends string,",
    "> = P extends keyof OCPPMethodMap",
    "  ? M extends keyof OCPPMethodMap[P] ? OCPPMethodMap[P][M] extends { response: infer R } ? R : never : never",
    "  : never;",
    "",
    "/**",
    " * Maps OCPP protocol strings to their unconfirmed (SEND) messages.",
    " * Only OCPP 2.1 defines any; they are sent with send() and never answered.",
    " */",
    "export interface OCPPSendMethodMap {",
    '  "ocpp1.6": OCPP16SendMethods;',
    '  "ocpp2.0.1": OCPP201SendMethods;',
    '  "ocpp2.1": OCPP21SendMethods;',
    "}",
    "",
    "/**",
    " * SEND message names for a protocol; distributes over union protocols. A",
    " * protocol with no entry in OCPPSendMethodMap has none, so a custom protocol",
    " * declared in OCPPMethodMap alone needs no SEND entry.",
    " */",
    "export type SendMethodNames<P extends string> =",
    "  P extends keyof OCPPSendMethodMap ? keyof OCPPSendMethodMap[P] & string : never;",
    "",
    "/** Payload type of a SEND message for a given protocol + message name. */",
    "export type OCPPSendRequestType<",
    "  P extends string,",
    "  M extends string,",
    "> = P extends keyof OCPPSendMethodMap",
    "  ? M extends keyof OCPPSendMethodMap[P] ? OCPPSendMethodMap[P][M] extends { request: infer R } ? R : never : never",
    "  : never;",
    "",
  ];

  return lines.join("\n");
}

/**
 * Writes the library's types, src/generated/*.ts, from its schemas in
 * src/core/validation/schemas. `npm run generate` runs it.
 *
 * @param packageDir The ocpp-ws-io package folder.
 */
export function generateLibraryTypes(packageDir: string): void {
  const schemaDir = join(packageDir, "src", "core", "validation", "schemas");
  const outDir = join(packageDir, "src", "generated");
  if (!existsSync(schemaDir)) {
    throw new Error(`Schema directory not found: ${schemaDir}`);
  }
  mkdirSync(outDir, { recursive: true });

  for (const version of LIBRARY_VERSIONS) {
    const schema: SchemaEntry[] = JSON.parse(
      readFileSync(join(schemaDir, version.file), "utf8"),
    );
    const methods = extractMethods(schema);
    const sendMethods = extractSendMethods(schema);
    const code = generateVersionFile(version, methods, sendMethods);
    writeFileSync(join(outDir, `${version.key}.ts`), code);
    const sendNote = sendMethods.size
      ? `, ${sendMethods.size} SEND messages`
      : "";
    console.log(`✓ ${version.key}.ts  (${methods.size} methods${sendNote})`);
  }

  writeFileSync(join(outDir, "index.ts"), generateIndex());
  console.log("✓ index.ts");
  console.log("\nDone.");
}
