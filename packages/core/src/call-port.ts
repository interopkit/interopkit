import { raceAbort } from "./race-abort.js";

/** What a call to a port gave: the value, or `undefined` when the port failed. */
export type PortOutcome<T> =
  | {
      /** The value that the port gave. */
      readonly value: T;
    }
  | undefined;

/**
 * Waits for a call to a port of the host and turns its failure into a value.
 *
 * @remarks
 * A handler answers 500 when a port fails and says nothing of the failure, so it needs the failure as a value and not as an
 * exception. A signal that aborted is no failure of the port: nobody is left to read an answer, so the wait ends with the
 * reason of the signal. A port that throws before it returns a promise fails in the same way as one that rejects.
 *
 * @param call - Calls the port, with the signal.
 * @param signal - The signal that ends the wait.
 * @returns The value in an object, or `undefined` when the port failed.
 * @throws The `reason` of the signal when it aborts, before or during the call.
 */
export async function callPort<T>(call: () => Promise<T> | T, signal?: AbortSignal): Promise<PortOutcome<T>> {
  try {
    signal?.throwIfAborted();
    return { value: await raceAbort(Promise.resolve(call()), signal) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}
