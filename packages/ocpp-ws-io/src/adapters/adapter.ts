import type { EventAdapterInterface } from "../types.js";

/**
 * In-memory event adapter for single-process use.
 * Events are dispatched synchronously within the same process.
 */
export class InMemoryAdapter implements EventAdapterInterface {
  private _channels = new Map<string, Set<(data: unknown) => void>>();

  async publish(channel: string, data: unknown): Promise<void> {
    const handlers = this._channels.get(channel);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {
          // Swallow handler errors
        }
      }
    }
  }

  async publishBatch(
    messages: { channel: string; data: unknown }[],
  ): Promise<void> {
    for (const msg of messages) {
      await this.publish(msg.channel, msg.data);
    }
  }

  async subscribe(
    channel: string,
    handler: (data: unknown) => void,
  ): Promise<void> {
    if (!this._channels.has(channel)) {
      this._channels.set(channel, new Set());
    }
    this._channels.get(channel)?.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this._channels.delete(channel);
  }

  async disconnect(): Promise<void> {
    this._channels.clear();
    this._presence.clear();
  }

  // ─── Presence Registry (In-Memory) ─────────────────────────────────

  private _presence = new Map<string, string>();

  async setPresence(
    identity: string,
    nodeId: string,
    // ttl is ignored in memory adapter
    _ttl: number,
  ): Promise<void> {
    this._presence.set(identity, nodeId);
  }

  async getPresence(identity: string): Promise<string | null> {
    return this._presence.get(identity) || null;
  }

  async getPresenceBatch(identities: string[]): Promise<(string | null)[]> {
    return identities.map((id) => this._presence.get(id) || null);
  }

  async removePresence(identity: string): Promise<void> {
    this._presence.delete(identity);
  }

  async setPresenceBatch(
    entries: { identity: string; nodeId: string; ttl?: number }[],
  ): Promise<void> {
    for (const { identity, nodeId } of entries) {
      this._presence.set(identity, nodeId);
    }
  }

  // ─── Presence Fencing ──────────────────────────────────────────────
  // Trivially atomic here: a single process, no await between read and write.

  async removePresenceIfOwned(
    identity: string,
    nodeId: string,
  ): Promise<boolean> {
    if (this._presence.get(identity) !== nodeId) return false;
    this._presence.delete(identity);
    return true;
  }

  async claimPresence(
    identity: string,
    nodeId: string,
    // ttl is ignored in the memory adapter
    _ttl: number,
  ): Promise<boolean> {
    const owner = this._presence.get(identity);
    if (owner !== undefined && owner !== nodeId) return false;
    this._presence.set(identity, nodeId);
    return true;
  }
}

/**
 * Helper function to create a custom EventAdapter without needing to define a rigid Class.
 * Provides full TypeScript inference for the `EventAdapterInterface`.
 *
 * @example
 * ```typescript
 * const myAdapter = defineAdapter({
 *   publish: async (channel, data) => { ... },
 *   subscribe: async (channel, handler) => { ... },
 *   unsubscribe: async (channel) => { ... },
 *   disconnect: async () => { ... }
 * });
 * server.setAdapter(myAdapter);
 * ```
 */
export function defineAdapter(
  adapter: EventAdapterInterface,
): EventAdapterInterface {
  return adapter;
}
