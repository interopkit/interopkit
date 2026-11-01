import { guardSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";

/** The `signal` of a call, which every option object of the client may carry. */
export const signalEntry = {
  signal: v.optional(guardSchema((value): value is AbortSignal => value instanceof AbortSignal, "an AbortSignal")),
};

/** The schema of the options of a call that has only the `signal`. */
export const callOptionsSchema = strictRecord(signalEntry);
