import { DataError } from "@interopkit/core";
import { copyJson, describe, isRecord, MAX_JSON_DEPTH, nestsDeeperThan } from "@interopkit/core/checks";
import * as v from "valibot";
import { MAX_CREDENTIAL_CHARACTERS } from "../model/internal.js";
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

/** Refuses a credential of more characters than an image may hold of it. */
function checkLength(text: string): void {
  if (text.length > MAX_CREDENTIAL_CHARACTERS) {
    throw new DataError(
      `The credential has ${text.length} characters, more than the ${MAX_CREDENTIAL_CHARACTERS} that an image may hold of it.`,
    );
  }
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
function kindOfJws(compact: string): BakedKind {
  // A compact JWS has exactly two dots (the `jws` schema), so what lies between them is the payload.
  const payload = decodePayload(compact.slice(compact.indexOf(".") + 1, compact.lastIndexOf(".")));
  if (nestsDeeperThan(payload, MAX_JSON_DEPTH)) {
    throw new DataError(`The payload of the compact JWS nests more than ${MAX_JSON_DEPTH} levels.`);
  }
  let claims: unknown;
  try {
    claims = JSON.parse(payload);
  } catch {
    throw new DataError("The payload of the compact JWS is not JSON.");
  }
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
 * @throws `DataError` when the credential is neither a compact JWS nor a credential that `readCredential` accepts, or is
 * longer than `MAX_CREDENTIAL_CHARACTERS`.
 */
export function textToBake(credential: unknown): CredentialText {
  if (typeof credential === "string") {
    checkLength(credential);
    if (!v.is(jws, credential)) {
      throw new DataError(
        "The credential given as text must be a compact JWS of three parts of base64url characters. Pass a credential that is not signed as an object.",
      );
    }
    return { kind: kindOfJws(credential), text: credential, signed: true };
  }
  if (!isRecord(credential)) {
    throw new DataError(`The credential must be a compact JWS or an object, found ${describe(credential)}.`);
  }
  const copy = copyJson(credential, "The credential");
  if ("problem" in copy) throw new DataError(`${copy.problem}.`);
  const read = readCredential(copy.value);
  const text = JSON.stringify(copy.value);
  checkLength(text);
  return { kind: typeNames(read).includes("ClrCredential") ? "clr" : "badge", text, signed: false };
}

/**
 * Reads a compact JWS that an image holds.
 *
 * @param text - The text of the attribute or the chunk.
 * @throws `DataError` when the text is not a compact JWS, or is longer than `MAX_CREDENTIAL_CHARACTERS`.
 */
export function bakedJws(text: string): string {
  checkLength(text);
  const trimmed = text.trim();
  if (v.is(jws, trimmed)) return trimmed;
  throw new DataError("The credential in the image is not a compact JWS of three parts of base64url characters.");
}

/**
 * Reads the JSON of a credential that an image holds, as an object that nothing has checked yet.
 *
 * @param text - The text of the element or the chunk.
 * @throws `DataError` when the text is not the JSON of an object, nests too deep, or is longer than
 * `MAX_CREDENTIAL_CHARACTERS`.
 */
export function bakedJson(text: string): object {
  checkLength(text);
  const trimmed = text.trim();
  if (nestsDeeperThan(trimmed, MAX_JSON_DEPTH)) {
    throw new DataError(`The credential in the image nests more than ${MAX_JSON_DEPTH} levels of JSON.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    // Not JSON: the sentence below says so.
  }
  if (isRecord(value)) return value;
  throw new DataError("The credential in the image is not the JSON of an object.");
}

/**
 * Reads what a chunk of a PNG holds: the JSON of a credential if it starts like an object, else a compact JWS.
 *
 * @param text - The text of the chunk.
 * @throws `DataError` when the text is neither.
 */
export function bakedValue(text: string): string | object {
  return text.trimStart().startsWith("{") ? bakedJson(text) : bakedJws(text);
}
