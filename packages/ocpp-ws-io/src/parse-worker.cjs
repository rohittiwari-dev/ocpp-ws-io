"use strict";
// ─── Worker Entry Point for JSON Parse + Optional AJV ───────────
// Runs in a worker_threads context. Receives raw message data
// (string or Uint8Array — Buffers arrive as Uint8Array after the
// structured clone), parses it, and optionally validates with AJV.

const { parentPort } = require("node:worker_threads");

if (!parentPort) {
  throw new Error("parse-worker must be run inside a worker thread");
}

// Mirror src/validator.ts: rewrite OCPP 2.1 `urn:<Method>Request/Response`
// ids to the `.req`/`.conf` convention, then `urn:` -> `urn/` because
// AJV's fast-uri resolver rejects single-colon URNs.
function normalizeSchemaId(id) {
  const m = /^urn:(.+?)(Request|Response)$/.exec(id);
  let out = m ? `urn:${m[1]}.${m[2] === "Request" ? "req" : "conf"}` : id;
  if (out.startsWith("urn:")) out = out.replace("urn:", "urn/");
  return out;
}

// Lazy-loaded AJV instance for validation in the worker
let ajv = null;
const compiledSchemas = new Map();

function getOrCompileSchema(schemaId, schemas) {
  const normalizedId = normalizeSchemaId(schemaId);
  const cached = compiledSchemas.get(normalizedId);
  if (cached) return cached;

  if (!ajv) {
    try {
      const Ajv = require("ajv").default;
      const addFormats = require("ajv-formats").default;
      ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      for (const [id, schema] of Object.entries(schemas)) {
        try {
          ajv.addSchema({ ...schema, $id: undefined }, normalizeSchemaId(id));
        } catch {
          // Ignore duplicate schema errors
        }
      }
    } catch {
      return null; // AJV not available
    }
  }

  try {
    const validate = ajv.getSchema(normalizedId);
    if (validate) {
      compiledSchemas.set(normalizedId, validate);
      return validate;
    }
  } catch {
    // Schema not found
  }
  return null;
}

parentPort.on("message", (request) => {
  const { id, buffer, schemaInfo } = request;
  try {
    // Buffers are cloned as Uint8Array across postMessage — decode to utf8
    // text before parsing (JSON.parse on a Uint8Array would throw).
    const text =
      typeof buffer === "string" ? buffer : Buffer.from(buffer).toString("utf8");
    const message = JSON.parse(text);

    let validationError;
    if (schemaInfo && Array.isArray(message) && message[0] === 2) {
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

    parentPort.postMessage({ id, message, validationError });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
