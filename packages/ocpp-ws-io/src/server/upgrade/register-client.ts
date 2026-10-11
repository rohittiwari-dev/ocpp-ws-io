import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { LRUMap } from "../../core/lru-map.js";
import type { EventAdapterInterface } from "../../types/adapter.js";
import type { AuthAccept, ConnectionContext } from "../../types/auth.js";
import type { HandshakeInfo } from "../../types/handshake.js";
import type { LoggerLike } from "../../types/logger.js";
import type { OCPPPlugin } from "../../types/plugins.js";
import type { AnyOCPPProtocol } from "../../types/protocol.js";
import type { RouterConfig, ServerOptions } from "../../types/server.js";
import type { PersistedSession } from "../../types/session.js";
import type { AdaptiveLimiter } from "../adaptive-limiter.js";
import { guardPluginHook, reportPluginError } from "../plugin-hooks.js";
import { type PresenceContext, removePresenceFenced } from "../presence.js";
import type { AnyOCPPRouter } from "../router.js";
import { OCPPServerClient } from "../server-client.js";
import {
  type CachedSession,
  recordSessionActivity,
  type SessionCache,
} from "../sessions.js";
import type { WorkerPool } from "../worker-pool.js";
import { attachClientPlugins, buildClientOptions } from "./client-setup.js";

/** The server state client registration reads; the server reads it through getters. */
export interface RegistrationContext<P extends AnyOCPPProtocol> {
  readonly options: ServerOptions<P>;
  readonly logger: LoggerLike | null;
  readonly plugins: OCPPPlugin<P>[];
  readonly clients: Set<OCPPServerClient<P>>;
  readonly clientsByIdentity: Map<string, OCPPServerClient<P>>;
  readonly sessions: LRUMap<string, CachedSession>;
  readonly sessionCache: SessionCache;
  readonly adapter: EventAdapterInterface | null;
  readonly nodeId: string;
  readonly presence: PresenceContext;
  readonly adaptiveLimiter: AdaptiveLimiter | null;
  readonly workerPool: WorkerPool | null;
  /** Emit the server's "client" event. */
  emitClient(client: OCPPServerClient<P>): void;
}

/** A connection that has passed auth, with its socket upgraded. */
export interface AcceptedConnection {
  readonly ws: WebSocket;
  readonly req: IncomingMessage;
  readonly handshake: HandshakeInfo;
  /** The identity from the path; accept({ identity }) can replace it. */
  readonly identity: string;
  /** The matched routes' config(), merged. */
  readonly routeConfig: RouterConfig | undefined;
  /** The matched routers, which emit their own "client" event. */
  readonly routers: readonly AnyOCPPRouter[];
  /** The middleware context; its state seeds the session. */
  readonly ctx: ConnectionContext | undefined;
  /** What the auth callback passed to accept(). */
  readonly acceptOptions: AuthAccept | undefined;
  readonly selectedProtocol: string | undefined;
  /** The adapter's stored session, fetched before the upgrade. */
  readonly storedSession: PersistedSession | null;
  /** The store failed or timed out, so its copy must not be overwritten. */
  readonly storedSessionUnavailable: boolean;
}

/**
 * Make an accepted connection a client: build it with its session, evict a
 * stale connection with the same identity, register it and its presence,
 * and wire its close and message handling and the plugins.
 */
