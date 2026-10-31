import type { CallOptions } from "@interopkit/core";

/** The options that a port of the host receives: the signal of the call, and nothing else of the library's own. */
export function callOptionsOf(options: CallOptions): CallOptions {
  return { signal: options.signal };
}
