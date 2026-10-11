import { safeDecodeURIComponent } from "../../core/util.js";
import type { AuthCallback, ConnectionMiddleware } from "../../types/auth.js";
import type { LoggerLike } from "../../types/logger.js";
import type { RouterConfig } from "../../types/server.js";
import type { RadixTrie } from "../radix-trie.js";
import type { AnyOCPPRouter } from "../router.js";

/** The server's routers, in the order a request path is tried against them. */
export interface RouteTable {
  /** Routers added with server.use() and no pattern; they match every path. */
  readonly globalRouters: readonly AnyOCPPRouter[];
  /** String patterns, matched in O(k) for k path segments. */
  readonly trie: RadixTrie;
  /** Routers with RegExp patterns, scanned one by one after the trie. */
  readonly regexRouters: readonly AnyOCPPRouter[];
}

/** What a request path matched. */
export interface RouteMatch {
  /** A matched route's own auth callback, or else the global one. */
  readonly authCallback: AuthCallback | undefined;
  /** Every matched router's middleware, global routers first. */
  readonly middlewares: ConnectionMiddleware[];
  readonly routers: AnyOCPPRouter[];
  readonly params: Record<string, string>;
  /** A pattern route matched, not only the global routers. */
  readonly hasTerminalRoute: boolean;
  /** Pattern routes exist, so a path none of them matches is unknown. */
  readonly hasPatternRouters: boolean;
  /** The matched routes' config(), merged in match order. */
  readonly config: RouterConfig | undefined;
}

/** Match a request path: the global routers, then the trie, then the RegExp routes. */
export function matchRoute(
  routes: RouteTable,
  pathname: string,
  logger: LoggerLike | null,
): RouteMatch {
  let matchedHandler: AuthCallback | undefined;
  const matchedMiddlewares: ConnectionMiddleware[] = [];
  const matchedRouters: AnyOCPPRouter[] = [];
  const params: Record<string, string> = {};

  let hasTerminalRoute = false;
  const hasPatternRouters =
    routes.trie.size > 0 || routes.regexRouters.length > 0;
  let matchedRouterConfig: RouterConfig | undefined;

  // ── Freeze trie on first match for V8 JIT optimization ──
  if (!routes.trie.frozen && routes.trie.size > 0) {
    routes.trie.freeze();
  }

  // 1. Global middleware routers — always match (catch-all)
  //
  // Their auth callback is held separately: the collection order below is
  // global -> trie -> regex, and a first-wins `matchedHandler` meant a global
  // auth latched before the trie was even consulted, silently discarding
  // every route-specific auth callback. Specificity wins now — a route's own
  // auth beats the catch-all, and the global one is used only when no matched
  // route defines its own.
  let globalHandler: AuthCallback | undefined;
  for (const router of routes.globalRouters) {
    matchedRouters.push(router);
    if (router.middlewares.length > 0) {
      matchedMiddlewares.push(...router.middlewares);
    }
    if (router.authCallback && !globalHandler) {
      globalHandler = router.authCallback as AuthCallback | undefined;
    }
  }

  // 2. Radix Trie lookup — O(k) where k = path segments
  const trieResult = routes.trie.match(pathname);
  if (trieResult) {
    Object.assign(params, trieResult.params);
    for (const router of trieResult.routers) {
      matchedRouters.push(router);
      hasTerminalRoute = true;
      if (router._routeConfig) {
        matchedRouterConfig = Object.assign(
          matchedRouterConfig || {},
          router._routeConfig,
        );
      }
      if (router.middlewares.length > 0) {
        matchedMiddlewares.push(...router.middlewares);
      }
      if (router.authCallback && !matchedHandler) {
        matchedHandler = router.authCallback as AuthCallback | undefined;
      }
    }
  }

  // 3. RegExp fallback — linear scan only for routers with RegExp patterns
  for (const router of routes.regexRouters) {
    for (const compiled of router._regexPatterns) {
      const match = compiled.regex.exec(pathname);
      if (match) {
        matchedRouters.push(router);
        hasTerminalRoute = true;
        if (match.groups) {
          for (const [key, val] of Object.entries(match.groups)) {
            params[key] = safeDecodeURIComponent(val ?? "");
          }
        }
        if (router._routeConfig) {
          matchedRouterConfig = Object.assign(
            matchedRouterConfig || {},
            router._routeConfig,
          );
        }
        if (router.middlewares.length > 0) {
          matchedMiddlewares.push(...router.middlewares);
        }
        if (router.authCallback && !matchedHandler) {
          matchedHandler = router.authCallback as AuthCallback | undefined;
        }
        break; // Stop checking patterns within this single router
      }
    }
  }

  // Fall back to the catch-all auth only when no matched route defined one.
  if (!matchedHandler && globalHandler) {
    matchedHandler = globalHandler;
  } else if (matchedHandler && globalHandler) {
    logger?.debug?.("Route-specific auth takes precedence over global auth", {
      pathname,
    });
  }

  return {
    authCallback: matchedHandler,
    middlewares: matchedMiddlewares,
    routers: matchedRouters,
    params,
    hasTerminalRoute,
    hasPatternRouters,
    config: matchedRouterConfig,
  };
}

/**
 * The charger's identity: the `identity` route param when the route has one,
 * otherwise the last path segment (the legacy behaviour). Empty when the path
 * has neither.
 */
export function identityFromPath(
  params: Record<string, string>,
  pathname: string,
): string {
  let identity = params.identity;
  if (!identity) {
    const pathParts = pathname.split("/").filter(Boolean);
    identity = safeDecodeURIComponent(pathParts[pathParts.length - 1] ?? "");
  }
  return identity;
}
