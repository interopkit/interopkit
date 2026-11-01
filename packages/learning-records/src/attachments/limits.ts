import { parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";

/** The most parts of a multipart message that `readMultipart` reads unless the caller says otherwise: the Statements and 99 Attachments. */
const DEFAULT_MAX_PARTS = 100;

/** The most bytes of one part that `readMultipart` reads unless the caller says otherwise: 10 MiB, the size of an LRS request. */
const DEFAULT_MAX_PART_BYTES = 10_485_760;

/** The most bytes of all parts together that `readMultipart` reads unless the caller says otherwise: 10 MiB. */
const DEFAULT_MAX_TOTAL_BYTES = 10_485_760;

/** The deepest nesting of the JSON of the first part that `readMultipart` reads unless the caller says otherwise. */
const DEFAULT_MAX_DEPTH = 64;

/** The limits of `readMultipart`. */
export interface MultipartLimits {
  /**
   * The most parts, the Statements included.
   *
   * @defaultValue 100
   */
  readonly maxParts?: number;
  /**
   * The most bytes of the content of one part.
   *
   * @defaultValue 10,485,760
   */
  readonly maxPartBytes?: number;
  /**
   * The most bytes of the content of all parts together.
   *
   * @defaultValue 10,485,760
   */
  readonly maxTotalBytes?: number;
  /**
   * The deepest nesting of arrays and objects in the JSON of the first part: `[]` has depth 1.
   *
   * @defaultValue 64
   */
  readonly maxDepth?: number;
}

const limitsSchema = strictRecord({
  maxParts: v.optional(positiveIntegerSchema),
  maxPartBytes: v.optional(positiveIntegerSchema),
  maxTotalBytes: v.optional(positiveIntegerSchema),
  maxDepth: v.optional(positiveIntegerSchema),
});

/** Checks the limits of a read and returns each with its default. */
export function readLimits(options: unknown): Required<MultipartLimits> {
  const limits = parseWith(limitsSchema, options === undefined ? {} : options, "The options object");
  return {
    maxParts: limits.maxParts ?? DEFAULT_MAX_PARTS,
    maxPartBytes: limits.maxPartBytes ?? DEFAULT_MAX_PART_BYTES,
    maxTotalBytes: limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
}
