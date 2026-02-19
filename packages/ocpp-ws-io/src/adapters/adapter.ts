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
  }
}
