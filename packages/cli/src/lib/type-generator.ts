// ── Configuration ──────────────────────────────────────────────

export interface VersionConfig {
  key: string;
  file: string;
  mapName: string;
  protocol: string;
}

export const VERSIONS: VersionConfig[] = [
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

export interface SchemaEntry {
  $id?: string;
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, SchemaEntry>;
  required?: string[];
  definitions?: Record<string, SchemaEntry>;
  items?: SchemaEntry;
  $ref?: string;
  anyOf?: SchemaEntry[];
  oneOf?: SchemaEntry[];
  additionalProperties?: SchemaEntry | boolean;
}

// ── Extract Methods ────────────────────────────────────────────

export function extractMethods(
  schema: SchemaEntry[],
): Map<string, { request?: SchemaEntry; response?: SchemaEntry }> {
  const methods = new Map<
    string,
    { request?: SchemaEntry; response?: SchemaEntry }
  >();

  for (const entry of schema) {
    const id = entry.$id;
    if (!id) continue;

    // OCPP 1.6 / 2.0.1 format: urn:MethodName.req / urn:MethodName.conf
    let match = id.match(/^urn:(.+)\.(req|conf)$/);
    if (match) {
      const [, name, suffix] = match;
      if (!methods.has(name)) methods.set(name, {});
      const method = methods.get(name);
      if (method?.[suffix === "req" ? "request" : "response"]) {
        method[suffix === "req" ? "request" : "response"] = entry;
      }
      continue;
    }

    // OCPP 2.1 format: urn:MethodNameRequest / urn:MethodNameResponse
    match = id.match(/^urn:(.+)(Request|Response)$/);
    if (match) {
      const [, name, suffix] = match;
      if (!methods.has(name)) methods.set(name, {});
      const method = methods.get(name);
      if (method?.[suffix === "Request" ? "request" : "response"]) {
        method[suffix === "Request" ? "request" : "response"] = entry;
      }
    }
  }

  return methods;
}

// ── JSON Schema → TypeScript Type ──────────────────────────────

function jsonSchemaToTS(
  schema: SchemaEntry | undefined,
  definitions: Map<string, SchemaEntry>,
): string {
  if (!schema) return "unknown";

  // $ref
  if (schema?.$ref) {
    return schema?.$ref?.replace("#/definitions/", "");
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
      return `Record<string, ${jsonSchemaToTS(
        schema.additionalProperties as SchemaEntry,
        definitions,
      )}>`;
    }
    return "Record<string, unknown>";
  }

  return "unknown";
}

// ── Generate Named Type ────────────────────────────────────────

function generateNamedType(
  name: string,
  schema: SchemaEntry,
  definitions: Map<string, SchemaEntry>,
): string[] {
  if (schema.type === "string" && schema.enum) {
    return [
      `export type ${name} = ${(schema.enum as string[])
        .map((v) => `"${v}"`)
        .join(" | ")};`,
    ];
  }
  if (schema.type === "object") {
    return generateInterface(name, schema, definitions);
  }
  return [`export type ${name} = ${jsonSchemaToTS(schema, definitions)};`];
}

// ── Generate Interface ─────────────────────────────────────────

function generateInterface(
  name: string,
  schema: SchemaEntry,
  definitions: Map<string, SchemaEntry>,
): string[] {
  const lines: string[] = [];
  lines.push(`export interface ${name} {`);

  if (schema.properties) {
    const required = new Set(schema.required || []);
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const opt = required.has(propName) ? "" : "?";
      const tsType = jsonSchemaToTS(propSchema, definitions);
      const safeName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propName)
        ? propName
        : `"${propName}"`;
      lines.push(`  ${safeName}${opt}: ${tsType};`);
    }
  }

  lines.push("}");
  return lines;
}

// ── Generate Version File ──────────────────────────────────────

export function generateVersionFile(
  version: VersionConfig,
  methods: Map<string, { request?: SchemaEntry; response?: SchemaEntry }>,
): string {
  const lines: string[] = [];
  lines.push(
    `// Auto-generated by ocpp-ws-cli from ${version.file} — DO NOT EDIT`,
    "/* eslint-disable */",
    "",
  );

  // Collect all definitions
  const allDefinitions = new Map<string, SchemaEntry>();
  for (const [, schemas] of methods) {
    for (const entry of [schemas.request, schemas.response]) {
      if (!entry?.definitions) continue;
      for (const [defName, defSchema] of Object.entries(entry.definitions)) {
        if (!allDefinitions.has(defName)) {
          allDefinitions.set(defName, defSchema);
        }
      }
    }
  }

  // Shared types
  if (allDefinitions.size > 0) {
    lines.push("// ═══ Shared Types ═══", "");
    for (const [defName, defSchema] of allDefinitions) {
      lines.push(...generateNamedType(defName, defSchema, allDefinitions), "");
    }
  }

  // Method types
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

  // Method map
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

// ── Generate Index ─────────────────────────────────────────────

export function generateIndexFile(versions: VersionConfig[]): string {
  const lines: string[] = [
    "// Auto-generated by ocpp-ws-cli — DO NOT EDIT",
    "/* eslint-disable */",
    "",
  ];

  for (const v of versions) {
    lines.push(`import type { ${v.mapName} } from "./${v.key}.js";`);
  }

  lines.push(
    "",
    "/**",
    " * Maps OCPP protocol strings to their method type maps.",
    " * Used by OCPPClient<P> and OCPPServer to provide auto-typed",
    " * handle(), call(), and event listener signatures.",
    " */",
    "export interface OCPPMethodMap {",
  );

  for (const v of versions) {
    lines.push(`  "${v.protocol}": ${v.mapName};`);
  }

  lines.push(
    "}",
    "",
    "/** All valid OCPP protocol strings. */",
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
  );

  return lines.join("\n");
}
