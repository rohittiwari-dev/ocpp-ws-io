#!/usr/bin/env node
/**
 * generate-types.js
 *
 * Reads OCPP JSON Schemas (1.6, 2.0.1, 2.1) and generates TypeScript
 * type definitions with full method maps for compile-time type safety.
 *
 * Usage:  node scripts/generate-types.js
 * Output: src/generated/ocpp16.ts, ocpp201.ts, ocpp21.ts, index.ts
 */

const fs = require("fs");
const path = require("path");

// ── Configuration ────────────────────────────────────────────────

const VERSIONS = [
  {
    key: "ocpp16",
    file: "ocpp1_6.json",
    mapName: "OCPP16Methods",
    protocol: "ocpp1.6",
  },
  {
    key: "ocpp201",
    file: "ocpp2_0_1.json",
    mapName: "OCPP201Methods",
    protocol: "ocpp2.0.1",
  },
  {
    key: "ocpp21",
    file: "ocpp2_1.json",
    mapName: "OCPP21Methods",
    protocol: "ocpp2.1",
  },
];

// Allow overriding base dir for testing
function main(baseDir = __dirname) {
  const SCHEMA_DIR = path.join(baseDir, "..", "src", "schemas");
  const OUT_DIR = path.join(baseDir, "..", "src", "generated");

  if (!fs.existsSync(SCHEMA_DIR)) {
    throw new Error(`Schema directory not found: ${SCHEMA_DIR}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const version of VERSIONS) {
    const schemaPath = path.join(SCHEMA_DIR, version.file);
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const methods = extractMethods(schema);
    const code = generateVersionFile(version, methods);
    fs.writeFileSync(path.join(OUT_DIR, `${version.key}.ts`), code);
    console.log(`✓ ${version.key}.ts  (${methods.size} methods)`);
  }

  generateIndex(OUT_DIR);
  console.log("✓ index.ts");
  console.log("\nDone.");
}

// ── Extract Methods ──────────────────────────────────────────────

function extractMethods(schema) {
  const methods = new Map();
  for (const entry of schema) {
    const id = entry["$id"];
    if (!id) continue;

    // Try OCPP 1.6 / 2.0.1 format: urn:MethodName.req / urn:MethodName.conf
    let match = id.match(/^urn:(.+)\.(req|conf)$/);
    if (match) {
      const [, name, suffix] = match;
      if (!methods.has(name)) methods.set(name, {});
      methods.get(name)[suffix === "req" ? "request" : "response"] = entry;
      continue;
    }

    // Try OCPP 2.1 format: urn:MethodNameRequest / urn:MethodNameResponse
    match = id.match(/^urn:(.+)(Request|Response)$/);
    if (match) {
      const [, name, suffix] = match;
      if (!methods.has(name)) methods.set(name, {});
      methods.get(name)[suffix === "Request" ? "request" : "response"] = entry;
      continue;
    }
  }
  return methods;
}

// ── Generate Version File ────────────────────────────────────────

function generateVersionFile(version, methods) {
  const lines = [];
  lines.push(
    `// Auto-generated from ${version.file} — DO NOT EDIT`,
    "/* eslint-disable */",
    "",
  );

  // Collect all definitions across all schema entries
  const allDefinitions = new Map();
  for (const [, schemas] of methods) {
    for (const entry of [schemas.request, schemas.response]) {
      if (!entry?.definitions) continue;
      for (const [defName, defSchema] of Object.entries(entry.definitions)) {
        // Use first occurrence (schemas often duplicate definitions)
        if (!allDefinitions.has(defName)) {
          allDefinitions.set(defName, defSchema);
        }
      }
    }
  }

  // Generate shared definition types
  if (allDefinitions.size > 0) {
    lines.push("// ═══ Shared Types ═══", "");
    for (const [defName, defSchema] of allDefinitions) {
      lines.push(...generateNamedType(defName, defSchema, allDefinitions), "");
    }
  }

  // Generate method request/response interfaces
  lines.push("// ═══ Method Types ═══", "");
  for (const [methodName, schemas] of methods) {
    if (schemas.request) {
      lines.push(
        ...generateInterface(
          `${methodName}Request`,
          schemas.request,
          allDefinitions,
        ),
        "",
      );
    }
    if (schemas.response) {
      lines.push(
        ...generateInterface(
          `${methodName}Response`,
          schemas.response,
          allDefinitions,
        ),
        "",
      );
    }
  }

  // Generate method map
  lines.push("// ═══ Method Map ═══", "");
  lines.push(`export interface ${version.mapName} {`);
  for (const [methodName, schemas] of methods) {
    const req = schemas.request
      ? `${methodName}Request`
      : "Record<string, never>";
    const res = schemas.response
      ? `${methodName}Response`
      : "Record<string, never>";
    lines.push(`  ${methodName}: { request: ${req}; response: ${res} };`);
  }
  lines.push("}", "");

  return lines.join("\n");
}

// ── Generate a Named Type (type alias or interface) ──────────────

function generateNamedType(name, schema, definitions) {
  if (schema.type === "string" && schema.enum) {
    return [
      `export type ${name} = ${schema.enum.map((v) => `"${v}"`).join(" | ")};`,
    ];
  }
  if (schema.type === "object") {
    return generateInterface(name, schema, definitions);
  }
  // Fallback for simple types
  return [`export type ${name} = ${jsonSchemaToTS(schema, definitions)};`];
}

// ── Generate Interface ───────────────────────────────────────────

function generateInterface(name, schema, definitions) {
  const lines = [];
  lines.push(`export interface ${name} {`);

  if (schema.properties) {
    const required = new Set(schema.required || []);
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const opt = required.has(propName) ? "" : "?";
      const tsType = jsonSchemaToTS(propSchema, definitions);
      // Escape reserved words or special chars in property names
      const safeName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propName)
        ? propName
        : `"${propName}"`;
      lines.push(`  ${safeName}${opt}: ${tsType};`);
    }
  }

  lines.push("}");
  return lines;
}

