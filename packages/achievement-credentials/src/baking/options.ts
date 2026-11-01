import { DataError } from "@interopkit/core";
import { checkPositiveInteger, checkProperties, checkRecord, describe } from "@interopkit/core/checks";

/**
 * The most bytes of an image that the functions read or write unless the host says otherwise: the largest baked image that
 * the design allows.
 */
export const DEFAULT_MAX_BYTES = 10_485_760;

/**
 * The most characters of the credential in an image. `JSON.parse` takes about forty times the text in memory when the text is
 * small objects, so a limit on the image alone would let 10 MiB cost hundreds of megabytes. A credential longer than this is
 * more than `verifyCredential` takes by default (its `maxInputBytes`, 1,048,576).
 */
export const MAX_CREDENTIAL_CHARACTERS = 1_048_576;

/** The options of `readPng` and `readSvg`. */
export interface ReadImageOptions {
  /**
   * The most bytes of the image. A larger image is refused before any of it is read.
   *
   * @defaultValue 10,485,760
   */
  readonly maxBytes?: number;
}

/** The options of `bakePng` and `bakeSvg`. */
export interface BakeImageOptions extends ReadImageOptions {
  /**
   * Whether to replace the credential that the image already holds. When it is `false`, an image that holds one is refused.
   *
   * @defaultValue false
   */
  readonly replace?: boolean;
}

/** What a function takes from the options of a call, with the defaults. */
export interface ImageLimits {
  readonly maxBytes: number;
  readonly replace: boolean;
}

/**
 * Checks the options of a call, as a host passes them from JavaScript, and fills in the defaults.
 *
 * @param options - The options, or `undefined`.
 * @param names - The options that the function takes.
 * @throws `DataError` that names the option and what it must be.
 */
export function limitsOf(options: unknown, names: readonly ("maxBytes" | "replace")[]): ImageLimits {
  if (options === undefined) return { maxBytes: DEFAULT_MAX_BYTES, replace: false };
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", names);
  const { maxBytes = DEFAULT_MAX_BYTES, replace = false } = options;
  checkPositiveInteger(maxBytes, "The option maxBytes");
  if (typeof replace !== "boolean") {
    throw new DataError(`The option replace must be true or false, found ${describe(replace)}.`);
  }
  return { maxBytes, replace };
}

/** Refuses an image of more bytes than the limit; `what` names it in the message, such as `The image`. */
export function checkImageSize(bytes: number, maxBytes: number, what: string): void {
  if (bytes > maxBytes) {
    throw new DataError(`${what} has ${bytes} bytes, more than the ${maxBytes} that the option maxBytes allows.`);
  }
}

/** The bytes that a UTF-16 code unit takes in UTF-8, counting each half of a surrogate pair as two, since a pair takes four. */
function utf8Bytes(unit: number): number {
  if (unit < 0x80) return 1;
  if (unit < 0x800) return 2;
  return unit >= 0xd800 && unit <= 0xdfff ? 2 : 3;
}

/**
 * Refuses text of more bytes than the limit, measured as UTF-8. Text of at most a third of the limit in characters cannot
 * exceed it, and text of more characters than the limit does, so only the text between needs counting.
 */
export function checkTextSize(text: string, maxBytes: number, what: string): void {
  if (text.length <= maxBytes / 3) return;
  let bytes = 0;
  for (let at = 0; at < text.length && bytes <= maxBytes; at += 1) bytes += utf8Bytes(text.charCodeAt(at));
  checkImageSize(bytes, maxBytes, what);
}
