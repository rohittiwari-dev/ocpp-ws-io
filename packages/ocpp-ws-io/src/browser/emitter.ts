/**
 * Tiny browser-compatible typed EventEmitter.
 * Drop-in replacement for Node.js EventEmitter in browser contexts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

/** A listener as stored: a once() wrapper keeps the listener it wraps, for off(). */
type StoredListener = Listener & { __wrapped?: Listener };

export class EventEmitter {
  private _listeners = new Map<string, StoredListener[]>();

  on(event: string, listener: Listener): this {
    const arr = this._listeners.get(event);
    if (arr) {
      arr.push(listener);
    } else {
      this._listeners.set(event, [listener]);
    }
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapper: StoredListener = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    wrapper.__wrapped = listener;
    return this.on(event, wrapper);
  }

  off(event: string, listener: Listener): this {
    const arr = this._listeners.get(event);
    if (!arr) return this;
    const idx = arr.findIndex(
      (fn) => fn === listener || fn.__wrapped === listener,
    );
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) this._listeners.delete(event);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const arr = this._listeners.get(event);
    if (!arr || arr.length === 0) return false;
    for (const fn of [...arr]) {
      fn(...args);
    }
    return true;
  }

  addListener(event: string, listener: Listener): this {
    return this.on(event, listener);
  }

  removeListener(event: string, listener: Listener): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }

  listenerCount(event: string): number {
    return this._listeners.get(event)?.length ?? 0;
  }
}
