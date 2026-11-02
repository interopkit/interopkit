import { DataError, ServiceError, untilAborted } from "@interopkit/core";
import type { ContextLoader } from "../model/index.js";
import { MAX_DEEP_ITERATIONS } from "./canonize.js";

/** The most levels of `cause` that are followed to find the failure of a service under the error of a processor. */
const MAX_CAUSE_DEPTH = 8;

/** The error that a processor wrapped: its `cause`, or the `cause` in the details that the JSON-LD processor gives. */
function wrapped(error: Error): unknown {
  if (error.cause !== undefined) return error.cause;
  const details: unknown = Reflect.get(error, "details");
  return typeof details === "object" && details !== null ? Reflect.get(details, "cause") : undefined;
}

/** The loader of documents that the JSON-LD processors call: it serves contexts from the package's loader and nothing else. */
export function documentLoaderOf(contexts: ContextLoader, signal?: AbortSignal) {
  return async (url: string) => ({
    contextUrl: null,
    documentUrl: url,
    // A loader is the host's port and may ignore the signal it is given: the wait ends at the signal either way.
    document: await untilAborted(Promise.resolve(contexts(url, signal === undefined ? undefined : { signal })), signal),
  });
}

/** Finds an error of a class in an error or under its causes: the processors of JSON-LD wrap what the loader throws. */
function causeOf<TError extends Error>(
  error: unknown,
  type: new (...parameters: never[]) => TError,
): TError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current instanceof type) return current;
    current = wrapped(current);
  }
  return undefined;
}

/**
 * Throws what the processors of JSON-LD wrapped when it is not a fault of the document: the `ServiceError` of a context that
 * could not be fetched, or the reason of the signal that aborted. The error of a document that is not valid is left to the
 * caller, which makes it a verdict.
 */
export function rethrowOperational(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
  const service = causeOf(error, ServiceError);
  if (service !== undefined) throw service;
}

/** The message that `rdf-canonize` gives when a canonicalization runs the Hash N-Degree Quads algorithm more often than it may. */
const DEEP_ITERATIONS_MESSAGE = /^Maximum deep iterations exceeded/u;

/**
 * Says what a limit of the canonicalization means, when the error of a processor is one: the sentence that names the limit, or
 * `undefined` for any other error.
 */
export function limitOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (DEEP_ITERATIONS_MESSAGE.test(current.message)) {
      return `The credential needs more than ${MAX_DEEP_ITERATIONS} runs of the Hash N-Degree Quads algorithm to canonicalize: too many blank nodes look alike, as the items of a long list do.`;
    }
    current = wrapped(current);
  }
  return undefined;
}

/**
 * Throws what a failed JSON-LD operation means to a caller that signs, derives or validates: the abort, the `ServiceError` of
 * a context, the `DataError` of a context that is not pinned or of a limit, or a `DataError` that says that the credential
 * cannot be processed.
 */
export function failOperation(error: unknown, signal?: AbortSignal): never {
  rethrowOperational(error, signal);
  const limit = limitOf(error);
  if (limit !== undefined) throw new DataError(limit);
  const refused = causeOf(error, DataError);
  if (refused !== undefined) throw refused;
  const message = error instanceof Error ? error.message : String(error);
  throw new DataError(`The credential cannot be processed as JSON-LD: ${message}`);
}
