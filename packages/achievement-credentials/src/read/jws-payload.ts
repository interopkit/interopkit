import { isRecord, MAX_JSON_DEPTH } from "@interopkit/core/checks";
import * as v from "valibot";
import { parseJsonText } from "../json-text.js";
import { jws } from "./primitives.js";

/** Throws on bytes that are not UTF-8, where the default decoder would replace them. */
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** What `readJwsPayload` returns: the payload as a JSON object, or the reason that it is not one. */
export type JwsPayload =
  | {
      /** The payload. */
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      /** A sentence that says what is wrong with the JWS or its payload. */
      readonly reason: string;
    };

/** The alphabet of base64url (RFC 4648 section 5), in the order of the values of its characters. */
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The bits of the last character that no byte holds when the length of the text is 2 more than a multiple of 4. */
const UNUSED_OF_TWO = 0b1111;
/** The bits of the last character that no byte holds when the length of the text is 3 more than a multiple of 4. */
const UNUSED_OF_THREE = 0b11;

/**
 * Decodes base64url without padding to bytes, when the text is the one canonical spelling of them (RFC 7515 section 2): its
 * length is not one more than a multiple of four, and the bits of its last character that no byte holds are zero. The text is
 * of the alphabet of base64url, which the form of a compact JWS ensures.
 */
function decodeBase64url(text: string): Uint8Array | undefined {
  const rest = text.length % 4;
  if (rest === 1) return undefined;
  const unused = rest === 2 ? UNUSED_OF_TWO : rest === 3 ? UNUSED_OF_THREE : 0;
  if ((BASE64URL.indexOf(text.charAt(text.length - 1)) & unused) !== 0) return undefined;
  // The text is of the alphabet of base64url and of a length that holds bytes, so `atob` reads it.
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  // A loop over the code units, since a conversion with a callback makes a string of each.
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Reads the payload of a compact JWS as a JSON object, without checking its signature: what a verifier reads first to learn
 * which key and which documents to fetch.
 *
 * @remarks
 * The payload is the canonical base64url of UTF-8 text, which must be a JSON object. Its tokens are counted before it is
 * parsed, and its levels as well, so that a payload of a million empty arrays is refused without building anything. The
 * caller limits the length of the JWS.
 *
 * @param compact - The compact JWS.
 * @param maxTokens - The most tokens of JSON that the payload may have.
 * @returns The payload, or the reason that it cannot be read.
 */
export function readJwsPayload(compact: string, maxTokens: number): JwsPayload {
  if (!v.is(jws, compact)) return { reason: "The JWS is not a compact JWS of three parts of base64url characters." };
  const part = compact.slice(compact.indexOf(".") + 1, compact.lastIndexOf("."));
  if (part === "") return { reason: "The JWS has a detached payload, which holds no assertion." };
  const bytes = decodeBase64url(part);
  if (bytes === undefined) return { reason: "The payload of the JWS is not canonical base64url without padding." };
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return { reason: "The payload of the JWS is not UTF-8." };
  }
  // The tokens and the levels are counted before the parser builds anything.
  const parsed = parseJsonText(text, { maxDepth: MAX_JSON_DEPTH, maxTokens }, "The payload of the JWS");
  if ("reason" in parsed) return { reason: parsed.reason };
  const { value } = parsed;
  return isRecord(value) ? { value } : { reason: "The payload of the JWS is not a JSON object." };
}
