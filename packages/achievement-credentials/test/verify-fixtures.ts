import { signCompactJws } from "@interopkit/core";
import type { IssuableCredential, VerificationResult } from "../src/index.js";
import { signCredentialJwt } from "../src/jwt/index.js";
import { achievementCredential } from "./fixtures.js";
import { signerOf, type TestKey } from "./key-fixtures.js";
import { METHOD, signer } from "./status-fixtures.js";

export const encoder = new TextEncoder();
export const badge = () => achievementCredential() as unknown as IssuableCredential;

/** A JWS of the issuer for a credential. */
export const jwsOf = (credential: unknown = badge(), by = signer) =>
  signCredentialJwt(credential as IssuableCredential, by, { kid: METHOD });

/** The outcome of each check, by name. */
export const outcomes = (result: VerificationResult) =>
  Object.fromEntries(result.checks.map(({ check, outcome }) => [check, outcome]));

/** The detail of a check. */
export const detailOf = (result: VerificationResult, name: string) =>
  result.checks.find(({ check }) => check === name)?.detail ?? "";

export const ALL_PASSED = {
  format: "passed",
  schema: "skipped",
  proof: "passed",
  issuer: "passed",
  refresh: "skipped",
  status: "skipped",
  validity: "passed",
  recipient: "skipped",
};

/** Signs a payload the way a forger would: any claims, any header, any key. */
export async function forge(payload: unknown, key: TestKey, header: Record<string, unknown> = { kid: METHOD }) {
  return await signCompactJws({ typ: "JWT", ...header }, encoder.encode(JSON.stringify(payload)), signerOf(key));
}

/** The `id` of the credential of a result, which a credential of Open Badges 2.0 holds in its assertion. */
export const idOf = ({ credential }: VerificationResult) =>
  credential !== undefined && "id" in credential ? credential.id : undefined;
