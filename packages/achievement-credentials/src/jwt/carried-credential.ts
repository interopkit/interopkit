import { isRecord } from "@interopkit/core/checks";
import type { JsonTextRefusal } from "../json-text.js";
import type { AnyVerifiableCredential } from "../model/index.js";
import { credentialOrReason, readJwsPayload } from "../read/internal.js";
import { ADDED_CLAIMS, dateTimeOf } from "./claims.js";

/** A credential read from a payload, or the sentence that says why the payload holds none. */
type Carried = { readonly value: AnyVerifiableCredential } | JsonTextRefusal;

/** Builds the credential that a payload in the `vc` claim form carries (VC Data Model 1.1, section 6.3.1): the claims fill what `vc` leaves out. */
function foldClaims(payload: Readonly<Record<string, unknown>>, vc: Readonly<Record<string, unknown>>) {
  const { iss, jti, nbf, exp, sub } = payload;
  const subject = vc.credentialSubject;
  return {
    ...vc,
    ...(vc.issuer === undefined && iss !== undefined ? { issuer: iss } : {}),
    ...(vc.id === undefined && typeof jti === "string" ? { id: jti } : {}),
    ...(vc.issuanceDate === undefined && typeof nbf === "number" ? { issuanceDate: dateTimeOf(nbf) } : {}),
    ...(vc.expirationDate === undefined && typeof exp === "number" ? { expirationDate: dateTimeOf(exp) } : {}),
    ...(typeof sub === "string" && isRecord(subject) && subject.id === undefined
      ? { credentialSubject: { ...subject, id: sub } }
      : {}),
  };
}

/** Returns the credential that a payload carries: in the `vc` claim, or the payload itself less the claims that repeat it. */
export function carriedCredential(payload: Readonly<Record<string, unknown>>): unknown {
  if (isRecord(payload.vc)) return foldClaims(payload, payload.vc);
  return Object.fromEntries(Object.entries(payload).filter(([name]) => !ADDED_CLAIMS.includes(name)));
}

/** Reads the credential of a payload, as a CLR whose nested credentials are compact JWS when its type says it is a CLR. */
export function readCarried(candidate: unknown): Carried {
  const types = isRecord(candidate) ? candidate.type : undefined;
  const isClr = Array.isArray(types) && types.includes("ClrCredential");
  return credentialOrReason(candidate, "The credential in the JWT", isClr);
}

/**
 * Reads the credential that a compact JWS carries, in any of the payload forms that `readCredentialJwt` reads, without checking
 * the header or the signature: what a store of credentials compares, once a verifier or nobody has judged the proof.
 *
 * @param jws - The compact JWS, whose length the caller has limited.
 * @param maxTokens - The most tokens of JSON that the payload may have, counted before it is parsed.
 * @returns The credential, or the sentence that says why the JWS carries none.
 */
export function credentialInJws(jws: string, maxTokens: number): Carried {
  const payload = readJwsPayload(jws, maxTokens);
  return "reason" in payload ? payload : readCarried(carriedCredential(payload.value));
}
