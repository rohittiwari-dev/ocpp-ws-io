import type { OCPPPlugin } from "../types.js";

/**
 * Options for the circuit-breaker plugin.
 */
export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures before the circuit opens.
   * @default 5
   */
  failureThreshold?: number;

  /**
   * Duration in ms the circuit stays OPEN before attempting a HALF_OPEN probe.
   * @default 30000 (30 seconds)
   */
  resetTimeoutMs?: number;

  /**
   * Maximum number of concurrent outgoing calls per client.
   * When exceeded, calls are rejected immediately (fail-fast).
   * @default 20
   */
  maxConcurrent?: number;

  /**
   * Optional callback when a circuit state changes.
   * Useful for alerting/metrics integrations.
   */
  onStateChange?: (
    identity: string,
    from: CircuitState,
    to: CircuitState,
  ) => void;

  /**
   * Optional logger. Falls back to silent no-op.
   */
  logger?: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitInfo {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  concurrentCalls: number;
}

/**
 * Circuit Breaker Plugin (Level 2: Lifecycle Controller)
 *
 * Implements per-client circuit breaker pattern for flapping or unreliable
 * charging stations. Prevents a misbehaving client from degrading system
 * performance by fast-failing calls to clients exhibiting repeated errors.
 *
 * **State Machine:**
 * ```
 *   CLOSED ─(failures ≥ threshold)─→ OPEN
 *   OPEN ─(resetTimeout expires)─→ HALF_OPEN
 *   HALF_OPEN ─(success)─→ CLOSED
 *   HALF_OPEN ─(failure)─→ OPEN
 * ```
 *
 * @example
 * ```ts
 * import { circuitBreakerPlugin } from 'ocpp-ws-io/plugins';
 *
 * server.plugin(circuitBreakerPlugin({
 *   failureThreshold: 3,
 *   resetTimeoutMs: 15_000,
 *   onStateChange: (id, from, to) => {
 *     console.log(`Circuit ${id}: ${from} → ${to}`);
 *   },
 * }));
 * ```
 */
export function circuitBreakerPlugin(
  options?: CircuitBreakerOptions,
): OCPPPlugin {
  const failureThreshold = options?.failureThreshold ?? 5;
  const resetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
  const maxConcurrent = options?.maxConcurrent ?? 20;
  const log = options?.logger;
  const onStateChange = options?.onStateChange;

  const circuits = new Map<string, CircuitInfo>();

  function getCircuit(identity: string): CircuitInfo {
    let circuit = circuits.get(identity);
    if (!circuit) {
      circuit = {
        state: "CLOSED",
        failures: 0,
        lastFailure: 0,
        concurrentCalls: 0,
      };
      circuits.set(identity, circuit);
    }
    return circuit;
  }

  function transition(identity: string, to: CircuitState): void {
    const circuit = getCircuit(identity);
    const from = circuit.state;
    if (from === to) return;

    circuit.state = to;
    log?.warn?.(`[circuit-breaker] ${identity}: ${from} → ${to}`);
    onStateChange?.(identity, from, to);
  }

  return {
    name: "circuit-breaker",

    onConnection(client) {
      const circuit = getCircuit(client.identity);

      // Install middleware to intercept outgoing calls
      client.use(async (ctx, next) => {
        if (ctx.type !== "outgoing_call") {
          return next();
        }

        // Check concurrent call limit
        if (circuit.concurrentCalls >= maxConcurrent) {
          log?.warn?.(
            `[circuit-breaker] ${client.identity}: concurrent limit (${maxConcurrent}) reached, rejecting ${ctx.method}`,
          );
          throw new Error(
            `Circuit breaker: concurrent call limit exceeded for ${client.identity}`,
          );
        }

        const now = Date.now();

        // State evaluation
        if (circuit.state === "OPEN") {
          if (now - circuit.lastFailure >= resetTimeoutMs) {
            // Transition to HALF_OPEN — allow one probe call
            transition(client.identity, "HALF_OPEN");
          } else {
            // Fast-fail while circuit is OPEN
            throw new Error(
              `Circuit breaker OPEN for ${client.identity}: ${circuit.failures} consecutive failures`,
            );
          }
        }

        circuit.concurrentCalls++;
        try {
          const result = await next();

          // Success — reset failures
          circuit.concurrentCalls--;
          if (circuit.state === "HALF_OPEN") {
            transition(client.identity, "CLOSED");
            circuit.failures = 0;
          } else {
            // Decay failures on success in CLOSED state
            circuit.failures = Math.max(0, circuit.failures - 1);
          }

          return result;
        } catch (err) {
          circuit.concurrentCalls--;
          circuit.failures++;
          circuit.lastFailure = Date.now();

          if (circuit.state === "HALF_OPEN") {
            // Probe failed — back to OPEN
            transition(client.identity, "OPEN");
          } else if (circuit.failures >= failureThreshold) {
            // Threshold breached — trip the circuit
            transition(client.identity, "OPEN");
          }

          throw err;
        }
      });
    },

    onDisconnect(client) {
      // Reset concurrent calls on disconnect (they'll timeout naturally)
      const circuit = circuits.get(client.identity);
      if (circuit) {
        circuit.concurrentCalls = 0;
      }
    },

    onClose() {
      circuits.clear();
    },
  };
}
