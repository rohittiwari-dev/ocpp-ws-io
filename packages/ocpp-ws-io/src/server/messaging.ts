import { type RPCError, TimeoutError } from "../core/errors.js";
import { unchecked } from "../core/unchecked.js";
import { createId, createRPCError } from "../core/util.js";
import type { EventAdapterInterface } from "../types/adapter.js";
import type { CallOptions } from "../types/calls.js";
import type { BroadcastResult } from "../types/events.js";
import type { BatchCall } from "../types/exact-keys.js";
import type {
  SendToClientArgs,
  VersionNamedSendArgs,
} from "../types/handlers.js";
import type { JsonObject } from "../types/json.js";
import type { LoggerLike } from "../types/logger.js";
import type { AnyOCPPProtocol, KnownProtocol } from "../types/protocol.js";
import {
  canRoutePresence,
  lookupPresence,
  type PresenceContext,
  removePresenceFenced,
} from "./presence.js";
import type { OCPPServerClient } from "./server-client.js";

// Calls and messages to clients by identity: to a client on this node
// directly, to one on another node through the adapter and back, broadcasts,
// and the cluster messages other nodes send this one.

/** A call routed to another node, waiting for its result. */
export interface PendingRemoteCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Node this call was routed to; only it may answer. */
  targetNode?: string;
}

/** The server state routing works on; the server reads it through getters. */
export interface MessagingContext<P extends AnyOCPPProtocol> {
  readonly presence: PresenceContext;
  readonly nodeId: string;
  readonly adapter: EventAdapterInterface | null;
  readonly logger: LoggerLike | null;
  readonly clients: Set<OCPPServerClient<P>>;
  readonly clientsByIdentity: Map<string, OCPPServerClient<P>>;
  /** Pending cross-node RPC calls awaiting a correlated response. */
  readonly pendingRemoteCalls: Map<string, PendingRemoteCall>;
  readonly callTimeoutMs: number | undefined;
  readonly remoteCallGraceMs: number | undefined;
  /** Whether a node still advertises itself (the server's cached check). */
  isNodeAlive(nodeId: string): Promise<boolean>;
}

/** A version-named call has its action, a string, where the other has params. */
function isVersionNamed(args: SendToClientArgs): args is VersionNamedSendArgs {
  return typeof args[2] === "string";
}

/** The parts of sendToClient's arguments, whichever form they take. */
function parseSendToClientArgs(args: SendToClientArgs): {
  identity: string;
  version?: string;
  method: string;
  params?: object;
  options?: CallOptions;
} {
  if (isVersionNamed(args)) {
    const [identity, version, method, params, options] = args;
    return { identity, version, method, params, options };
  }
  const [identity, method, params, options] = args;
  return { identity, method, params, options };
}

/** Extra wait on top of the call timeout to absorb cross-node transit. */
/**
 * Default grace added to callTimeoutMs for a cross-node call. Covers a
 * ROUND TRIP through the adapter (request out, result back), not one hop —
 * the shipped Redis adapter can take ~1s per direction. Overridable via
 * ServerOptions.remoteCallGraceMs.
 */
const REMOTE_RESPONSE_GRACE_MS = 2000;

