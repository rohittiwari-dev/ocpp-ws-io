import type { MiddlewareFunction } from "../middleware.js";
import type { MiddlewareContext, OCPPPlugin } from "../types.js";

/**
 * A transformation rule for a specific OCPP method/action.
 */
export interface TransformRule {
  /**
   * The method name to match (e.g., "BootNotification", "StatusNotification").
   * Supports exact match or wildcard "*" for all methods.
   */
  method: string;

  /**
   * Transform function for the payload.
   * Receives the current payload and source/target versions.
   * Must return the transformed payload.
   */
  transform: (
    payload: Record<string, unknown>,
    direction: "up" | "down",
  ) => Record<string, unknown>;
}

export interface SchemaVersioningOptions {
  /**
   * Source OCPP version identifier (e.g., "ocpp1.6" or "ocpp2.0.1").
   * This is the version used by the charging station (client).
   */
  sourceVersion: string;

  /**
   * Target OCPP version identifier (e.g., "ocpp2.0.1" or "ocpp1.6").
   * This is the version the application handlers expect.
   */
  targetVersion: string;

  /**
   * Array of transformation rules for specific OCPP actions.
   * Rules are checked in order; the first matching rule is applied.
   */
  rules: TransformRule[];

  /**
   * How to handle methods without a transform rule:
   * - "passthrough": Forward as-is
   * - "reject": Drop the message
   * @default "passthrough"
   */
  unmatchedBehavior?: "passthrough" | "reject";

  /**
   * Optional: Only apply transformations when client protocol matches this version.
   * If not set, applies to all clients.
   */
  applyWhen?: string;

  /**
   * Optional logger.
   */
  logger?: {
    warn: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
}

/**
 * Schema Versioning Plugin (Level 4: Middleware)
 *
 * Provides OCPP version transformation between 1.6 and 2.0.1 payloads.
 * This plugin sits in the middleware chain and transforms message payloads
 * between protocol versions, enabling a server to support mixed-version
 * charging station fleets with unified application handlers.
 *
 * **Architecture:**
 * ```
 * Station (1.6) ──→ [Transform to 2.0.1] ──→ Application Handler
 * Station (1.6) ←── [Transform to 1.6]   ←── Application Handler
 * ```
 *
 * @example
 * ```ts
 * import { schemaVersioningPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(schemaVersioningPlugin({
 *   sourceVersion: 'ocpp1.6',
 *   targetVersion: 'ocpp2.0.1',
 *   rules: [
 *     {
 *       method: 'BootNotification',
 *       transform: (payload, direction) => {
 *         if (direction === 'up') {
 *           // 1.6 → 2.0.1: Wrap in chargingStation object
 *           return {
 *             chargingStation: {
 *               model: payload.chargePointModel,
 *               vendorName: payload.chargePointVendor,
 *               serialNumber: payload.chargePointSerialNumber,
 *               firmwareVersion: payload.firmwareVersion,
 *             },
 *             reason: 'PowerUp',
 *           };
 *         }
 *         // 2.0.1 → 1.6: Flatten chargingStation
 *         const cs = payload.chargingStation as Record<string, unknown> ?? {};
 *         return {
 *           chargePointModel: cs.model,
 *           chargePointVendor: cs.vendorName,
 *           chargePointSerialNumber: cs.serialNumber,
 *           firmwareVersion: cs.firmwareVersion,
 *         };
 *       },
 *     },
 *   ],
 * }));
 * ```
 */
export function schemaVersioningPlugin(
  options: SchemaVersioningOptions,
): OCPPPlugin {
  const unmatchedBehavior = options.unmatchedBehavior ?? "passthrough";
  const log = options.logger;

  // Build a lookup map for O(1) rule matching
  const ruleMap = new Map<string, TransformRule>();
  let wildcardRule: TransformRule | undefined;

  for (const rule of options.rules) {
    if (rule.method === "*") {
      wildcardRule = rule;
    } else {
      ruleMap.set(rule.method, rule);
    }
  }

  function findRule(method: string): TransformRule | undefined {
    return ruleMap.get(method) ?? wildcardRule;
  }

  return {
    name: "schema-versioning",

    onConnection(client) {
      // Skip if applyWhen is set and client protocol doesn't match
      if (options.applyWhen && client.protocol !== options.applyWhen) {
        return;
      }

      const middleware: MiddlewareFunction<MiddlewareContext> = async (
        ctx,
        next,
      ) => {
        // Determine the method name based on context type
        const method = ctx.method;
        const rule = findRule(method);

        if (!rule) {
          if (unmatchedBehavior === "reject") {
            log?.warn?.(
              `[schema-versioning] No transform rule for method "${method}", rejecting`,
            );
            throw new Error(
              `Schema versioning: no transform rule for "${method}" (${options.sourceVersion} → ${options.targetVersion})`,
            );
          }
          // passthrough
          return next();
        }

        // Determine direction based on context type
        if (ctx.type === "incoming_call") {
          // Incoming from client → transform UP (source → target)
          try {
            const transformed = rule.transform(
              ctx.params as Record<string, unknown>,
              "up",
            );
            (ctx as { params: unknown }).params = transformed;
            log?.debug?.(
              `[schema-versioning] Transformed ${method} UP: ${options.sourceVersion} → ${options.targetVersion}`,
            );
          } catch (err) {
            log?.warn?.(
              `[schema-versioning] Transform UP failed for ${method}:`,
              err,
            );
            // Don't block — forward original payload
          }
        } else if (ctx.type === "outgoing_call") {
          // Outgoing to client → transform DOWN (target → source)
          try {
            const transformed = rule.transform(
              ctx.params as Record<string, unknown>,
              "down",
            );
            (ctx as { params: unknown }).params = transformed;
            log?.debug?.(
              `[schema-versioning] Transformed ${method} DOWN: ${options.targetVersion} → ${options.sourceVersion}`,
            );
          } catch (err) {
            log?.warn?.(
              `[schema-versioning] Transform DOWN failed for ${method}:`,
              err,
            );
          }
        } else if (ctx.type === "outgoing_result") {
          // Result going back to client → transform DOWN
          try {
            const transformed = rule.transform(
              ctx.payload as Record<string, unknown>,
              "down",
            );
            (ctx as { payload: unknown }).payload = transformed;
          } catch (err) {
            log?.warn?.(
              `[schema-versioning] Transform DOWN (result) failed for ${method}:`,
              err,
            );
          }
        }

        return next();
      };

      client.use(middleware);
    },
  };
}
