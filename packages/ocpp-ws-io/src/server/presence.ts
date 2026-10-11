import type { EventAdapterInterface } from "../types/adapter.js";
import type { LoggerLike } from "../types/logger.js";

// Cluster presence: which node owns each identity, this node's own liveness
// entry, the heartbeat that keeps both alive, and the cache of other nodes'
// liveness.

/** The server state presence works on; the server reads and writes it through getters. */
export interface PresenceContext {
  readonly nodeId: string;
  readonly adapter: EventAdapterInterface | null;
  readonly logger: LoggerLike | null;
  /** Short-lived cache of remote node liveness, so the check is not per-call. */
  readonly nodeLiveness: Map<string, { alive: boolean; at: number }>;
  /** Nodes observed advertising liveness; only these can be judged dead. */
  readonly nodeLivenessSeen: Set<string>;
  /** In-flight adapter writes, awaited by close() before disconnecting. */
  readonly pendingWrites: Set<Promise<unknown>>;
  readonly presenceTtlSeconds: number | undefined;
  /** Whether the server is listening; the heartbeat stops when it is not. */
  readonly isOpen: boolean;
  presenceInterval: ReturnType<typeof setTimeout> | null;
  /** Guards against overlapping presence refreshes when one runs long. */
  refreshInFlight: boolean;
  /** The identities of this node's own clients. */
  localIdentities(): string[];
}

const NODE_LIVENESS_TTL_MS = 5000;

/** Registry key under which a node advertises that it is alive. */
export function nodeKey(nodeId: string): string {
  return `__node__:${nodeId}`;
}

/**
 * Which node currently owns `identity`, or null.
 *
 * `getPresence` and `getPresenceBatch` are both optional, and the routing
 * path only ever called the former — so an adapter that implemented only the
 * batch variant reported no owner for anybody and cross-node routing silently
 * did nothing.
 */
export async function lookupPresence(
  ctx: PresenceContext,
  identity: string,
): Promise<string | null> {
  const adapter = ctx.adapter;
  if (!adapter) return null;
  if (adapter.getPresence) {
    return (await adapter.getPresence(identity)) ?? null;
  }
  if (adapter.getPresenceBatch) {
    const [owner] = await adapter.getPresenceBatch([identity]);
    return owner ?? null;
  }
  return null;
}

/**
 * Whether `nodeId` is still advertising itself.
 *
 * A crashed node leaves its clients in the registry for the full TTL — five
 * minutes at the default — and every cross-node call aimed at them waited out
 * callTimeoutMs plus the grace before failing, because nothing noticed the
 * owner was gone. Checking liveness turns that into an immediate
 * "not connected".
 *
 * Answers are cached briefly so this costs one extra registry read per node
 * per few seconds, not one per call.
 */
export async function isNodeAlive(
  ctx: PresenceContext,
  nodeId: string,
): Promise<boolean> {
  if (nodeId === ctx.nodeId) return true;
  const cached = ctx.nodeLiveness.get(nodeId);
  const now = Date.now();
  if (cached && now - cached.at < NODE_LIVENESS_TTL_MS) {
    return cached.alive;
  }
  let alive = true;
  try {
    const seen = await lookupPresence(ctx, nodeKey(nodeId));
    if (seen !== null) {
      alive = true;
      // Remember that this node advertises itself, so a later absence is
      // meaningful rather than ambiguous.
      ctx.nodeLivenessSeen.add(nodeId);
    } else {
      // Fail safe. A missing entry is only evidence of death for a node we
      // have previously watched advertise itself; otherwise it may simply be
      // running a build that does not publish liveness, or one whose first
      // heartbeat has not landed. Declaring those dead would break routing
      // across a mixed-version cluster.
      alive = !ctx.nodeLivenessSeen.has(nodeId);
    }
  } catch {
    // A registry hiccup must not make every node look dead.
    alive = true;
  }
  ctx.nodeLiveness.set(nodeId, { alive, at: now });
  return alive;
}

