import fs from "node:fs";
import path from "node:path";
import type { SchemaEntry } from "./type-generator.js";

/**
 * Fetch an OCPP JSON schema from a URL or local file path.
 */
export async function fetchSchema(source: string): Promise<SchemaEntry[]> {
  // URL source — fetch remotely
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText} — ${source}`);
    }
    return (await res.json()) as SchemaEntry[];
  }

  // Local file path
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw) as SchemaEntry[];
}
