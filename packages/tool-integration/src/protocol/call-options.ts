import type { CallOptions } from "@interopkit/core";
import { guardSchema, type Schema } from "@interopkit/core/checks";

/** The schema of an option that is a function of the host, which only a call can check further. */
export const functionSchema = <TFunction>(): Schema<TFunction> =>
  guardSchema((value): value is TFunction => typeof value === "function", "a function");

/** The options that a port of the host receives: the signal of the call, and nothing else of the library's own. */
export function callOptionsOf(options: CallOptions): CallOptions {
  return { signal: options.signal };
}
