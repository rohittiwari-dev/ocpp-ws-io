import type { LoggerLike } from "../types/logger.js";
import type { PluginHookResult } from "../types/plugins.js";

// Calling plugin hooks safely: a rejected or throwing hook is logged instead
// of escaping, a shutdown hook is given a time budget, and a metrics scrape
// cannot be held open by a slow plugin.

/**
 * How long a plugin gets to contribute to a `/metrics` scrape.
 *
 * A metrics plugin reads counters it already holds, so this is generous.
 * The point is that a scrape cannot be held open by one slow plugin.
 */
export const METRICS_PLUGIN_TIMEOUT_MS = 2000;

/** Reject if a promise has not settled within `timeoutMs`. */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Report a plugin hook failure without letting it escape.
 *
 * Most hooks are declared `void | Promise<void>`, so a plugin may legitimately
 * be async — but a `try`/`catch` around the call only ever sees a synchronous
 * throw. An async hook that rejects escapes it entirely and becomes an
 * unhandled rejection, which since Node 15 terminates the process by default:
 * one plugin whose backend is briefly unreachable takes down the CSMS.
 *
 * Every dispatch passes its return value through {@link guardPluginHook} so
 * a rejection lands here instead.
 */
export function reportPluginError(
  logger: LoggerLike | null,
  pluginName: string,
  hook: string,
  err: unknown,
): void {
  logger?.error?.(`Plugin ${hook} error`, {
    name: pluginName,
    error: (err as Error)?.message ?? String(err),
  });
}

/** Attach a rejection handler when a hook returned a promise. */
export function guardPluginHook(
  logger: LoggerLike | null,
  result: PluginHookResult,
  pluginName: string,
  hook: string,
): void {
  if (result instanceof Promise) {
    result.catch((err: unknown) =>
      reportPluginError(logger, pluginName, hook, err),
    );
  }
}

/**
 * Await a shutdown hook, but not forever.
 *
 * `close()` awaits every plugin's `onClosing` and then every `onClose`. With
 * no bound, one plugin whose promise never settles — a broker call with no
 * timeout of its own is enough — hangs the shutdown indefinitely. That is
 * not a graceful shutdown that takes a while; it is one that never ends, so
 * the supervisor eventually sends SIGKILL and the sockets die unclean.
 *
 * A hook that overruns is abandoned and logged, and shutdown continues.
 */
export async function awaitShutdownHook(
  logger: LoggerLike | null,
  shutdownTimeoutMs: number | undefined,
  result: PluginHookResult,
  pluginName: string,
  hook: "onClosing" | "onClose",
): Promise<void> {
  if (!(result instanceof Promise)) return;

  const timeoutMs = shutdownTimeoutMs ?? 5000;
  if (timeoutMs <= 0) {
    // Explicitly opted out of the bound.
    await result;
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const overran = new Promise<"overran">((resolve) => {
    timer = setTimeout(() => resolve("overran"), timeoutMs);
    timer.unref?.();
  });

  try {
    const outcome = await Promise.race([
      result.then(() => "settled" as const),
      overran,
    ]);
    if (outcome === "overran") {
      // Abandoned, so its eventual rejection would otherwise be unhandled.
      result.catch(() => {});
      logger?.warn?.(`Plugin ${hook} exceeded the shutdown budget`, {
        name: pluginName,
        timeoutMs,
        note: "shutdown continued without it",
      });
    }
  } catch (err) {
    reportPluginError(logger, pluginName, hook, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
