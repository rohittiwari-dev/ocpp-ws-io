"use strict";
// ─── Worker Entry Point for JSON Parse ──────────────────────────
// Runs in a worker_threads context. Receives raw message data
// (string or Uint8Array — Buffers arrive as Uint8Array after the
// structured clone), parses it, and posts the result back.
//
// Parsing is the expensive half of handling a frame: a 13 KB MeterValues
// costs ~60 µs to parse against ~16 µs to validate. Validation stays on the
// main thread, where it can throw and turn into a CALLERROR — see
// OCPPClient._validateInbound.

const { parentPort } = require("node:worker_threads");

if (!parentPort) {
  throw new Error("parse-worker must be run inside a worker thread");
}

parentPort.on("message", (request) => {
  const { id, buffer } = request;
  try {
    // Buffers are cloned as Uint8Array across postMessage — decode to utf8
    // text before parsing (JSON.parse on a Uint8Array would throw).
    const text =
      typeof buffer === "string" ? buffer : Buffer.from(buffer).toString("utf8");
    const message = JSON.parse(text);
    parentPort.postMessage({ id, message });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
