import { DataError } from "@interopkit/core";
import { copyJson, describe, hasMoreTokensThan, isRecord, MAX_JSON_DEPTH } from "@interopkit/core/checks";
import * as v from "valibot";
import { parseJsonText } from "../json-text.js";
import { readCredential } from "../read/index.js";
import { jws } from "../read/internal.js";
import type { BakedKind } from "./formats.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** The credential as an image holds it: its kind, and the text that is written. */
export interface CredentialText {
  readonly kind: BakedKind;
  /** The compact JWS, or the JSON of the credential. */
  readonly text: string;
  /** Whether the text is a compact JWS. */
  readonly signed: boolean;
}

/** Decodes the base64url text of a part of a compact JWS to the text it holds. */
function decodePayload(payload: string): string {
  try {
    const binary = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
    return UTF8.decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    throw new DataError("The payload of the compact JWS is not base64url text of UTF-8.");
  }
}

/** Reads the class names that the `type` of a value holds. */
function typeNames(value: unknown): readonly unknown[] {
  const type = isRecord(value) ? value.type : undefined;
  return Array.isArray(type) ? type : [type];
}

/**
 * Tells which kind a compact JWS holds from the `type` in its payload: the claims of the credential (Open Badges 3.0 section
 * 8.2.4), or its `vc` claim under the Verifiable Credentials Data Model 1.1. Nothing else of the JWS is read or checked.
 */
function kindOfJws(compact: string, maxTokens: number): BakedKind {
  // A compact JWS has exactly two dots (the `jws` schema), so what lies between them is the payload.
  const payload = decodePayload(compact.slice(compact.indexOf(".") + 1, compact.lastIndexOf(".")));
  // The tokens and the levels are counted before the parser builds anything.
  const parsed = parseJsonText(payload, { maxDepth: MAX_JSON_DEPTH, maxTokens }, "The payload of the compact JWS");
  if ("reason" in parsed) throw new DataError(parsed.reason);
  const claims = parsed.value;
  const names = typeNames(isRecord(claims) && claims.vc !== undefined ? claims.vc : claims);
  if (!names.some((name) => typeof name === "string")) {
    throw new DataError("The payload of the compact JWS has no type, so it is not a credential.");
  }
  return names.includes("ClrCredential") ? "clr" : "badge";
}

/**
 * Checks the credential to bake and finds what an image holds of it: a compact JWS as it is, or the JSON of a credential that
 * the readers accept. The object is copied first, so that a getter or a `toJSON` cannot change what was checked.
 *
 * @param credential - The credential, as a host passes it from JavaScript.
 * @param maxTokens - The most tokens of JSON that the credential may have.
 * @throws `DataError` when the credential is neither a compact JWS nor a credential that `readCredential` accepts, or has more
 * than `maxTokens` tokens of JSON.
 */
export function textToBake(credential: unknown, maxTokens: number): CredentialText {
  if (typeof credential === "string") {
    if (!v.is(jws, credential)) {
      throw new DataError(
        "The credential given as text must be a compact JWS of three parts of base64url characters. Pass a credential that is not signed as an object.",
      );
    }
    return { kind: kindOfJws(credential, maxTokens), text: credential, signed: true };
  }
  if (!isRecord(credential)) {
    throw new DataError(`The credential must be a compact JWS or an object, found ${describe(credential)}.`);
  }
  const copy = copyJson(credential, "The credential");
  if ("problem" in copy) throw new DataError(`${copy.problem}.`);
  const text = JSON.stringify(copy.value);
  // Counted before the readers walk the value, which costs them a copy and the memory of their findings.
  if (hasMoreTokensThan(text, maxTokens)) {
    throw new DataError(
      `The credential has more than the ${maxTokens} tokens of JSON that the option maxTokens allows.`,
    );
  }
  const read = readCredential(copy.value);
  return { kind: typeNames(read).includes("ClrCredential") ? "clr" : "badge", text, signed: false };
}

/**
 * Reads a compact JWS that an image holds.
 *
 * @param text - The text of the attribute or the chunk.
 * @throws `DataError` when the text is not a compact JWS.
 */
export function bakedJws(text: string): string {
  const trimmed = text.trim();
  if (v.is(jws, trimmed)) return trimmed;
  throw new DataError("The credential in the image is not a compact JWS of three parts of base64url characters.");
}

/**
 * Reads the JSON of a credential that an image holds, as an object that nothing has checked yet.
 *
 * @param text - The text of the element or the chunk.
 * @param maxTokens - The most tokens of JSON that the credential may have.
 * @throws `DataError` when the text is not the JSON of an object, nests too deep, or has more than `maxTokens` tokens.
 */
export function bakedJson(text: string, maxTokens: number): object {
  const parsed = parseJsonText(text.trim(), { maxDepth: MAX_JSON_DEPTH, maxTokens }, "The credential in the image");
  if ("reason" in parsed) {
    throw new DataError(parsed.overLimit ? parsed.reason : "The credential in the image is not the JSON of an object.");
  }
  if (isRecord(parsed.value)) return parsed.value;
  throw new DataError("The credential in the image is not the JSON of an object.");
}

/**
 * Reads what a chunk of a PNG holds: the JSON of a credential if it starts like an object, else a compact JWS.
 *
 * @param text - The text of the chunk.
 * @param maxTokens - The most tokens of JSON that the credential may have.
 * @throws `DataError` when the text is neither.
 */
export function bakedValue(text: string, maxTokens: number): string | object {
  return text.trimStart().startsWith("{") ? bakedJson(text, maxTokens) : bakedJws(text);
}
