import { describe, expect, test } from "vitest";
import { InMemoryAdapter } from "../src/adapters/adapter.js";
import { RedisAdapter } from "../src/adapters/redis/index.js";

// Presence writes used to be unconditional, so a node that no longer owned an
// identity could delete or overwrite the entry another node had just written.
// That happens routinely: a charger drops from node A and reconnects to node B,
// then A's teardown lands afterwards and wipes B's entry.

describe("presence fencing", () => {
  describe("InMemoryAdapter", () => {
    test("removePresenceIfOwned only deletes an entry this node owns", async () => {
      const a = new InMemoryAdapter();
      await a.setPresence("CP001", "node-B", 300);

      expect(await a.removePresenceIfOwned("CP001", "node-A")).toBe(false);
      expect(await a.getPresence("CP001")).toBe("node-B");

      expect(await a.removePresenceIfOwned("CP001", "node-B")).toBe(true);
      expect(await a.getPresence("CP001")).toBeNull();
    });

    test("claimPresence refuses an identity another node owns", async () => {
      const a = new InMemoryAdapter();
      await a.setPresence("CP001", "node-B", 300);

      expect(await a.claimPresence("CP001", "node-A", 300)).toBe(false);
      expect(await a.getPresence("CP001")).toBe("node-B");
    });

    test("claimPresence takes a free entry and refreshes its own", async () => {
      const a = new InMemoryAdapter();

      expect(await a.claimPresence("CP001", "node-A", 300)).toBe(true);
      expect(await a.getPresence("CP001")).toBe("node-A");

      expect(await a.claimPresence("CP001", "node-A", 300)).toBe(true);
      expect(await a.getPresence("CP001")).toBe("node-A");
    });
  });

  describe("RedisAdapter", () => {
    // Minimal driver: a Map plus a real Lua-free interpreter stand-in. The
    // adapter must send the compare-and-set to the server rather than doing
    // GET-then-SET locally, so evalScript is what we assert on.
    function makeDriver() {
      const store = new Map<string, string>();
      const calls: { script: string; keys: string[]; args: string[] }[] = [];
      return {
        store,
        calls,
        driver: {
          publish: async () => {},
          subscribe: async () => {},
          unsubscribe: async () => {},
          disconnect: async () => {},
          set: async (k: string, v: string) => {
            store.set(k, v);
          },
          get: async (k: string) => store.get(k) ?? null,
          mget: async (ks: string[]) => ks.map((k) => store.get(k) ?? null),
          del: async (k: string) => {
            store.delete(k);
          },
          setPresenceBatch: async () => {},
          expire: async () => {},
          xadd: async () => "1-1",
          xaddBatch: async () => {},
          xread: async () => null,
          xlen: async () => 0,
          evalScript: async (script: string, keys: string[], args: string[]) => {
            calls.push({ script, keys, args });
            const key = keys[0];
            const owner = store.get(key);
            if (script.includes("DEL")) {
              if (owner === args[0]) {
                store.delete(key);
                return 1;
              }
              return 0;
            }
            if (owner === undefined || owner === args[0]) {
              store.set(key, args[0]);
              return 1;
            }
            return 0;
          },
        },
      };
    }

    test("removePresenceIfOwned runs server-side and respects ownership", async () => {
      const { store, calls, driver } = makeDriver();
      const adapter = new RedisAdapter({ driver: driver as never });
      const key = "ocpp-ws-io:presence:CP001";
      store.set(key, "node-B");

      expect(await adapter.removePresenceIfOwned("CP001", "node-A")).toBe(false);
      expect(store.get(key)).toBe("node-B");

      expect(await adapter.removePresenceIfOwned("CP001", "node-B")).toBe(true);
      expect(store.has(key)).toBe(false);

      // Must be atomic on the server, not a local read-then-delete.
      expect(calls.length).toBe(2);
      expect(calls[0].script).toContain("DEL");
    });

    test("claimPresence refuses an entry owned by another node", async () => {
      const { store, driver } = makeDriver();
      const adapter = new RedisAdapter({ driver: driver as never });
      const key = "ocpp-ws-io:presence:CP001";
      store.set(key, "node-B");

      expect(await adapter.claimPresence("CP001", "node-A", 300)).toBe(false);
      expect(store.get(key)).toBe("node-B");

      expect(await adapter.claimPresence("CP001", "node-B", 300)).toBe(true);
      expect(store.get(key)).toBe("node-B");
    });

    test("falls back to read-then-write when the driver cannot run scripts", async () => {
      const { store, driver } = makeDriver();
      const { evalScript: _drop, ...noScript } = driver;
      const adapter = new RedisAdapter({ driver: noScript as never });
      const key = "ocpp-ws-io:presence:CP001";
      store.set(key, "node-B");

      expect(await adapter.removePresenceIfOwned("CP001", "node-A")).toBe(false);
      expect(store.get(key)).toBe("node-B");
      expect(await adapter.removePresenceIfOwned("CP001", "node-B")).toBe(true);
      expect(store.has(key)).toBe(false);
    });
  });
});
