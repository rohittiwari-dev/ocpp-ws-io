/**
 * A generic interface for storing session state per connection/identity
 * across asynchronous OCPP messages.
 * E.g., mapping a numeric 1.6 transactionId to a 2.1 UUID string.
 */
export interface ISessionStore {
  /**
   * Set a key-value pair tied to a specific identity's session.
   */
  set(identity: string, key: string, value: any): Promise<void>;

  /**
   * Retrieve a value tied to a specific identity's session.
   */
  get<T = any>(identity: string, key: string): Promise<T | undefined>;

  /**
   * Delete a key tied to a specific identity's session.
   */
  delete(identity: string, key: string): Promise<void>;

  /**
   * Clear all session data for a specific identity (e.g. on disconnect).
   */
  clear(identity: string): Promise<void>;
}

export class InMemorySessionStore implements ISessionStore {
  // Map<identity, Map<key, value>>
  private store: Map<string, Map<string, any>> = new Map();

  public async set(identity: string, key: string, value: any): Promise<void> {
    if (!this.store.has(identity)) {
      this.store.set(identity, new Map());
    }
    this.store.get(identity)!.set(key, value);
  }

  public async get<T = any>(
    identity: string,
    key: string,
  ): Promise<T | undefined> {
    const session = this.store.get(identity);
    return session ? (session.get(key) as T) : undefined;
  }

  public async delete(identity: string, key: string): Promise<void> {
    const session = this.store.get(identity);
    if (session) {
      session.delete(key);
    }
  }

  public async clear(identity: string): Promise<void> {
    this.store.delete(identity);
  }
}
