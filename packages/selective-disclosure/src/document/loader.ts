import { DataError, raceAbort } from "@interopkit/core";
import { copyJson, describe, isRecord } from "@interopkit/core/checks";
import { MAX_DEEP_ITERATIONS } from "../limits.js";
import type { Contexts } from "./options.js";
import type { ProcessingOptions } from "./primitives.js";

/** The options of every call into the primitives, and the wait for the work that uses them. */
export interface Processing {
  /** The caller's loader as the loader of `jsonld`, and the bound of the work and the signal for `rdf-canonize`. */
  readonly options: ProcessingOptions;
  /**
   * Waits for work that uses `options`.
   *
   * @throws The `reason` of the signal when it aborts, so that the caller's wait ends while the work runs on; the error of
   * the caller's loader when it failed, which the processors would have wrapped in theirs; and a `DataError` for any other
   * failure, which is a fault of the document or its contexts.
   */
  wait<T>(work: Promise<T>): Promise<T>;
  /** Whether a failure of `wait` is the caller's, an abort or a failed loader, and not a fault of the document. */
  callerFailed(): boolean;
}

/** The text of an error as a sentence: it ends in one full stop. */
function messageOf(error: unknown): string {
  return `${String(error instanceof Error ? error.message : error).replace(/\.$/u, "")}.`;
}

/**
 * Wraps the caller's context loader as the document loader of the JSON-LD processors. The processors get no other loader, so
 * a context is never read from anywhere else.
 *
 * @param contexts - Returns the context behind a URL.
 * @param signal - Ends the caller's wait; the loader receives it too.
 */
export function createProcessing(contexts: Contexts, signal?: AbortSignal): Processing {
  let failure: { readonly error: unknown } | undefined;
  const documentLoader = async (url: string) => {
    try {
      signal?.throwIfAborted();
      const context = await contexts(url, signal === undefined ? undefined : { signal });
      if (!isRecord(context)) {
        throw new DataError(
          `The context loader must return the context of ${url} as an object, found ${describe(context)}.`,
        );
      }
      // A copy: the processors rewrite the URLs of the context they are given, and the loader may hold it for the next call.
      const copy = copyJson(context, "");
      if ("problem" in copy) {
        throw new DataError(`The context of ${url} from the context loader must be JSON, but ${copy.problem}.`);
      }
      return { contextUrl: null, documentUrl: url, document: copy.value };
    } catch (error) {
      failure ??= { error };
      throw error;
    }
  };
  return {
    options: { documentLoader, maxDeepIterations: MAX_DEEP_ITERATIONS, ...(signal === undefined ? {} : { signal }) },
    async wait(work) {
      try {
        return await raceAbort(work, signal);
      } catch (error) {
        if (failure !== undefined) throw failure.error;
        if (signal?.aborted) throw signal.reason;
        if (error instanceof DataError) throw error;
        throw new DataError(`The document cannot be processed as JSON-LD with its contexts: ${messageOf(error)}`, {
          cause: error,
        });
      }
    },
    callerFailed() {
      return failure !== undefined || signal?.aborted === true;
    },
  };
}
