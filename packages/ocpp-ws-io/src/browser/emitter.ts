/**
 * Tiny browser-compatible typed EventEmitter.
 * Drop-in replacement for Node.js EventEmitter in browser contexts.
 */

/** A listener of an event emitted with arguments A. */
type Listener<A extends unknown[]> = (...args: A) => void;

/** A listener as stored: a once() wrapper keeps the listener it wraps, for off(). */
type StoredListener<A extends unknown[]> = Listener<A> & {
  __wrapped?: Listener<A>;
};

/** Each event's listeners, by event name. */
type ListenerMap<TEvents extends Record<keyof TEvents, unknown[]>> = {
  [K in keyof TEvents]?: StoredListener<TEvents[K]>[];
};

/**
 * TEvents maps each event name to the arguments it is emitted with, as the
 * Node client's `ClientEvents` does. Without it, any event takes any
 * arguments.
 */
export class EventEmitter<
  TEvents extends Record<keyof TEvents, unknown[]> = Record<string, unknown[]>,
> {
  // No prototype: an event named like an Object method ("toString") starts
  // with no listeners.
  private _listeners: ListenerMap<TEvents> = Object.create(null);

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): this {
    const arr = this._listeners[event];
    if (arr) {
      arr.push(listener);
    } else {
      this._listeners[event] = [listener];
    }
    return this;
  }

  once<K extends keyof TEvents>(
    event: K,
    listener: Listener<TEvents[K]>,
  ): this {
    const wrapper: StoredListener<TEvents[K]> = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    wrapper.__wrapped = listener;
    return this.on(event, wrapper);
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): this {
    const arr = this._listeners[event];
    if (!arr) return this;
    const idx = arr.findIndex(
      (fn) => fn === listener || fn.__wrapped === listener,
    );
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) delete this._listeners[event];
    return this;
  }

  emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): boolean {
    const arr = this._listeners[event];
    if (!arr || arr.length === 0) return false;
    for (const fn of [...arr]) {
      fn(...args);
    }
    return true;
  }

  addListener<K extends keyof TEvents>(
    event: K,
    listener: Listener<TEvents[K]>,
  ): this {
    return this.on(event, listener);
  }

  removeListener<K extends keyof TEvents>(
    event: K,
    listener: Listener<TEvents[K]>,
  ): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: keyof TEvents): this {
    if (event) {
      delete this._listeners[event];
    } else {
      this._listeners = Object.create(null);
    }
    return this;
  }

  listenerCount(event: keyof TEvents): number {
    return this._listeners[event]?.length ?? 0;
  }
}
