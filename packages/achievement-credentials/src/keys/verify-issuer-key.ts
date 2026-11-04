import { type CallOptions, raceAbort, ServiceError } from "@interopkit/core";
import { checkNonEmptyString, checkRecord, methodsSchema, parseWith, strictRecord } from "@interopkit/core/checks";
import type { KeyResolver, VerificationCheck, VerificationKey } from "../model/index.js";
import { optionsOf } from "../option-schemas.js";
import { thumbprintOf } from "./jwk.js";

/** The options of `verifyIssuerKey`. */
export interface VerifyIssuerKeyOptions extends CallOptions {
  /** Reads what the issuer publishes. */
  readonly keys: KeyResolver;
}

const optionsSchema = strictRecord({ keys: methodsSchema<KeyResolver>("issuerKeys"), ...optionsOf("signal") });

const issuerCheck = (outcome: VerificationCheck["outcome"], detail: string): VerificationCheck => ({
  check: "issuer",
  outcome,
  detail,
});

/** Finds why a key cannot belong to an issuer from what it says itself, or `undefined` when it says nothing against it. */
function selfContradiction(key: VerificationKey, issuer: string): VerificationCheck | undefined {
  if (key.iss !== undefined && key.iss !== issuer) {
    return issuerCheck("failed", `The key names the issuer ${key.iss} in its iss member, not ${issuer}.`);
  }
  if (key.controller !== undefined && key.controller !== issuer) {
    return issuerCheck("failed", `The key is controlled by ${key.controller}, not by the issuer ${issuer}.`);
  }
  return undefined;
}

/** Finds the key that an issuer publishes for signing credentials and that has the thumbprint, or `undefined`. */
async function publishedWith(
  thumbprint: string,
  published: readonly VerificationKey[],
  issuer: string,
): Promise<VerificationKey | undefined> {
  for (const candidate of published) {
    if (!candidate.relationships.includes("assertionMethod")) continue;
    if (candidate.iss !== undefined && candidate.iss !== issuer) continue;
    if ((await thumbprintOf(candidate.publicKeyJwk)) === thumbprint) return candidate;
  }
  return undefined;
}

/**
 * Checks that a key belongs to an issuer: that the issuer publishes it for signing credentials.
 *
 * @remarks
 * A signature proves nothing about an issuer until its key is bound to the issuer's `id`. The key is bound when an RFC 7638
 * thumbprint of it equals that of a key the issuer publishes under `assertionMethod`: in the controller document or DID
 * document at the issuer's `id`, or in the JWK Set at `/.well-known/jwks.json` of its host. The key's `controller`, when it has
 * one, must be the issuer; a key with an `iss`, as the key and as the published one, must name the issuer, which keeps the
 * issuers of a shared platform apart. An issuer whose `id` is a `did:jwk` publishes the key that the DID holds.
 * Implementation Guide 3.1.12 says that no standard assures where a key comes from; these are the rules it recommends.
 *
 * @param key - The key that verified a proof.
 * @param issuer - The `id` of the issuer of the credential.
 * @param options - The resolver that reads what the issuer publishes, and the `signal` that ends the caller's wait.
 * @returns The `issuer` check: `passed` when the key is bound, `failed` with the reason when it is not, and `unavailable`
 * when what the issuer publishes could not be read.
 * @throws `DataError` when an argument is not valid.
 * @throws The `reason` of the signal when it aborts.
 */
export async function verifyIssuerKey(
  key: VerificationKey,
  issuer: string,
  options: VerifyIssuerKeyOptions,
): Promise<VerificationCheck> {
  checkRecord(key, "The key must be an object");
  checkNonEmptyString(issuer, "The issuer");
  const { keys, signal } = parseWith(optionsSchema, options, "The options of verifyIssuerKey");
  const contradiction = selfContradiction(key, issuer);
  if (contradiction !== undefined) return contradiction;
  let published: readonly VerificationKey[];
  try {
    // A resolver is the host's port and may ignore the signal it is given: the wait ends at the signal either way.
    const call = signal === undefined ? undefined : { signal };
    published = await raceAbort(keys.issuerKeys(issuer, call), { signal });
  } catch (error) {
    if (error instanceof ServiceError) {
      return issuerCheck("unavailable", `The keys of the issuer ${issuer} could not be read: ${error.message}`);
    }
    throw error;
  }
  const found = await publishedWith(await thumbprintOf(key.publicKeyJwk), published, issuer);
  return found === undefined
    ? issuerCheck("failed", `The issuer ${issuer} does not publish this key for signing credentials.`)
    : issuerCheck("passed", `The issuer ${issuer} publishes the key ${found.id} for signing credentials.`);
}
