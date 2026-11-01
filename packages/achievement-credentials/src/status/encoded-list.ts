import { base64url } from "jose";
import { MAX_INFLATED_BYTES, type StatusList } from "./bitstring.js";

/** The multibase prefix of base64url without padding, which an `encodedList` starts with. */
const MULTIBASE_BASE64URL = "u";

/** Reads a stream to its end, and stops with `undefined` once it has produced more than a number of bytes. */
async function readLimited(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | undefined> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      // The bomb is stopped here: no more output is produced, and what was produced is dropped.
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Encodes a list as the `encodedList` of a status list credential: GZIP, then multibase base64url without padding.
 */
export async function encodeList(list: StatusList): Promise<string> {
  const compressed = await readLimited(
    new Blob([Uint8Array.from(list.bits)]).stream().pipeThrough(new CompressionStream("gzip")),
    Number.MAX_SAFE_INTEGER,
  );
  return `${MULTIBASE_BASE64URL}${base64url.encode(compressed ?? new Uint8Array())}`;
}

/**
 * Decodes the `encodedList` of a status list credential, inflating it through a `DecompressionStream` that is cancelled at the
 * limit: the library's own decoder inflates with no limit and a small list could fill the memory.
 *
 * @returns The bits, or a sentence that says why the text is not a list within the limit.
 */
export async function decodeList(
  encoded: unknown,
  limit = MAX_INFLATED_BYTES,
): Promise<{ readonly bits: Uint8Array } | { readonly reason: string }> {
  if (typeof encoded !== "string" || !encoded.startsWith(MULTIBASE_BASE64URL)) {
    return { reason: "The encodedList is not multibase base64url text, which starts with u." };
  }
  let compressed: Uint8Array;
  try {
    compressed = base64url.decode(encoded.slice(MULTIBASE_BASE64URL.length));
  } catch {
    return { reason: "The encodedList is not base64url." };
  }
  try {
    const bits = await readLimited(
      new Blob([Uint8Array.from(compressed)]).stream().pipeThrough(new DecompressionStream("gzip")),
      limit,
    );
    return bits === undefined
      ? { reason: `The encodedList inflates to more than the ${limit} bytes that a list may have.` }
      : { bits };
  } catch {
    return { reason: "The encodedList is not GZIP data." };
  }
}
