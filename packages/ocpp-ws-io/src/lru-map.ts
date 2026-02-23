/**
 * LRUMap — A zero-dependency, drop-in Map replacement with a maximum capacity.
 *
 * Evicts the **least recently used** entry when the capacity is exceeded.
 * Uses native Map insertion-order semantics for O(1) LRU tracking
 * (delete + re-insert moves a key to the "most recent" end).
 *
 * @remarks
 * This is used by OCPPServer to bound the `_sessions` map and prevent OOM under
 * DDoS or reconnection storms with transient identities.
 */
export class LRUMap<K, V> extends Map<K, V> {
  private _maxSize: number;

  constructor(maxSize: number) {
    super();
    if (maxSize < 1) throw new RangeError("LRUMap maxSize must be >= 1");
    this._maxSize = maxSize;
  }

  /**
   * Returns the configured maximum capacity of this LRU cache.
   */
  get maxSize(): number {
    return this._maxSize;
  }

  /**
   * Sets a key-value pair. If the key already exists, it is promoted to the
   * most-recently-used position. If inserting a new key would exceed capacity,
   * the oldest (least-recently-used) entry is evicted.
   */
  override set(key: K, value: V): this {
    // If key exists, delete first to re-insert at end (promote to MRU)
    if (this.has(key)) {
      this.delete(key);
    }
    super.set(key, value);

    // Evict oldest if over capacity
    if (this.size > this._maxSize) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) {
        this.delete(oldest);
      }
    }
    return this;
  }

  /**
   * Gets a value by key and promotes it to the most-recently-used position.
   * Uses `this.has(key)` instead of a value truthiness check to correctly
   * handle stored values of `undefined`, `null`, `0`, `""`, etc.
   */
  override get(key: K): V | undefined {
    if (!this.has(key)) return undefined;
    const value = super.get(key)!;
    // Promote to MRU position
    this.delete(key);
    super.set(key, value);
    return value;
  }
}
