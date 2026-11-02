import type { CallOptions } from "@interopkit/core";
import { checkAbortSignal, checkFunction, checkPositiveInteger, checkRecord } from "@interopkit/core/checks";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_TOKENS } from "../limits.js";

/** Returns the JSON-LD context behind a URL. */
export type Contexts = (url: string, options?: CallOptions) => Promise<unknown>;

/** The options that every function of the package takes. */
interface CommonOptions extends CallOptions {
  readonly contexts: Contexts;
  readonly maxBytes?: number;
  readonly maxTokens?: number;
}

/** The options of a call with their defaults applied. */
export interface ResolvedOptions {
  readonly contexts: Contexts;
  readonly signal: AbortSignal | undefined;
  readonly maxBytes: number;
  readonly maxTokens: number;
}

/**
 * Checks the options that every function of the package takes, as a host passes them from JavaScript, and applies the
 * defaults.
 *
 * @param options - The options.
 * @param label - Names the options in an error message, such as `The options of addBaseProof`.
 * @throws `DataError` when the options are not an object, `contexts` is not a function, `signal` is not an `AbortSignal`, or
 * `maxBytes` or `maxTokens` is not a positive integer.
 */
export function readCommonOptions(options: CommonOptions, label: string): ResolvedOptions {
  checkRecord(options, `${label} must be an object`);
  checkFunction(options.contexts, "The option contexts must be a function");
  if (options.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
  if (options.maxBytes !== undefined) checkPositiveInteger(options.maxBytes, "The option maxBytes");
  if (options.maxTokens !== undefined) checkPositiveInteger(options.maxTokens, "The option maxTokens");
  return {
    contexts: options.contexts,
    signal: options.signal,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}
