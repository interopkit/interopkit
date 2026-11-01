import { DataError } from "@interopkit/core";

/** The limit of `readMultipart` that a message went over. */
export type MultipartLimit = "parts" | "part-bytes" | "total-bytes" | "header-bytes";

/** The error for a multipart message that goes over a limit, which a handler answers with 413 and not with 400. */
export class MultipartLimitError extends DataError {
  /** Error class name. */
  override name = "MultipartLimitError";
  /** The limit that the message went over: `header-bytes` is the fixed limit of 8,192 bytes for the headers of a part. */
  readonly limit: MultipartLimit;

  /**
   * @param message - Says which limit the message went over.
   * @param limit - The limit.
   */
  constructor(message: string, limit: MultipartLimit) {
    super(message);
    this.limit = limit;
  }
}