/** True when this adapter can resolve owners at all. */
export function canRoutePresence(ctx: PresenceContext): boolean {
  return !!(ctx.adapter?.getPresence || ctx.adapter?.getPresenceBatch);
}

/**
 * Delete this identity's presence entry, but only if the registry still
 * names this node. Falls back to an unconditional delete for adapters that
 * do not implement fencing.
 */
export function removePresenceFenced(
  ctx: PresenceContext,
  identity: string,
  /**
   * The node the entry must still name for the delete to happen. Defaults to
   * this node — the normal case, a client of ours going away. Garbage
   * collecting a dead node's entry passes that node's id instead, so the
   * delete is still fenced: if the charger has meanwhile reconnected
   * elsewhere, the new owner's entry survives.
   */
  expectedOwner: string = ctx.nodeId,
): void {
  const adapter = ctx.adapter;
  if (!adapter) return;
  const raw = adapter.removePresenceIfOwned
    ? adapter.removePresenceIfOwned(identity, expectedOwner)
    : adapter.removePresence?.(identity);
  if (!raw) return;
  const done = Promise.resolve(raw);

  // Tracked so close() can wait. These fire from each client's close handler,
  // which close() does not await, so disconnecting the adapter straight
  // afterwards raced them: the DELs were dropped and this node's clients
  // stayed in the registry for the full TTL, with every cross-node call to
  // them routed at a server that no longer exists.
  const tracked: Promise<unknown> = done
    .catch((err: unknown) => {
      ctx.logger?.error?.("Error removing presence", {
        identity,
        error: err,
      });
    })
    .finally(() => {
      ctx.pendingWrites.delete(tracked);
    });
  ctx.pendingWrites.add(tracked);
}

export function stopPresenceRefresh(ctx: PresenceContext): void {
  if (ctx.presenceInterval) {
    clearTimeout(ctx.presenceInterval);
    ctx.presenceInterval = null;
  }
}

export function startPresenceRefresh(ctx: PresenceContext): void {
  if (ctx.presenceInterval || !ctx.adapter?.setPresence) return;
  const ttlSec = ctx.presenceTtlSeconds ?? 300;

  // Refresh three times per TTL, not twice.
  //
  // At TTL/2 a single slow or skipped tick puts the next write at exactly the
  // expiry instant — zero margin, and every connection on this node silently
  // drops out of cluster routing. TTL/3 survives one lost cycle.
  const baseMs = Math.max(250, (ttlSec * 1000) / 3);

  // Jitter each tick by ±10%. Nodes started together by an orchestrator would
  // otherwise refresh in lockstep, hammering the registry in synchronised
  // bursts (and, with large fleets, a single burst can exceed the TTL).
  const nextDelay = () => baseMs * (0.9 + Math.random() * 0.2);

  const tick = () => {
    // Overlap guard: a refresh slower than the interval would otherwise stack
    // up, and each stacked run re-reads and re-writes every identity.
    if (ctx.refreshInFlight) {
      ctx.logger?.warn?.(
        "Presence refresh still running when the next tick fired — skipping",
      );
    } else {
      ctx.refreshInFlight = true;
      refreshPresence(ctx, ttlSec)
        .catch((err) => {
          ctx.logger?.warn?.("Presence refresh failed", { error: err });
        })
        .finally(() => {
          ctx.refreshInFlight = false;
        });
    }
    schedule();
  };

  const schedule = () => {
    if (!ctx.isOpen) return;
    ctx.presenceInterval = setTimeout(tick, nextDelay());
    ctx.presenceInterval.unref();
  };

  schedule();
}

