/**
 * Running a handler for an incoming CALL or SEND. Its `signal` aborts when the
 * connection closes before it settles (`abortHandlers`), or when it runs past
 * `handlerTimeoutMs`. Shared by the Node and the browser clients, so nothing
 * here may import Node's modules.
 */

/**
 * Run `invoke` with a signal that `abortHandlers(running, …)` aborts. With
 * `timeoutMs` above 0, reject with `timeoutError()` once it has run that long,
 * aborting the signal with the same error. JavaScript cannot stop the handler:
 * it runs on, what it returns then answers nothing, and `onLate` is called
 * when it settles.
 */
export async function runHandler<T>(
  running: Set<AbortController>,
  timeoutMs: number,
  timeoutError: () => Error,
  invoke: (signal: AbortSignal) => T | Promise<T>,
  onLate: () => void,
): Promise<T> {
  const ac = new AbortController();
  running.add(ac);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let work: Promise<T>;
    try {
      work = Promise.resolve(invoke(ac.signal));
    } catch (err) {
      work = Promise.reject(err);
    }
    if (!(timeoutMs > 0)) return await work;

    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = timeoutError();
        ac.abort(err);
        work.then(onLate, onLate);
        reject(err);
      }, timeoutMs);
    });
    // A connection that closed has no one left to answer: its handlers'
    // time limits stop with it.
    ac.signal.addEventListener("abort", () => clearTimeout(timer), {
      once: true,
    });
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
    running.delete(ac);
  }
}

/** The longest delay setTimeout takes; a longer one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Wait for the answers to the peer's calls being handled, at most `limitMs`:
 * callTimeoutMs, the bound this side's own calls have. A handler that never
 * settles must not keep close() waiting for ever; past the limit the
 * connection closes, and abortHandlers() aborts what still runs.
 */
export function waitForAnswers(
  answering: readonly Promise<void>[],
  limitMs: number,
): Promise<void> {
  if (answering.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(
      resolve,
      Math.min(Math.max(limitMs, 0), MAX_TIMER_MS),
    );
    void Promise.allSettled(answering).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** The connection closed: abort the signal of every handler still running. */
export function abortHandlers(
  running: Set<AbortController>,
  reason: Error,
): void {
  for (const ac of running) ac.abort(reason);
  running.clear();
}
