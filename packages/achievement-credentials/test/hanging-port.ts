import { expect } from "vitest";

/** The reason that the callers of the tests give when they abort, which an aborted wait must reject with. */
const GAVE_UP = "The caller gave up.";

/**
 * Makes a port of a host that never answers. It records the signal that it is given, whichever of its arguments carries one,
 * and returns a promise that never settles.
 */
export function hangingPort(): {
  readonly hang: (...call: unknown[]) => Promise<never>;
  readonly seen: (AbortSignal | undefined)[];
} {
  const seen: (AbortSignal | undefined)[] = [];
  const hang = (...call: unknown[]) => {
    const options = call.find(
      (argument): argument is { readonly signal?: AbortSignal } =>
        typeof argument === "object" && argument !== null && "signal" in argument,
    );
    seen.push(options?.signal);
    return new Promise<never>(() => undefined);
  };
  return { hang, seen };
}

/**
 * Starts an operation with a signal, waits until it has called the hanging port, aborts, and expects the operation to reject
 * with the reason of the signal, and the port to have been given that signal.
 */
export async function abortsWhileWaiting(
  start: (signal: AbortSignal) => Promise<unknown>,
  seen: readonly (AbortSignal | undefined)[],
): Promise<void> {
  const controller = new AbortController();
  const pending = start(controller.signal);
  const rejected = expect(pending).rejects.toThrow(GAVE_UP);
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  controller.abort(new Error(GAVE_UP));
  await rejected;
  expect(seen[0]?.aborted).toBe(true);
}
