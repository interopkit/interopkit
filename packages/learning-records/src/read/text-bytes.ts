import { LimitError } from "@interopkit/core";

/**
 * Checks that a text has at most a number of bytes, counted as UTF-8, and names the limit `maxBytes` when it has more.
 *
 * @param what - Names the text in the sentence, such as `The text`.
 * @throws `LimitError` with the limit `maxBytes` when the text has more bytes.
 */
export function checkTextBytes(text: string, maxBytes: number, what: string): void {
  // A string of more units than the limit has more bytes than it, so the longer ones need no encoding.
  const bytes = text.length > maxBytes ? text.length : new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    throw new LimitError(
      `${what} has ${bytes} bytes or more, above the limit of ${maxBytes} bytes.`,
      "maxBytes",
      maxBytes,
    );
  }
}
