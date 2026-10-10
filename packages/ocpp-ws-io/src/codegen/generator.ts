// The type generator: OCPP JSON schemas in, TypeScript types out. The
// library's own types (src/generated, through `npm run generate`) and
// `ocpp generate` both come from it.

/** One protocol to write: its schema file, map names and protocol name. */
export interface VersionConfig {
  /** The types file's name, without extension. */
  key: string;
  /** The schema file, named in the types file's header. */
  file: string;
  /** The interface of the CALL actions, the `OCPPMethodMap` entry. */
  mapName: string;
  /** The interface of the SEND messages, the `OCPPSendMethodMap` entry. */
  sendMapName: string;
  /** The subprotocol, such as "vendor-proto". */
  protocol: string;
}

/** A value a schema can list in `enum`. */
type JsonPrimitive = string | number | boolean | null;

export interface SchemaEntry {
  $id?: string;
  type?: string | string[];
  enum?: JsonPrimitive[];
  properties?: Record<string, SchemaEntry>;
  required?: string[];
  definitions?: Record<string, SchemaEntry>;
  items?: SchemaEntry;
  $ref?: string;
  anyOf?: SchemaEntry[];
  oneOf?: SchemaEntry[];
  additionalProperties?: SchemaEntry | boolean;
  description?: string;
}

/** A CALL action's request and response schemas. */
export interface MethodSchemas {
  request?: SchemaEntry;
  response?: SchemaEntry;
}

/** Options for {@link generateVersionFile}. */
export interface GenerateOptions {
  /**
   * The module the types file imports `JsonValue` from. The default is the
   * library's own types, for its src/generated; a project outside it names
   * "ocpp-ws-io".
   */
  typesModule?: string;
}

// ── Extract Methods ────────────────────────────────────────────

/**
 * CALL actions by name, from `urn:<Name>.req` / `urn:<Name>.conf` (OCPP 1.6,
 * 2.0.1) or `urn:<Name>Request` / `urn:<Name>Response` (OCPP 2.1).
 */
export function extractMethods(
  schema: SchemaEntry[],
): Map<string, MethodSchemas> {
  const methods = new Map<string, MethodSchemas>();
  const methodNamed = (name: string): MethodSchemas => {
    let method = methods.get(name);
    if (!method) {
      method = {};
      methods.set(name, method);
    }
    return method;
  };

  for (const entry of schema) {
    const id = entry.$id;
    if (!id) continue;

    // OCPP 1.6 / 2.0.1 format: urn:MethodName.req / urn:MethodName.conf
    let match = id.match(/^urn:(.+)\.(req|conf)$/);
    if (match) {
      const [, name, suffix] = match;
      methodNamed(name)[suffix === "req" ? "request" : "response"] = entry;
      continue;
    }

    // OCPP 2.1 format: urn:MethodNameRequest / urn:MethodNameResponse
    match = id.match(/^urn:(.+)(Request|Response)$/);
    if (match) {
      const [, name, suffix] = match;
      methodNamed(name)[suffix === "Request" ? "request" : "response"] = entry;
    }
  }

  return methods;
}

/**
 * Unconfirmed (SEND) messages by name, as in OCPP 2.1: a single schema whose
 * id has no request or response suffix, such as `urn:NotifyPeriodicEventStream`.
 */
export function extractSendMethods(
  schema: SchemaEntry[],
): Map<string, SchemaEntry> {
  const sendMethods = new Map<string, SchemaEntry>();
  for (const entry of schema) {
    const id = entry.$id;
    if (!id) continue;
    const match = id.match(/^urn:([A-Za-z][A-Za-z0-9]*)$/);
    if (!match || /(Request|Response)$/.test(match[1])) continue;
    sendMethods.set(match[1], entry);
  }
  return sendMethods;
}

// ── Open objects ───────────────────────────────────────────────

// JSON Schema allows keys an object does not list unless
// `additionalProperties` is false. Typed methods reject keys the generated
// types do not define, so an open object gets an index signature.
// `undefined` keeps optional properties compatible with the signature.
const OPEN_VALUE = "JsonValue | undefined";

function isOpen(schema: SchemaEntry): boolean {
  return schema.additionalProperties !== false;
}

// ── JSON Schema → TypeScript Type ──────────────────────────────

