import { abortSignalSchema, parseWith, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";

/** The `signal` of a call, which every option object of the client may carry. */
export const signalEntry = {
  signal: v.optional(abortSignalSchema),
};

/** Reads the options of a call that has more than the `signal`, which may be left out. */
export function readOptions<TOptions>(schema: Schema<TOptions>, options: unknown): TOptions {
  return parseWith(schema, options === undefined ? {} : options, "The options object");
}