export async function refreshPresence(
  ctx: PresenceContext,
  ttlSec: number,
): Promise<void> {
  const adapter = ctx.adapter;
  if (!adapter) return;

  // Advertise this node's own liveness on the same cadence and TTL as the
  // client entries. Reusing the presence API means no adapter has to grow a
  // method for it. Consumed by _isNodeAlive() below.
  if (adapter.setPresence) {
    // Promise.resolve(): the interface declares Promise<void>, but an adapter
    // that returns nothing must not crash the heartbeat.
    await Promise.resolve(
      adapter.setPresence(nodeKey(ctx.nodeId), ctx.nodeId, ttlSec),
    ).catch(() => {});
  }
  let identities = ctx.localIdentities();
  if (identities.length === 0) return;

  // Do not re-claim identities another node owns.
  //
  // This loop used to write `nodeId = us` for every local identity
  // unconditionally. A node holding a half-open socket — peer gone, no FIN
  // received — still lists that identity, so it kept stealing the entry back
  // from the node actually serving the charger, and routing flapped on every
  // heartbeat until the dead socket was reaped.
  //
  // `claimPresence` is the atomic version and is used when the set is small
  // enough that per-identity round-trips are affordable. Above that the batch
  // path stays, filtered by one bulk read: still a read-then-write race, but
  // a foreign owner is now detected instead of trampled, so a zombie node
  // backs off consistently rather than flapping.
  const foreign: string[] = [];

  const warnForeign = () => {
    if (foreign.length === 0) return;
    ctx.logger?.warn?.(
      "Presence held by another node — local socket is stale",
      { identities: foreign.slice(0, 20), count: foreign.length },
    );
  };

  // No batch write available, but atomic claim is: use it. Preferring this
  // over setPresenceBatch would turn one pipelined round-trip into N, which
  // is the wrong trade at 100k connections.
  if (!adapter.setPresenceBatch && adapter.claimPresence) {
    const results = await Promise.all(
      identities.map((identity) =>
        adapter.claimPresence!(identity, ctx.nodeId, ttlSec)
          .then((ok) => (ok ? null : identity))
          .catch(() => null),
      ),
    );
    foreign.push(...results.filter((x): x is string => x !== null));
    warnForeign();
    return;
  }

  // Chunk every bulk registry call. At the 100k connections this library
  // advertises, an unchunked refresh is one 100k-key MGET and one
  // 100k-command pipeline per cycle — enough to stall the Redis event loop
  // for everyone else on the instance.
  const CHUNK = 1000;
  const chunk = <T>(xs: T[]): T[][] => {
    if (xs.length <= CHUNK) return [xs];
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
    return out;
  };

  if (adapter.getPresenceBatch) {
    const owners: (string | null)[] = [];
    for (const part of chunk(identities)) {
      owners.push(...(await adapter.getPresenceBatch(part)));
    }
    const mine: string[] = [];
    identities.forEach((identity, i) => {
      const owner = owners[i];
      if (owner === null || owner === undefined || owner === ctx.nodeId) {
        mine.push(identity);
      } else {
        foreign.push(identity);
      }
    });
    warnForeign();
    identities = mine;
    if (identities.length === 0) return;
  }

  if (adapter.setPresenceBatch) {
    for (const part of chunk(identities)) {
      await adapter.setPresenceBatch(
        part.map((identity) => ({
          identity,
          nodeId: ctx.nodeId,
          ttl: ttlSec,
        })),
      );
    }
  } else if (adapter.setPresence) {
    await Promise.all(
      identities.map((identity) =>
        adapter.setPresence!(identity, ctx.nodeId, ttlSec),
      ),
    );
  }
}

/**
 * Drop cached node-liveness answers that are far past their TTL.
 *
 * `_nodeLiveness` is keyed by node id and was only ever written to. Node ids
 * are per-process, so a cluster doing rolling deploys mints new ones on every
 * release and the map grew for the life of the process. `_nodeLivenessSeen`
 * is deliberately left alone — it records that a node once advertised itself,
 * which is what makes a later absence mean "dead" rather than "old build",
 * and forgetting it would make routing flap across a mixed-version cluster.
 */
export function sweepNodeLiveness(ctx: PresenceContext, now: number): void {
  const maxAge = NODE_LIVENESS_TTL_MS * 60;
  for (const [nodeId, entry] of ctx.nodeLiveness) {
    if (now - entry.at > maxAge) ctx.nodeLiveness.delete(nodeId);
  }
}