export function registerClient<P extends AnyOCPPProtocol>(
  server: RegistrationContext<P>,
  {
    ws,
    req,
    handshake,
    identity: requestedIdentity,
    routeConfig: matchedRouterConfig,
    routers: matchedRouters,
    ctx,
    acceptOptions,
    selectedProtocol,
    storedSession,
    storedSessionUnavailable,
  }: AcceptedConnection,
): void {
  let identity = requestedIdentity;
  const clientOptions = buildClientOptions<P>(
    identity,
    matchedRouterConfig,
    server.options,
  );

  // An auth callback may namespace the identity (multi-tenant servers where
  // the same station id appears under different path prefixes). Apply it
  // before anything keyed on identity — session lookup, _clientsByIdentity,
  // presence — so all of them agree.
  const overrideIdentity = (acceptOptions as AuthAccept | undefined)?.identity;
  if (overrideIdentity && overrideIdentity !== identity) {
    identity = overrideIdentity;
    handshake.identity = overrideIdentity;
  }

  // The stored copy replaces the LRU one rather than merging with it: this
  // node's copy can predate changes made while the charger was elsewhere.
  const finalSession = {
    ...(ctx?.state || {}),
    ...(storedSession ?? server.sessions.get(identity)?.data ?? {}),
    ...((acceptOptions as AuthAccept | undefined)?.session || {}),
  };

  const client = new OCPPServerClient(clientOptions, {
    ws,
    handshake,
    session: finalSession,
    protocol: selectedProtocol,
    adaptiveMultiplier: server.adaptiveLimiter
      ? () => server.adaptiveLimiter?.multiplier ?? 1
      : undefined,
    workerPool: server.workerPool ?? undefined,
    plugins: server.plugins,
  });

  if (storedSessionUnavailable) {
    // Don't overwrite what the unreachable store may hold with a local guess.
    server.sessions.set(identity, {
      data: client.session,
      lastActive: Date.now(),
    });
  } else {
    recordSessionActivity(
      server.sessionCache,
      server.adapter,
      identity,
      client.session,
      true,
    );
  }

  // ── Duplicate Identity Eviction ──
  // If a client with the same identity is already connected (e.g. 4G reconnect
  // racing the old TCP FIN), evict the stale socket to prevent phantom broadcasts
  // and memory leaks from zombie connections.
  const existingClient = server.clientsByIdentity.get(identity);
  if (existingClient && existingClient !== client) {
    server.logger?.warn?.("Evicting stale connection for identity", {
      identity,
      reason: "Duplicate identity replaced by new connection",
    });
    // Plugin: onEviction
    for (const plugin of server.plugins) {
      try {
        guardPluginHook(
          server.logger,
          plugin.onEviction?.(existingClient, client),
          plugin.name,
          "onEviction",
        );
      } catch (err) {
        reportPluginError(server.logger, plugin.name, "onEviction", err);
      }
    }
    // Fire-and-forget force close — don't await, don't block the new connection
    existingClient
      .close({
        code: 4000,
        reason: "Evicted by new connection",
        force: true,
      })
      .catch(() => {});
    // Immediately remove from tracking to prevent race
    server.clients.delete(existingClient);
  }

  server.clients.add(client);
  server.clientsByIdentity.set(identity, client);

  // Register presence (TTL refreshed by the presence heartbeat — see
  // startPresenceRefresh).
  if (server.adapter?.setPresence) {
    const ttlSec = server.options.presenceTtlSeconds ?? 300;
    server.adapter.setPresence(identity, server.nodeId, ttlSec).catch((err) => {
      server.logger?.error?.("Error setting presence", {
        identity,
        error: err,
      });
    });
  }

  server.logger?.info?.("Client connected", {
    identity,
    remoteAddress: req.socket.remoteAddress,
    protocol: selectedProtocol,
  });

  client.on("close", ({ code, reason }: { code: number; reason: string }) => {
    server.clients.delete(client);
    if (server.clientsByIdentity.get(identity) === client) {
      server.clientsByIdentity.delete(identity);
      // Message-driven writes are debounced, so flush the final state
      // for whichever node the charger reconnects to next.
      recordSessionActivity(
        server.sessionCache,
        server.adapter,
        identity,
        client.session,
        true,
      );
      // Remove presence — only when this socket still owns the
      // identity. The local check above catches an evicted duplicate on
      // THIS node; the fenced delete below catches the cross-node case,
      // where the charger has already reconnected elsewhere and that
      // node owns the registry entry. An unconditional DEL here wiped
      // the new owner's entry and left the charger unroutable until the
      // next heartbeat.
      removePresenceFenced(server.presence, identity);
    }
    // Plugin: onDisconnect
    for (const plugin of server.plugins) {
      try {
        guardPluginHook(
          server.logger,
          plugin.onDisconnect?.(client, code, reason),
          plugin.name,
          "onDisconnect",
        );
      } catch (err) {
        server.logger?.error?.("Plugin onDisconnect error", {
          name: plugin.name,
          error: (err as Error).message,
        });
      }
    }
    server.logger?.info?.("Client disconnected", { identity });
  });

  attachClientPlugins(client, server.plugins, () => server.logger);

  // Dispatch route-specific "client" events
  server.emitClient(client);
  for (const router of matchedRouters) {
    router._emitClient(client);
  }

  client.on("message", () => {
    recordSessionActivity(
      server.sessionCache,
      server.adapter,
      identity,
      client.session,
    );
  });
}
