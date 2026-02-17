import { EventEmitter } from "node:events";

/**
 * An event buffer that captures events emitted during a critical transition period
 * (e.g., during WebSocket connection setup) and replays them in order once the
 * consumer is ready.
 */
export class EventBuffer {
  private _target: EventEmitter;
  private _events: string[];
  private _buffer: Array<{ event: string; args: unknown[] }> = [];
  private _listeners: Map<string, (...args: unknown[]) => void> = new Map();
  private _active = false;

  constructor(target: EventEmitter, events: string[]) {
    this._target = target;
    this._events = events;
  }

  /**
   * Start buffering events. Any matching events emitted on the target
   * will be captured instead of being processed immediately.
   */
  start(): void {
    if (this._active) return;
    this._active = true;

    for (const event of this._events) {
      const listener = (...args: unknown[]) => {
        this._buffer.push({ event, args });
      };
      this._listeners.set(event, listener);
      this._target.on(event, listener);
    }
  }

  /**
   * Stop buffering and replay all captured events on the target
   * in the order they were received.
   */
  condense(): void {
    if (!this._active) return;
    this._active = false;

    // Remove buffer listeners
    for (const [event, listener] of this._listeners) {
      this._target.removeListener(event, listener);
    }
    this._listeners.clear();

    // Replay buffered events
    const events = this._buffer.slice();
    this._buffer = [];

    for (const { event, args } of events) {
      this._target.emit(event, ...args);
    }
  }

  /**
   * Stop buffering and discard all captured events.
   */
  discard(): void {
    if (!this._active) return;
    this._active = false;

    for (const [event, listener] of this._listeners) {
      this._target.removeListener(event, listener);
    }
    this._listeners.clear();
    this._buffer = [];
  }
}
