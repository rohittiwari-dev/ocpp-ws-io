/**
 * @module voltlog
 * @description Log level utilities — filtering, comparison, resolution.
 */

import { LogLevel, LogLevelNameMap, type LogLevelName } from "./types.js";

/**
 * Resolve a level name string to its numeric value.
 * Case-insensitive. Returns INFO if unrecognized.
 */
export function resolveLevel(level: string | LogLevelName): number {
  const n = LogLevelNameMap[level.toLowerCase()];
  return n !== undefined ? n : LogLevel.INFO;
}

/**
 * Check if a log entry at `entryLevel` passes the `filterLevel`.
 */
export function shouldLog(entryLevel: number, filterLevel: number): boolean {
  return entryLevel >= filterLevel;
}

/**
 * Determine whether to include stack trace for a given entry level.
 */
export function shouldIncludeStack(
  entryLevel: number,
  includeStack: boolean | LogLevelName,
): boolean {
  if (typeof includeStack === "boolean") return includeStack;
  return entryLevel >= resolveLevel(includeStack);
}
