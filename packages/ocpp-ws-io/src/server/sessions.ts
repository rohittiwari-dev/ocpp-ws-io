import type { LRUMap } from "../core/lru-map.js";
import type { EventAdapterInterface } from "../types/adapter.js";
import type { PersistedSession } from "../types/session.js";

// The server's session cache: each identity's session as last used, written
// through to the adapter when it stores sessions, and swept by age.

/** A session as the server caches it: its data, and when it was last used. */
export interface CachedSession {
  data: PersistedSession;
  lastActive: number;
}

/** The session cache and the bookkeeping of its writes to the adapter. */
export interface SessionCache {
  sessions: LRUMap<string, CachedSession>;
  /** When each identity's session was last written to the adapter. */
  lastPersisted: Map<string, number>;
  /** Adapter writes still in flight; close() waits for them. */
  pendingWrites: Set<Promise<unknown>>;
  /** How long a session lives without activity. */
  timeoutMs: number;
}

const SESSION_PERSIST_DEBOUNCE_MS = 30_000;

export function recordSessionActivity(
  cache: SessionCache,
  adapter: EventAdapterInterface | null,
  identity: string,
  data: PersistedSession,
  force?: boolean,
): void {
  const now = Date.now();

  // LRU is always updated — it serves as the hot cache on every path.
  cache.sessions.set(identity, { data, lastActive: now });

  // When the adapter supports sessions, also persist to Redis.
  // Activity-only writes are debounced (at most once per 30 s) to avoid
  // flooding the store on high-message connections.
  if (!adapter?.setSession) return;

  if (!force) {
    const lastPersisted = cache.lastPersisted.get(identity);
    if (
      lastPersisted !== undefined &&
      now - lastPersisted < SESSION_PERSIST_DEBOUNCE_MS
    ) {
      return;
    }
  }

  cache.lastPersisted.set(identity, now);
  const ttlSeconds = Math.ceil(cache.timeoutMs / 1000);
  const write: Promise<void> = adapter
    .setSession(identity, data, ttlSeconds)
    .catch(() => {})
    .finally(() => cache.pendingWrites.delete(write));
  cache.pendingWrites.add(write);
}

/** Drop sessions idle longer than the session TTL. */
export function sweepExpiredSessions(cache: SessionCache, now: number): void {
  for (const [identity, session] of cache.sessions.entries()) {
    if (now - session.lastActive > cache.timeoutMs) {
      cache.sessions.delete(identity);
    }
  }
}

/**
 * Drop debounce marks old enough that they no longer suppress a write. Swept
 * by age rather than alongside the LRU, which evicts without telling us.
 */
export function sweepPersistMarks(cache: SessionCache, now: number): void {
  for (const [identity, at] of cache.lastPersisted) {
    if (now - at >= SESSION_PERSIST_DEBOUNCE_MS) {
      cache.lastPersisted.delete(identity);
    }
  }
}
