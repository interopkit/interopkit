import { DataError } from "@interopkit/core";
import { isRecord, MAX_JSON_DEPTH, parseJsonText } from "@interopkit/core/checks";
import * as v from "valibot";
import { decodeBase64url } from "../base64url.js";
import { jsonRefusals } from "../json-text.js";
import { jws } from "./primitives.js";

/** Throws on bytes that are not UTF-8, where the default decoder would replace them. */
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Reads the payload of a compact JWS as a JSON object, without checking its signature: what a verifier reads first to learn
 * which key and which documents to fetch.
 *
 * @remarks
 * The payload is the canonical base64url of UTF-8 text, which must be a JSON object. Its levels and its tokens are counted
 * before it is parsed, so that a payload of a million empty arrays is refused without building anything. The caller limits the
 * length of the JWS.
 *
 * @param compact - The compact JWS.
 * @param maxTokens - The most tokens of JSON that the payload may have.
 * @returns The payload.
 * @throws `LimitError` when the payload nests more than 64 levels or has more than `maxTokens` tokens.
 * @throws `DataError` when the JWS is no compact JWS, its payload is detached, or the payload is not canonical base64url of
 * UTF-8 text of a JSON object.
 */
export function readJwsPayload(compact: string, maxTokens: number): Readonly<Record<string, unknown>> {
  if (!v.is(jws, compact)) throw new DataError("The JWS is not a compact JWS of three parts of base64url characters.");
  const part = compact.slice(compact.indexOf(".") + 1, compact.lastIndexOf("."));
  if (part === "") throw new DataError("The JWS has a detached payload, which holds no assertion.");
  const bytes = decodeBase64url(part);
  if (bytes === undefined) throw new DataError("The payload of the JWS is not canonical base64url without padding.");
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch (error) {
    throw new DataError("The payload of the JWS is not UTF-8.", { cause: error });
  }
  // The levels and the tokens are counted before the parser builds anything.
  const limits = { maxDepth: MAX_JSON_DEPTH, maxTokens };
  const value = parseJsonText(text, limits, jsonRefusals("The payload of the JWS", limits));
  if (!isRecord(value)) throw new DataError("The payload of the JWS is not a JSON object.");
  return value;
}