/** sendToClient, for its arguments in either form. */
export async function routeCall<P extends AnyOCPPProtocol>(
  ctx: MessagingContext<P>,
  args: SendToClientArgs,
): Promise<unknown> {
  const { identity, version, method, params, options } =
    parseSendToClientArgs(args);

  // 1. Check local (O(1) identity lookup)
  const localClient = ctx.clientsByIdentity.get(identity);
  if (localClient) {
    // Forward the version when provided so the call resolves against the
    // version-specific overload (and version-aware strict validation).
    // The arguments were checked by the overloads above; here the method
    // is a string.
    return version
      ? await localClient.call(
          version as P,
          unchecked(method),
          params as object,
          options,
        )
      : await localClient.call(unchecked(method), params as object, options);
  }

  // 2. Check Registry & Unicast (with response correlation — report H1)
  if (canRoutePresence(ctx.presence)) {
    const nodeId = await lookupPresence(ctx.presence, identity);
    if (nodeId && !(await ctx.isNodeAlive(nodeId))) {
      // The owning node is gone. Its entry would otherwise linger for the
      // full TTL and every call to this charger would wait out the timeout.
      ctx.logger?.warn?.("Owning node is no longer alive — clearing entry", {
        identity,
        nodeId,
      });
      removePresenceFenced(ctx.presence, identity, nodeId);
      throw new Error(`Client ${identity} not found`);
    }
    if (nodeId) {
      const correlationId = createId();
      const timeoutMs =
        (options?.timeoutMs ?? ctx.callTimeoutMs ?? 30_000) +
        (ctx.remoteCallGraceMs ?? REMOTE_RESPONSE_GRACE_MS);

      const resultPromise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          ctx.pendingRemoteCalls.delete(correlationId);
          reject(
            new TimeoutError(
              `Remote call to "${identity}" via node ${nodeId} timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        ctx.pendingRemoteCalls.set(correlationId, {
          resolve,
          reject,
          timer,
          // Recorded so the result leg can reject a reply that did not come
          // from the node we actually asked.
          targetNode: nodeId,
        });
      });

      // Carry `version` across the cluster so the receiving node can
      // resolve the same version-specific overload.
      //
      // The publish is deliberately NOT awaited before resultPromise. An
      // adapter whose publish() hangs rather than rejecting — a black-holed
      // Redis connection with no socket timeout — would otherwise park us on
      // that await while resultPromise's timer fires with nobody observing
      // it: an unhandled rejection (fatal on Node by default) and a caller
      // promise pending forever. Awaiting the result instead means the
      // timeout is always observed, whatever the transport does.
      ctx.adapter
        ?.publish(`ocpp:node:${nodeId}`, {
          source: ctx.nodeId,
          target: identity,
          version,
          method,
          params,
          options,
          correlationId,
        })
        .catch((err) => {
          // Publish failed (adapter down) — settle the pending call so
          // nothing leaks and the caller sees the transport error rather
          // than waiting out the full timeout.
          const pending = ctx.pendingRemoteCalls.get(correlationId);
          if (pending) {
            clearTimeout(pending.timer);
            ctx.pendingRemoteCalls.delete(correlationId);
            pending.reject(err);
          }
        });

      return await resultPromise;
    }
  }

  // 3. Fallback to Broadcast (if configured/needed)
  // For now, we only broadcast if explicitly called via .broadcast()
  // But if we want comprehensive routing, we could broadcast here.
  // Ideally, sendToClient implies targeted. If not found, we throw or return false.
  throw new Error(`Client ${identity} not found`);
}

/** routeCall, logging and swallowing a failure: undefined when the call failed. */
export async function safeRouteCall<P extends AnyOCPPProtocol>(
  ctx: MessagingContext<P>,
  args: SendToClientArgs,
): Promise<unknown> {
  try {
    return await routeCall(ctx, args);
  } catch (error) {
    if (
      ctx.logger &&
      typeof ctx.logger.warn === "function" &&
      (error as Error).name !== "TimeoutError"
    ) {
      ctx.logger.warn("SafeSendToClient failed", {
        identity: args[0],
        method: parseSendToClientArgs(args).method,
        error,
      });
    }
    return undefined;
  }
}

/** sendBatch: concurrent calls to one client, local or on another node. */
export async function sendBatchToClient<P extends AnyOCPPProtocol>(
  ctx: MessagingContext<P>,
  identity: string,
  calls: readonly BatchCall<KnownProtocol<P>>[],
): Promise<Array<unknown | undefined>> {
  if (calls.length === 0) return [];

  const client = ctx.clientsByIdentity.get(identity);
  if (!client) {
    // Not on this node. This used to return an array of `undefined` with a
    // "future enhancement" note, which is indistinguishable from "every call
    // failed" — so in a cluster sendBatch silently did nothing for any
    // charger that happened to live on another node.
    //
    // Route each call through sendToClient, which owns the cross-node path.
    // The local fast path below pipelines through callImmediate; a remote
    // batch cannot, but these calls are already crossing the network, so the
    // per-call cost is dominated by transport either way.
    if (canRoutePresence(ctx.presence)) {
      ctx.logger?.debug?.("sendBatch: routing cross-node", { identity });
      const remote = await Promise.allSettled(
        calls.map((c) =>
          routeCall(ctx, [identity, unchecked(c.method), c.params, c.options]),
        ),
      );
      return remote.map((r) => {
        if (r.status === "fulfilled") return r.value;
        ctx.logger?.warn?.("sendBatch: remote call failed", {
          identity,
          error: (r.reason as Error)?.message,
        });
        return undefined;
      });
    }

    ctx.logger?.warn?.("sendBatch: client not found locally", {
      identity,
    });
    return calls.map(() => undefined);
  }

  // Bypass the call queue so the batch pipelines in parallel without
  // mutating the client's configured callConcurrency (report M9).
  const results = await Promise.allSettled(
    calls.map((c) =>
      client.callImmediate(unchecked(c.method), c.params, c.options ?? {}),
    ),
  );

  return results.map((r) => {
    if (r.status === "fulfilled") return r.value;
    ctx.logger?.warn?.("sendBatch: individual call failed", {
      identity,
      error: (r.reason as Error)?.message,
    });
    return undefined;
  });
}

/** broadcast: every local client, and every other node through the adapter. */
export async function broadcastToAll<P extends AnyOCPPProtocol>(
  ctx: MessagingContext<P>,
  method: string,
  params?: object,
): Promise<BroadcastResult> {
  // Every local failure used to be swallowed by `.catch(() => {})` behind a
  // `Promise<void>`, so a caller could not tell a clean fan-out from one
  // where every charger rejected. The result reports what is knowable.
  const targets = Array.from(ctx.clients);
  const settled = await Promise.allSettled(
    targets.map((client) => client.call(unchecked(method), params)),
  );

  const localFailed: Array<{ identity: string; error: string }> = [];
  let localDelivered = 0;
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") localDelivered++;
    else
      localFailed.push({
        identity: targets[i]?.identity ?? "unknown",
        error: (r.reason as Error)?.message ?? String(r.reason),
      });
  });

  let remotePublished = false;
  if (ctx.adapter) {
    try {
      await ctx.adapter.publish("ocpp:broadcast", {
        source: ctx.nodeId,
        method,
        params,
      });
      remotePublished = true;
    } catch (err) {
      ctx.logger?.error?.("Broadcast publish failed", { error: err });
    }
  }

  return { localDelivered, localFailed, remotePublished };
}

/** broadcastBatch: the given identities, local ones directly, the rest through their nodes. */
export async function broadcastToIdentities<P extends AnyOCPPProtocol>(
  ctx: MessagingContext<P>,
  identities: string[],
  method: string,
  params?: object,
  options?: CallOptions,
): Promise<void> {
  const localIdentities = new Set<string>();
  const localPromises: Promise<JsonObject | undefined>[] = [];

  // 1. Send to local clients immediately (O(1) lookup via _clientsByIdentity)
  for (const identity of identities) {
    const client = ctx.clientsByIdentity.get(identity);
    if (client) {
      localIdentities.add(identity);
      localPromises.push(
        client.call(unchecked(method), params, options).catch(() => undefined),
      );
    }
  }

  // 2. Resolve remote clients
  const remoteIdentities = identities.filter((id) => !localIdentities.has(id));

  if (remoteIdentities.length > 0 && ctx.adapter) {
    // 2a. Fetch presence in batch
    let presences: (string | null)[] = [];
    if (ctx.adapter.getPresenceBatch) {
      presences = await ctx.adapter.getPresenceBatch(remoteIdentities);
    } else if (ctx.adapter.getPresence) {
      presences = await Promise.all(
        remoteIdentities.map((id) => ctx.adapter!.getPresence!(id)),
      );
    }

    // 2b. Prepare batch messages payload
    const batchMessages: { channel: string; data: unknown }[] = [];

    for (let i = 0; i < remoteIdentities.length; i++) {
      const nodeId = presences[i];
      if (nodeId) {
        batchMessages.push({
          channel: `ocpp:node:${nodeId}`,
          data: {
            source: ctx.nodeId,
            target: remoteIdentities[i],
            method,
            params,
            options,
          },
        });
      }
    }

    // 2c. Publish in batch via adapter
    if (batchMessages.length > 0) {
      if (ctx.adapter.publishBatch) {
        await ctx.adapter.publishBatch(batchMessages);
      } else {
        await Promise.all(
          batchMessages.map((bm) => ctx.adapter!.publish(bm.channel, bm.data)),
        );
      }
    }
  }

  await Promise.all(localPromises);
}

/** A broadcast published by another node: delivered to every local client. */
export function handleBroadcastMessage<P extends AnyOCPPProtocol>(
  ctx: MessagingContext<P>,
  msg: unknown,
): void {
  try {
    if (!msg || typeof msg !== "object") return;
    const payload = msg as {
      source: string;
      method: string;
      params: unknown;
    };

    if (payload.source === ctx.nodeId) return;

    // The method comes from another node, as a string: not checked by type.
    for (const client of ctx.clients) {
      client
        .call(unchecked(payload.method), payload.params as object)
        .catch(() => {});
    }
  } catch (err) {
    ctx.logger?.error?.("Error processing broadcast message", {
      error: (err as Error).message,
    });
  }
}

/**
 * A message on this node's channel: the result of a call this node routed,
 * or a call another node routes to one of this node's clients.
 */
export function handleUnicastMessage<P extends AnyOCPPProtocol>(
  ctx: MessagingContext<P>,
  msg: unknown,
): void {
  try {
    if (!msg || typeof msg !== "object") return;

    // Response leg: a remote node answering one of our calls
    const asResponse = msg as {
      __type?: string;
      correlationId?: string;
      source?: string;
      ok?: boolean;
      result?: unknown;
      error?: {
        code?: string;
        name?: string;
        message?: string;
        details?: Record<string, unknown>;
      };
    };
    if (asResponse.__type === "callResult" && asResponse.correlationId) {
      const pending = ctx.pendingRemoteCalls.get(asResponse.correlationId);
      if (!pending) return; // late or duplicate response

      // Only the node we asked may answer. Correlation ids are unguessable,
      // so this is a consistency check rather than a security boundary — but
      // a mis-routed or replayed frame settling an unrelated call is exactly
      // the kind of bug that is impossible to diagnose after the fact.
      if (
        pending.targetNode &&
        asResponse.source &&
        asResponse.source !== pending.targetNode
      ) {
        ctx.logger?.warn?.("Discarding cross-node result from another node", {
          expected: pending.targetNode,
          received: asResponse.source,
        });
        return;
      }

      ctx.pendingRemoteCalls.delete(asResponse.correlationId);
      clearTimeout(pending.timer);
      if (asResponse.ok) {
        pending.resolve(asResponse.result);
      } else {
        // ── #4: preserve the error's identity across the cluster ──
        // The remote leg reports rpcErrorCode, which a TimeoutError does not
        // have, so every remote timeout used to arrive as a GenericError.
        // A caller could not write `catch (e) { if (e instanceof TimeoutError) }`
        // and have it behave the same locally and cross-node.
        if (asResponse.error?.name === "TimeoutError") {
          pending.reject(
            new TimeoutError(
              asResponse.error.message ?? "Remote call timed out",
            ),
          );
        } else {
          pending.reject(
            createRPCError(
              asResponse.error?.code ?? "GenericError",
              asResponse.error?.message,
              asResponse.error?.details ?? {},
            ),
          );
        }
      }
      return;
    }

    // Request leg: deliver to a locally connected client
    const payload = msg as {
      source: string;
      target: string;
      version?: string;
      method: string;
      params: unknown;
      options?: CallOptions;
      correlationId?: string;
    };

    const client = ctx.clientsByIdentity.get(payload.target);
    if (client) {
      // Forward the version when present so the call resolves against the
      // version-specific overload, matching local sendToClient behavior.
      // The method comes from another node, as a string: not checked by type.
      const delivery = payload.version
        ? client.call(
            payload.version as P,
            unchecked(payload.method),
            payload.params as object,
            payload.options,
          )
        : client.call(
            unchecked(payload.method),
            payload.params as object,
            payload.options,
          );
      delivery.then(
        (result) => {
          publishRemoteResult(ctx, payload, { ok: true, result });
        },
        (err) => {
          publishRemoteResult(ctx, payload, {
            ok: false,
            error: {
              code: (err as Partial<RPCError>)?.rpcErrorCode ?? "GenericError",
              // Carried so the origin can rebuild the same error class it
              // would have thrown for a local call.
              name: (err as Error)?.name,
              message: (err as Error)?.message ?? "",
              details: (err as Partial<RPCError>)?.details ?? {},
            },
          });
          if ((err as Error).name !== "TimeoutError") {
            ctx.logger?.error?.("Error delivering unicast to client", {
              identity: payload.target,
              error: err,
            });
          }
        },
      );
      return;
    }

    // Unknown target — the registry is stale. Tell the caller immediately
    // instead of letting it time out, and clean up the stale entry.
    ctx.logger?.warn?.("Received unicast for unknown client", {
      target: payload.target,
    });
    publishRemoteResult(ctx, payload, {
      ok: false,
      error: {
        code: "GenericError",
        message: `Client ${payload.target} not found on node ${ctx.nodeId}`,
      },
    });
    // Fenced: the entry may already name a different node (the charger
    // migrated while this message sat in the stream). Deleting it
    // unconditionally disconnected a live client from cross-node routing.
    removePresenceFenced(ctx.presence, payload.target);
  } catch (err) {
    ctx.logger?.error?.("Error processing unicast", {
      error: (err as Error).message,
    });
  }
}

/** Publish the result of a remotely requested call back to the origin node. */
export function publishRemoteResult<P extends AnyOCPPProtocol>(
  ctx: MessagingContext<P>,
  request: { source?: string; correlationId?: string },
  body: {
    ok: boolean;
    result?: unknown;
    error?: {
      code?: string;
      name?: string;
      message?: string;
      details?: Record<string, unknown>;
    };
  },
): void {
  if (!request.correlationId || !request.source || !ctx.adapter) return;
  ctx.adapter
    .publish(`ocpp:node:${request.source}`, {
      __type: "callResult",
      correlationId: request.correlationId,
      // Identifies the answering node so the origin can confirm the reply
      // came from the node it actually asked.
      source: ctx.nodeId,
      ...body,
    })
    .catch((err) => {
      ctx.logger?.error?.("Failed to publish remote call result", {
        error: err,
      });
    });
}
