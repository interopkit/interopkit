import { DataError } from "@interopkit/core";
import { checkArray, describe, isRecord } from "@interopkit/core/checks";

/** A `~` that is not followed by 0 or 1, which no token of a JSON pointer holds (RFC 6901 section 3). */
const BAD_ESCAPE = /~(?![01])/u;

/**
 * Tells whether text is a JSON pointer as RFC 6901 section 3 writes it: empty, or any number of `/` and a token, where `~` is
 * followed by 0 or 1. It reads the text once, since a pattern with a quantified group runs out of stack on a pointer of some
 * millions of characters.
 */
function isPointer(text: string): boolean {
  return text === "" || (text.startsWith("/") && !BAD_ESCAPE.test(text));
}

/** An array index as RFC 6901 section 4 writes it: no sign and no leading zero. */
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/u;

/** Decodes the escapes of a token (RFC 6901 section 4): `~1` is `/` and `~0` is `~`, in that order. */
function decodeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** What a step along a pointer finds: the member, or why there is none. */
type Step = { readonly value: unknown } | { readonly reason: string };

/**
 * Takes one step along a pointer.
 *
 * @remarks
 * The primitives read a token without `~` that starts with digits as an array index even in an object (`1abc` is index 1), so
 * a token that is no plain integer in that form could select another member than the one it names: it is refused.
 */
function step(value: unknown, raw: string): Step {
  const token = decodeToken(raw);
  const read = raw.includes("~") ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isNaN(read) && String(read) !== raw) {
    return { reason: `the token ${JSON.stringify(raw)} would be read as the index ${read}` };
  }
  if (Array.isArray(value)) {
    const found = ARRAY_INDEX.test(token) && Number(token) < value.length;
    return found ? { value: value[Number(token)] } : { reason: `the array has no item ${JSON.stringify(token)}` };
  }
  if (isRecord(value) && Object.hasOwn(value, token)) return { value: value[token] };
  return { reason: `there is no member ${JSON.stringify(token)}` };
}

/** Tells why a pointer does not point at something in a document, or `undefined` when it does. */
function mismatch(pointer: string, document: Readonly<Record<string, unknown>>): string | undefined {
  let value: unknown = document;
  for (const raw of pointer.split("/").slice(1)) {
    const next = step(value, raw);
    if ("reason" in next) return next.reason;
    value = next.value;
  }
  return undefined;
}

/**
 * Checks the JSON pointers that say which parts of a document are revealed.
 *
 * @remarks
 * A pointer is refused unless it is a JSON pointer and points at something in the document. The primitives read a text that
 * does not start with `/` as the empty pointer, which selects the whole document, so a mistyped pointer would reveal everything.
 *
 * @param pointers - The pointers.
 * @param label - Names them in an error message, such as `The option selectivePointers`.
 * @param document - The document they point into.
 * @returns A copy of the pointers.
 * @throws `DataError` when they are not an array of JSON pointers, or one points at nothing in the document.
 */
export function checkPointers(
  pointers: readonly string[],
  label: string,
  document: Readonly<Record<string, unknown>>,
): readonly string[] {
  checkArray(pointers, `${label} must be an array`);
  for (const pointer of pointers) {
    if (typeof pointer !== "string" || !isPointer(pointer)) {
      throw new DataError(
        `${label} must hold JSON pointers such as "/credentialSubject/name", found ${describe(pointer)}.`,
      );
    }
    const reason = mismatch(pointer, document);
    if (reason !== undefined) {
      throw new DataError(
        `${label} holds the pointer ${JSON.stringify(pointer)}, which points at nothing in the document: ${reason}.`,
      );
    }
  }
  return [...pointers];
}
