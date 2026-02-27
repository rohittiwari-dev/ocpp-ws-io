// ─── Worker Entry Point for JSON Parse + Optional AJV ───────────
//
// This file runs in a worker_threads context.
// It receives raw message buffers, parses them, and optionally
// validates with AJV if schema info is provided.

import { parentPort } from "node:worker_threads";

if (!parentPort) {
  throw new Error("parse-worker must be run inside a worker thread");
}

// Lazy-loaded AJV instance for validation in the worker
let ajv: import("ajv").default | null = null;
const compiledSchemas = new Map<string, import("ajv").ValidateFunction>();

function getOrCompileSchema(
  schemaId: string,
  schemas: Record<string, unknown>,
): import("ajv").ValidateFunction | null {
  const cached = compiledSchemas.get(schemaId);
  if (cached) return cached;

  // Lazy-load AJV
  if (!ajv) {
    try {
      // Dynamic import to avoid bundling AJV in the worker if not needed
      const Ajv = require("ajv").default;
      const addFormats = require("ajv-formats").default;
      ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);

      // Add all schemas
      for (const [id, schema] of Object.entries(schemas)) {
        try {
          ajv!.addSchema(schema as object, id);
        } catch {
          // Ignore duplicate schema errors
        }
      }
    } catch {
      return null; // AJV not available
    }
  }

  try {
    const validate = ajv!.getSchema(schemaId);
    if (validate) {
      compiledSchemas.set(schemaId, validate);
      return validate;
    }
  } catch {
    // Schema not found
  }

  return null;
}

interface ParseRequest {
  id: number;
  buffer: Buffer | string;
  schemaInfo?: {
    protocol: string;
    schemas: Record<string, unknown>;
  };
}

interface ParseResponse {
  id: number;
  message?: unknown;
  validationError?: { schemaId: string; errors: string };
  error?: string;
}

parentPort.on("message", (request: ParseRequest) => {
  const { id, buffer, schemaInfo } = request;

  try {
    // Step 1: JSON.parse (the main CPU-bound work being offloaded)
    const message = JSON.parse(
      typeof buffer === "string" ? buffer : (buffer as unknown as string),
    );

    // Step 2: Optional AJV validation (only when strictMode + schema info provided)
    let validationError: ParseResponse["validationError"] | undefined;

    if (schemaInfo && Array.isArray(message) && message[0] === 2) {
      // CALL message: [2, messageId, method, payload]
      const method = message[2];
      const schemaId = `urn:${method}.req`;

      const validate = getOrCompileSchema(schemaId, schemaInfo.schemas);
      if (validate) {
        const valid = validate(message[3]);
        if (!valid) {
          validationError = {
            schemaId,
            errors: JSON.stringify(validate.errors),
          };
        }
      }
    }

    parentPort!.postMessage({ id, message, validationError } as ParseResponse);
  } catch (err) {
    parentPort!.postMessage({
      id,
      error: (err as Error).message,
    } as ParseResponse);
  }
});