// ── JSON Schema → TypeScript Type ────────────────────────────────

function jsonSchemaToTS(schema, definitions) {
  if (!schema) return "unknown";

  // $ref
  if (schema["$ref"]) {
    const refName = schema["$ref"].replace("#/definitions/", "");
    return refName;
  }

  // anyOf / oneOf
  if (schema.anyOf) {
    const types = schema.anyOf.map((s) => jsonSchemaToTS(s, definitions));
    return types.length > 1 ? `(${types.join(" | ")})` : types[0];
  }
  if (schema.oneOf) {
    const types = schema.oneOf.map((s) => jsonSchemaToTS(s, definitions));
    return types.length > 1 ? `(${types.join(" | ")})` : types[0];
  }

  // enum
  if (schema.enum) {
    return schema.enum
      .map((v) => (typeof v === "string" ? `"${v}"` : String(v)))
      .join(" | ");
  }

  const type = schema.type;

  // Array of types (e.g., ["string", "null"])
  if (Array.isArray(type)) {
    return type
      .map((t) => {
        if (t === "null") return "null";
        // Recurse with a simplified schema
        return jsonSchemaToTS({ ...schema, type: t }, definitions);
      })
      .join(" | ");
  }

  if (type === "string") return "string";
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";

  if (type === "array") {
    if (schema.items) {
      const itemType = jsonSchemaToTS(schema.items, definitions);
      // Wrap complex types in parens for readability
      const needsParens = itemType.includes("|") || itemType.includes("{");
      return needsParens ? `(${itemType})[]` : `${itemType}[]`;
    }
    return "unknown[]";
  }

  if (type === "object") {
    if (schema.properties) {
      const required = new Set(schema.required || []);
      const props = Object.entries(schema.properties).map(([name, ps]) => {
        const opt = required.has(name) ? "" : "?";
        return `${name}${opt}: ${jsonSchemaToTS(ps, definitions)}`;
      });
      return `{ ${props.join("; ")} }`;
    }
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      return `Record<string, ${jsonSchemaToTS(schema.additionalProperties, definitions)}>`;
    }
    return "Record<string, unknown>";
  }

  return "unknown";
}

// ── Generate Index ───────────────────────────────────────────────

function generateIndex(outDir) {
  const lines = [
    "// Auto-generated index — DO NOT EDIT",
    "/* eslint-disable */",
    "",
    'import type { OCPP16Methods } from "./ocpp16.js";',
    'import type { OCPP201Methods } from "./ocpp201.js";',
    'import type { OCPP21Methods } from "./ocpp21.js";',
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
  ];

  fs.writeFileSync(path.join(outDir, "index.ts"), lines.join("\n"));
}

// Execute if run directly
if (require.main === module) {
  main();
}

module.exports = { main, extractMethods, generateVersionFile, jsonSchemaToTS };
