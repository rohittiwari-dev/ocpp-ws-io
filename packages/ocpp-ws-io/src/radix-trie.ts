import type { OCPPRouter } from "./router.js";

/**
 * Result of a successful trie match.
 */
export interface TrieMatchResult {
  /** All routers whose patterns matched the incoming path. */
  routers: OCPPRouter[];
  /** Extracted named parameters from the path (e.g. { identity: "CP-001" }). */
  params: Record<string, string>;
}

/**
 * A single node in the radix trie.
 * Each node represents one URL path segment.
 */
class TrieNode {
  /** Static children keyed by lowercase segment value. */
  children = new Map<string, TrieNode>();
  /** Dynamic parameter child (`:param` segments). */
  paramChild: TrieNode | null = null;
  /** The name of the param if this node IS a param node (e.g. "identity"). */
  paramName = "";
  /** Wildcard child (`*` catch-all). Lowest priority. */
  wildcardChild: TrieNode | null = null;
  /** Routers registered at this exact node (leaf). */
  routers: OCPPRouter[] = [];
}

/**
 * Normalize a URL path for consistent matching.
 * - Strips leading/trailing slashes
 * - Collapses double slashes
 * - Splits into segments
 */
function normalizePath(path: string): string[] {
  return path
    .replace(/\/+/g, "/") // collapse double slashes
    .replace(/^\/|\/$/g, "") // strip leading/trailing
    .split("/")
    .filter(Boolean);
}

/**
 * RadixTrie — O(k) route lookup for WebSocket path matching.
 *
 * Priority order at each segment level:
 *   1. Static match (exact string)
 *   2. Param match (`:name`)
 *   3. Wildcard match (`*`)
 *
 * Supports multiple routers per pattern (all fire on match).
 * Detects conflicting param names at the same position.
 */
export class RadixTrie {
  private readonly root = new TrieNode();
  private _frozen = false;
  private _size = 0;

  /** Number of registered route patterns. */
  get size(): number {
    return this._size;
  }

  // ── Registration ──────────────────────────────────────────────

  /**
   * Insert a route pattern into the trie.
   * Called at startup / route registration time.
   *
   * @param pattern - Express-style path like "/ocpp/:version/:identity" or "/api/*"
   * @param router  - The OCPPRouter instance to associate with this pattern
   * @throws If a conflicting param name exists at the same trie position
   */
  insert(pattern: string, router: OCPPRouter): void {
    if (this._frozen) {
      this._frozen = false; // unfreeze on mutation
    }

    const segments = normalizePath(pattern);
    let node = this.root;

    for (const segment of segments) {
      if (segment === "*") {
        // Wildcard catch-all — matches any remaining segments
        if (!node.wildcardChild) {
          node.wildcardChild = new TrieNode();
        }
        node = node.wildcardChild;
        break; // wildcard consumes the rest
      } else if (segment.startsWith(":")) {
        // Named parameter
        const paramName = segment.slice(1);

        if (!node.paramChild) {
          node.paramChild = new TrieNode();
          node.paramChild.paramName = paramName;
        } else if (node.paramChild.paramName !== paramName) {
          // Conflict: different param name at the same position
          throw new Error(
            `Route conflict: param ":${paramName}" conflicts with existing ":${node.paramChild.paramName}" at the same position in pattern "${pattern}"`,
          );
        }

        node = node.paramChild;
      } else {
        // Static segment — case-insensitive
        const key = segment.toLowerCase();
        let child = node.children.get(key);
        if (!child) {
          child = new TrieNode();
          node.children.set(key, child);
        }
        node = child;
      }
    }

    // Store router at the leaf node
    node.routers.push(router);
    this._size++;
  }

  // ── Matching ──────────────────────────────────────────────────

  /**
   * Match an incoming WebSocket pathname against the trie.
   * Returns all matching routers + extracted params from the most specific match.
   *
   * Complexity: O(k) where k = number of path segments.
   * Route count is irrelevant — no iteration over registered routes.
   *
   * @param pathname - The raw URL pathname (e.g. "/ocpp/1.6/CP-001")
   * @returns Match result or null if no route matches
   */
  match(pathname: string): TrieMatchResult | null {
    const segments = normalizePath(pathname);
    const matches: Array<{
      routers: OCPPRouter[];
      params: Record<string, string>;
    }> = [];

    this._matchRecursive(this.root, segments, 0, {}, matches);

    if (matches.length === 0) return null;

    // Matches are collected in priority order (static > param > wildcard).
    // Use params from the most specific (first) match, collect all routers.
    const params = matches[0].params;
    const allRouters: OCPPRouter[] = [];
    for (const m of matches) {
      allRouters.push(...m.routers);
    }

    return { routers: allRouters, params };
  }

  /**
   * Recursive matching with priority: static > param > wildcard.
   * Each branch carries its own copy of params to avoid cross-pollution.
   */
  private _matchRecursive(
    node: TrieNode,
    segments: string[],
    depth: number,
    params: Record<string, string>,
    results: Array<{ routers: OCPPRouter[]; params: Record<string, string> }>,
  ): void {
    // Reached end of path — collect routers at this node
    if (depth === segments.length) {
      if (node.routers.length > 0) {
        results.push({ routers: [...node.routers], params: { ...params } });
      }
      return;
    }

    const segment = segments[depth];
    const segLower = segment.toLowerCase();

    // Priority 1: Static match (exact, case-insensitive)
    const staticChild = node.children.get(segLower);
    if (staticChild) {
      this._matchRecursive(staticChild, segments, depth + 1, params, results);
    }

    // Priority 2: Param match — use a copy of params for isolation
    if (node.paramChild) {
      const branchParams = { ...params };
      branchParams[node.paramChild.paramName] = decodeURIComponent(segment);

      this._matchRecursive(
        node.paramChild,
        segments,
        depth + 1,
        branchParams,
        results,
      );
    }

    // Priority 3: Wildcard match (catches all remaining segments)
    if (node.wildcardChild && node.wildcardChild.routers.length > 0) {
      results.push({
        routers: [...node.wildcardChild.routers],
        params: { ...params },
      });
    }
  }

  // ── Freezing ──────────────────────────────────────────────────

  /**
   * Freeze the trie structure for V8 JIT optimization.
   * Call after all routes are registered and before first match.
   * Late insertions will automatically unfreeze.
   */
  freeze(): void {
    if (this._frozen) return;
    this._freezeNode(this.root);
    this._frozen = true;
  }

  private _freezeNode(node: TrieNode): void {
    Object.freeze(node.routers);
    if (node.paramChild) this._freezeNode(node.paramChild);
    if (node.wildcardChild) this._freezeNode(node.wildcardChild);
    for (const child of node.children.values()) {
      this._freezeNode(child);
    }
  }

  /** Whether the trie is currently frozen. */
  get frozen(): boolean {
    return this._frozen;
  }
}
