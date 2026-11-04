import { isRecord } from "@interopkit/core/checks";
import { isCompactJws } from "../compact-jws.js";
import type { VerifySettings } from "./options.js";

/** What the verification of a credential starts from: a compact JWS, or a credential as an object. */
export type Prepared =
  | { readonly form: "jws"; readonly jws: string }
  | { readonly form: "object"; readonly value: Readonly<Record<string, unknown>> };

/** What a verification starts from: a credential, or the address of a hosted Open Badges 2.0 assertion. */
export type Input = Prepared | { readonly form: "address"; readonly url: string };

/** The kinds of what `readPng` and `readSvg` return: a credential of Open Badges 3.0 or CLR 2.0, or an Open Badges 2.0 assertion. */
const BAKED_KINDS: readonly string[] = ["badge", "clr", "badge-v2"];

/** Unwraps what `readPng` and `readSvg` return: an object with the `kind` of the image and the `credential` in it. */
function unwrapped(input: unknown): unknown {
  return isRecord(input) && typeof input.kind === "string" && BAKED_KINDS.includes(input.kind) && "credential" in input
    ? input.credential
    : input;
}

/**
 * Tells what a value is to verify: a credential in a compact JWS or as an object, or the address of a hosted Open Badges 2.0
 * assertion, also inside what `readPng` and `readSvg` return. The size of a string is checked before anything reads it.
 *
 * @returns The input as it is verified, or the sentence that says why it is no input.
 */
export function preparedOf(
  input: unknown,
  settings: VerifySettings,
): { readonly prepared: Input } | { readonly reason: string } {
  const value = unwrapped(input);
  if (typeof value === "string") {
    const { maxInputBytes } = settings.jwt;
    if (value.length > maxInputBytes) {
      return { reason: `The input has ${value.length} characters, more than the ${maxInputBytes} that it may have.` };
    }
    // The form of a compact JWS, which `inspectJwt` checks further.
    if (isCompactJws(value)) return { prepared: { form: "jws", jws: value } };
    if (/^https?:\/\//u.test(value)) return { prepared: { form: "address", url: value } };
    return {
      reason:
        "The input is a string that is neither a compact JWS nor an address: parse JSON text into an object first.",
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