export function jsonSchemaToTS(
  schema: SchemaEntry | undefined,
  definitions: Map<string, SchemaEntry>,
): string {
  // No schema, or no type: any JSON value.
  if (!schema) return "JsonValue";

  // $ref
  if (schema.$ref) {
    return schema.$ref.replace("#/definitions/", "");
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
    return "JsonValue[]";
  }

  if (type === "object") {
    // A closed object with no fields takes only `{}`: an empty object type
    // would take any value but null and undefined, a number included.
    if (!isOpen(schema) && Object.keys(schema.properties || {}).length === 0) {
      return "Record<string, never>";
    }
    if (schema.properties) {
      const required = new Set(schema.required || []);
      const props = Object.entries(schema.properties).map(([name, ps]) => {
        const opt = required.has(name) ? "" : "?";
        return `${name}${opt}: ${jsonSchemaToTS(ps, definitions)}`;
      });
      if (isOpen(schema)) props.push(`[key: string]: ${OPEN_VALUE}`);
      return `{ ${props.join("; ")} }`;
    }
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      return `Record<string, ${jsonSchemaToTS(
        schema.additionalProperties,
        definitions,
      )}>`;
    }
    if (schema.additionalProperties === false) return "Record<string, never>";
    return `{ [key: string]: ${OPEN_VALUE} }`;
  }

  return "JsonValue";
}

// ── Generate Named Type ────────────────────────────────────────

function generateNamedType(
  name: string,
  schema: SchemaEntry,
  definitions: Map<string, SchemaEntry>,
): string[] {
  if (schema.type === "string" && schema.enum) {
    return [
      `export type ${name} = ${schema.enum.map((v) => `"${v}"`).join(" | ")};`,
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
  // As in jsonSchemaToTS: a closed interface with no fields takes only `{}`.
  const emptyClosed =
    !isOpen(schema) && Object.keys(schema.properties || {}).length === 0;
  const base = emptyClosed ? " extends Record<string, never>" : "";
  lines.push(`export interface ${name}${base} {`);

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
  if (isOpen(schema)) lines.push(`  [key: string]: ${OPEN_VALUE};`);

  lines.push("}");
  return lines;
}

// ── Generate Version File ──────────────────────────────────────

/**
 * The types of one protocol: shared definitions, each CALL action's request
 * and response, the CALL map and the SEND map.
 */
export function generateVersionFile(
  version: VersionConfig,
  methods: Map<string, MethodSchemas>,
  sendMethods: Map<string, SchemaEntry> = new Map(),
  options: GenerateOptions = {},
): string {
  const lines: string[] = [];
  lines.push(
    `// Auto-generated from ${version.file} — DO NOT EDIT`,
    "/* eslint-disable */",
    "",
  );

  // Collect all definitions across all schema entries
  const allDefinitions = new Map<string, SchemaEntry>();
  const entryGroups = [
    ...[...methods.values()].map((s) => [s.request, s.response]),
    ...[...sendMethods.values()].map((entry) => [entry]),
  ];
  for (const entries of entryGroups) {
    for (const entry of entries) {
      if (!entry?.definitions) continue;
      for (const [defName, defSchema] of Object.entries(entry.definitions)) {
        // Use first occurrence (schemas often duplicate definitions)
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

  // Unconfirmed (SEND) messages get their own map so call() cannot send them
  // as a CALL and send() cannot send a CALL action.
  lines.push("// ═══ SEND Message Map (unconfirmed, no response) ═══", "");
  if (sendMethods.size === 0) {
    lines.push(
      `export type ${version.sendMapName} = Record<never, never>;`,
      "",
    );
  } else {
    for (const [name, entry] of sendMethods) {
      lines.push(...generateInterface(name, entry, allDefinitions), "");
    }
    lines.push(`export interface ${version.sendMapName} {`);
    for (const [name] of sendMethods) {
      lines.push(`  ${name}: { request: ${name} };`);
    }
    lines.push("}", "");
  }

  // Open objects and untyped fields use JsonValue from the library's types.
  const body = lines.join("\n");
  if (!/\bJsonValue\b/.test(body)) return body;
  const [first, second, ...rest] = lines;
  const typesModule = options.typesModule ?? "../types/index.js";
  return [
    first,
    second,
    `import type { JsonValue } from "${typesModule}";`,
    ...rest,
  ].join("\n");
}
