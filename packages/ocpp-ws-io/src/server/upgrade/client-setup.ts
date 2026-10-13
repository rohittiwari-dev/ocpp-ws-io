import type { ClientOptions } from "../../types/client.js";
import type { LoggerLike } from "../../types/logger.js";
import type { OCPPPlugin } from "../../types/plugins.js";
import type { AnyOCPPProtocol } from "../../types/protocol.js";
import type { RouterConfig, ServerOptions } from "../../types/server.js";
import { guardPluginHook, reportPluginError } from "../plugin-hooks.js";
import type { OCPPServerClient } from "../server-client.js";

/**
 * A connecting client's options: the matched routes' config() where it sets
 * a value, the server's options otherwise.
 */
export function buildClientOptions<P extends AnyOCPPProtocol>(
  identity: string,
  routeConfig: RouterConfig | undefined,
  options: ServerOptions<P>,
): ClientOptions<P> {
  return {
    identity,
    endpoint: "",
    callTimeoutMs: routeConfig?.callTimeoutMs ?? options.callTimeoutMs,
    handlerTimeoutMs: options.handlerTimeoutMs,
    pingIntervalMs: routeConfig?.pingIntervalMs ?? options.pingIntervalMs,
    deferPingsOnActivity:
      routeConfig?.deferPingsOnActivity ?? options.deferPingsOnActivity,
    callConcurrency: routeConfig?.callConcurrency ?? options.callConcurrency,
    maxBadMessages: options.maxBadMessages,
    badMessageWindowMs: options.badMessageWindowMs,
    respondWithDetailedErrors: options.respondWithDetailedErrors,
    // A route's list was limited to its protocols, a subset of the
    // server's, by config().
    strictMode:
      (routeConfig?.strictMode as boolean | readonly P[] | undefined) ??
      options.strictMode,
    strictModeMethods:
      routeConfig?.strictModeMethods ?? options.strictModeMethods,
    strictModeValidators: options.strictModeValidators,
    idGenerator: options.idGenerator,
    idValidator: options.idValidator,
    rateLimit: routeConfig?.rateLimit ?? options.rateLimit,
    reconnect: false,
    logging: options.logging,
  };
}

/**
 * Tell the plugins a client connected, and pass them its events from then on.
 * `logger` is called each time a hook runs, so it returns the server's
 * current logger.
 */
export function attachClientPlugins<P extends AnyOCPPProtocol>(
  client: OCPPServerClient<P>,
  plugins: readonly OCPPPlugin<P>[],
  logger: () => LoggerLike | null,
): void {
  // Plugin: onConnection
  for (const plugin of plugins) {
    try {
      const result = plugin.onConnection?.(client);
      if (result instanceof Promise) {
        result.catch((err) => {
          logger()?.error?.("Plugin onConnection error", {
            name: plugin.name,
            error: (err as Error).message,
          });
        });
      }
    } catch (err) {
      logger()?.error?.("Plugin onConnection error", {
        name: plugin.name,
        error: (err as Error).message,
      });
    }
  }

  // ── Wire plugin event hooks ──
  // onMessage: unified message observation (IN + OUT)
  client.on("message", (payload) => {
    for (const plugin of plugins) {
      try {
        guardPluginHook(
          logger(),
          plugin.onMessage?.(client, payload),
          plugin.name,
          "onMessage",
        );
      } catch (err) {
        reportPluginError(logger(), plugin.name, "onMessage", err);
      }
    }
  });
  // onError: WebSocket-level errors
  client.on("error", (err) => {
    for (const plugin of plugins) {
      try {
        guardPluginHook(
          logger(),
          plugin.onError?.(client, err),
          plugin.name,
          "onError",
        );
      } catch (err) {
        reportPluginError(logger(), plugin.name, "onError", err);
      }
    }
  });
  // onBadMessage: malformed/unparseable messages
  client.on("badMessage", ({ message: rawMsg, error: badErr }) => {
    for (const plugin of plugins) {
      try {
        guardPluginHook(
          logger(),
          plugin.onBadMessage?.(client, rawMsg, badErr),
          plugin.name,
          "onBadMessage",
        );
      } catch (err) {
        reportPluginError(logger(), plugin.name, "onBadMessage", err);
      }
    }
  });
  // onValidationFailure: schema validation failures (strictMode)
  client.on("strictValidationFailure", ({ message: msg, error: valErr }) => {
    for (const plugin of plugins) {
      try {
        guardPluginHook(
          logger(),
          plugin.onValidationFailure?.(client, msg, valErr),
          plugin.name,
          "onValidationFailure",
        );
      } catch (err) {
        reportPluginError(logger(), plugin.name, "onValidationFailure", err);
      }
    }
  });
  // onBackpressure: slow client detection
  client.on("backpressure", (evt) => {
    for (const plugin of plugins) {
      try {
        guardPluginHook(
          logger(),
          plugin.onBackpressure?.(client, evt.bufferedAmount),
          plugin.name,
          "onBackpressure",
        );
      } catch (err) {
        reportPluginError(logger(), plugin.name, "onBackpressure", err);
      }
    }
  });
  // onPongTimeout: dead peer detection
  client.on("pongTimeout", () => {
    for (const plugin of plugins) {
      try {
        guardPluginHook(
          logger(),
          plugin.onPongTimeout?.(client),
          plugin.name,
          "onPongTimeout",
        );
      } catch (err) {
        reportPluginError(logger(), plugin.name, "onPongTimeout", err);
      }
    }
  });
  // onHandlerError: user handler threw during CALL processing
  client.on("handlerError", ({ method: hMethod, error: hErr }) => {
    for (const plugin of plugins) {
      try {
        guardPluginHook(
          logger(),
          plugin.onHandlerError?.(client, hMethod, hErr),
          plugin.name,
          "onHandlerError",
        );
      } catch (err) {
        reportPluginError(logger(), plugin.name, "onHandlerError", err);
      }
    }
  });
  // onRateLimitExceeded: message dropped due to rate limiting
  client.on("rateLimitExceeded", (evt) => {
    for (const plugin of plugins) {
      try {
        guardPluginHook(
          logger(),
          plugin.onRateLimitExceeded?.(client, evt.rawData),
          plugin.name,
          "onRateLimitExceeded",
        );
      } catch (err) {
        reportPluginError(logger(), plugin.name, "onRateLimitExceeded", err);
      }
    }
  });
}
