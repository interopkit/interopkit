import { DataError, type Signer, signCompactJws } from "@interopkit/core";
import { isRecord } from "@interopkit/core/checks";
import type { IssuableCredential } from "../model/index.js";
import { credentialOrReason } from "../read/internal.js";
import { ADDED_CLAIMS, claimsOf } from "./claims.js";
import { type JwtSignOptions, signSettings } from "./options.js";

const encoder = new TextEncoder();

/** The properties that the claims of a JWT use: a credential that holds one would collide with it. */
const RESERVED_PROPERTIES = [...ADDED_CLAIMS, "aud", "vc"];

/** Tells whether a credential is a CLR, by its `type`. */
function isClr(credential: Readonly<Record<string, unknown>>): boolean {
  return Array.isArray(credential.type) && credential.type.includes("ClrCredential");
}

/** Replaces the credentials nested in a CLR with compact JWS, as CLR 7.2.4.1 asks, signing those that are not. */
async function withNestedJws(
  credential: Readonly<Record<string, unknown>>,
  sign: (nested: IssuableCredential) => Promise<string>,
  signNested: boolean,
): Promise<Readonly<Record<string, unknown>>> {
  const subject = credential.credentialSubject;
  if (!isRecord(subject) || !Array.isArray(subject.verifiableCredential)) return credential;
  const nested: unknown[] = [];
  for (const [index, member] of subject.verifiableCredential.entries()) {
    if (typeof member === "string") {
      nested.push(member);
    } else if (!signNested) {
      throw new DataError(
        `The credential credentialSubject.verifiableCredential[${index}] is not a compact JWS, which a CLR needs before it is signed as a JWT (CLR 7.2.4.1). Sign it first, or ask for signNested.`,
      );
    } else {
      nested.push(await sign(member as IssuableCredential));
    }
  }
  return { ...credential, credentialSubject: { ...subject, verifiableCredential: nested } };
}

/**
 * Signs a credential as a JWT, as Open Badges 8.2 asks.
 *
 * @remarks
 * The payload is the credential with the claims `iss` (the issuer's `id`), `jti` (its `id`), `nbf` (`validFrom`), `sub` (the
 * subject's `id`) and `exp` (`validUntil`), and the header names the algorithm of the signer, the key by `kid` or `jwk`, and
 * `typ`. The credential is checked as `readCredential` checks it before it is signed. A CLR is signed with its nested
 * credentials as compact JWS: one that is not is refused, or signed with the same signer and header when `signNested` is set,
 * and the payload is then a `ClrCredentialJwtPayload`. The signer holds the key: a KMS or an HSM signs as a `CryptoKey` does,
 * and the algorithm is the signer's (Open Badges 8.2.1 asks for RS256 at least).
 *
 * @param credential - The credential to sign.
 * @param signer - Signs the bytes.
 * @param options - The key that verifies the JWT, as `kid` or `jwk`, and the other options of the signature.
 * @returns The compact JWS.
 * @throws `DataError` when the credential or an option is not valid, a credential holds a property that a claim uses, or a
 * nested credential of a CLR is not a compact JWS and `signNested` is not set.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/#proof-formats | Open Badges 3.0, JSON Web Token proof}
 */
export async function signCredentialJwt(
  credential: IssuableCredential,
  signer: Signer,
  options: JwtSignOptions,
): Promise<string> {
  const { header, signNested, signal } = signSettings(options);
  const sign = (value: IssuableCredential): Promise<string> =>
    signCredentialJwt(value, signer, { ...options, signNested: false });
  const record: Readonly<Record<string, unknown>> = isRecord(credential) ? credential : {};
  const prepared = isClr(record) ? await withNestedJws(record, sign, signNested) : record;
  const reserved = RESERVED_PROPERTIES.find((name) => name in prepared);
  if (reserved !== undefined) {
    throw new DataError(`The credential has a property ${reserved}, which a claim of the JWT would overwrite.`);
  }
  const checked = credentialOrReason(prepared, "The credential", isClr(prepared));
  if ("reason" in checked) throw new DataError(checked.reason);
  const payload = encoder.encode(JSON.stringify({ ...prepared, ...claimsOf(checked.value) }));
  return await signCompactJws(header, payload, signer, signal === undefined ? undefined : { signal });
}
