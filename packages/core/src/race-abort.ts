import type { CallOptions } from "./call-options.js";

/**
 * Waits for a promise, and ends the wait as soon as a signal aborts.
 *
 * @remarks
 * Only the caller's wait ends: the promise runs on, and its outcome is dropped, so the work that several callers share is
 * not cancelled by one of them. Whoever made the promise handles what it does afterwards. The listener on the signal is
 * removed when the wait ends.
 *
 * @param promise - The work to wait for.
 * @param options - The `signal` that ends the wait. Default: none, and then the promise is returned as it is.
 * @returns A promise that settles with `promise`, or rejects with the `reason` of `signal` when it aborts first.
 */
export function raceAbort<T>(promise: Promise<T>, options?: CallOptions): Promise<T> {
  const signal = options?.signal;
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
