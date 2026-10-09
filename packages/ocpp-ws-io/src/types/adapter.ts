/** The cluster adapter contract. */
import type { PersistedSession } from "./session.js";

export interface EventAdapterInterface {
  publish(channel: string, data: unknown): Promise<void>;
  publishBatch?(messages: { channel: string; data: unknown }[]): Promise<void>;
  subscribe(channel: string, handler: (data: unknown) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  disconnect(): Promise<void>;

  // Presence Registry (Optional)
  setPresence?(identity: string, nodeId: string, ttl: number): Promise<void>;
  getPresence?(identity: string): Promise<string | null>;
  getPresenceBatch?(identities: string[]): Promise<(string | null)[]>;
  removePresence?(identity: string): Promise<void>;
  /**
   * Batch set multiple presence entries in a single pipeline.
   * Reduces N network round-trips to 1 for bulk presence updates.
   */
  setPresenceBatch?(
    entries: { identity: string; nodeId: string; ttl?: number }[],
  ): Promise<void>;

  // ── Presence Fencing (Optional, but required for correct multi-node) ──
  //
  // `setPresence` / `removePresence` are unconditional, so a node that no
  // longer owns an identity can overwrite or delete the entry another node
  // just wrote. That happens routinely: a charger drops from node A and
  // reconnects to node B, then A's close handler fires and deletes B's entry,
  // leaving the charger unroutable cross-node until the next heartbeat.
  //
  // These two methods make the write conditional on current ownership.
  // Implement them atomically (a Lua script on Redis); the server falls back
  // to the unfenced calls when an adapter does not provide them.

  /**
   * Delete the presence entry for `identity` only if it currently names
   * `nodeId`. Returns true if it was deleted, false if another node owns it
   * (or no entry exists).
   */
  removePresenceIfOwned?(identity: string, nodeId: string): Promise<boolean>;

  /**
   * Claim or refresh presence for `identity` — set it to `nodeId` with `ttl`
   * only if the entry is absent or already names `nodeId`. Returns false when
   * a different node owns it, which tells the caller its local socket is stale.
   */
  claimPresence?(
    identity: string,
    nodeId: string,
    ttl: number,
  ): Promise<boolean>;

  // ── Session Persistence (Optional) ──────────────────────────────
  //
  // Implement both to let sessions survive a charger reconnecting to another
  // node. Without them the server's in-memory LRU is the only store.

  /**
   * Store the session for `identity`, expiring after `ttl` seconds. Called
   * when a charger connects, when it disconnects, and on its messages at
   * most once every 30 seconds.
   */
  setSession?(
    identity: string,
    data: PersistedSession,
    ttl: number,
  ): Promise<void>;

  /**
   * Return the stored session, or `null` when there is none. Called when a
   * charger connects (unless it is still connected to this node); a copy
   * found here takes precedence over the node's in-memory one.
   */
  getSession?(identity: string): Promise<PersistedSession | null>;

  // Observability Pipeline (Optional)
  metrics?(): Promise<Record<string, unknown>>;
}
