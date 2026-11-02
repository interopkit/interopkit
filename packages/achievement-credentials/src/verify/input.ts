import { isRecord } from "@interopkit/core/checks";
import type { VerifySettings } from "./options.js";

/** What a verification starts from: a compact JWS, or a credential as an object. */
export type Prepared =
  | { readonly form: "jws"; readonly jws: string }
  | { readonly form: "object"; readonly value: Readonly<Record<string, unknown>> };

/** The shape of a compact JWS: three parts of base64url, which `inspectJwt` checks further. */
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

/** The kinds of what `readPng` and `readSvg` return that hold a credential of Open Badges 3.0 or CLR 2.0. */
const BAKED_KINDS: readonly string[] = ["badge", "clr"];

/** Unwraps what `readPng` and `readSvg` return: an object with the `kind` of the image and the `credential` in it. */
function unwrapped(input: unknown): unknown {
  return isRecord(input) && typeof input.kind === "string" && BAKED_KINDS.includes(input.kind) && "credential" in input
    ? input.credential
    : input;
}

/**
 * Tells what a value is to verify: a credential in a compact JWS or as an object, also inside what `readPng` and `readSvg`
 * return. The size of a string is checked before anything reads it.
 *
 * @returns The input as it is verified, or the sentence that says why it is no input.
 */
export function preparedOf(
  input: unknown,
  settings: VerifySettings,
): { readonly prepared: Prepared } | { readonly reason: string } {
  const value = unwrapped(input);
  if (typeof value === "string") {
    const { maxInputBytes } = settings.jwt;
    if (value.length > maxInputBytes) {
      return { reason: `The input has ${value.length} characters, more than the ${maxInputBytes} that it may have.` };
    }
    if (COMPACT_JWS.test(value)) return { prepared: { form: "jws", jws: value } };
    return {
      reason: /^https?:\/\//u.test(value)
        ? "The input is an address, which would name a hosted Open Badges 2.0 assertion; this verifier reads credentials of Open Badges 3.0 and CLR 2.0."
        : "The input is a string that is not a compact JWS: parse JSON text into an object first.",
    };
  }
  return isRecord(value)
    ? { prepared: { form: "object", value } }
    : { reason: "The input is neither a compact JWS nor a credential as an object." };
}

/**
 * Tells what an endorsement or a held credential is to verify. The readers have checked that it is a compact JWS or an object, so
 * anything else is made an empty object, which fails the `format` check like any value that is no credential.
 */
export function childOf(item: unknown): Prepared {
  if (typeof item === "string") return { form: "jws", jws: item };
  return { form: "object", value: isRecord(item) ? item : {} };
}
