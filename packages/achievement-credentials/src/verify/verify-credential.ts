import { DataError } from "@interopkit/core";
import { describe, isRecord } from "@interopkit/core/checks";
import type { VerificationResult } from "../model/index.js";
import { contextOf } from "./context.js";
import { preparedOf } from "./input.js";
import { type VerifyOptions, verifySettings } from "./options.js";
import { checkOf, resultOf } from "./result.js";
import { verifyOne } from "./verify-one.js";

/**
 * Verifies a credential of Open Badges 3.0 or CLR 2.0 as the specifications say: the form, the schema, the proof, the issuer's
 * hold on the key, the refresh, the status, the validity and, when the recipient is known, the recipient, then its endorsements
 * and, for a CLR, the credentials it holds.
 *
 * @remarks
 * The result is a value. `verified` is true when every check passed or did not apply, and so does every endorsement and every
 * held credential. `credential` is what the proof secures and is set when the proof is valid and the issuer check did not fail:
 * read `verified` before trusting it. Every check is in `checks`, in the order of Open Badges 9; one that did not run says
 * which check stopped it. A credential whose proof does not verify costs no fetch of an address that it names.
 *
 * A key counts only when the issuer publishes it (`verifyIssuerKey`), unless `allowUnboundKeys` is set. A status list is
 * verified as strictly: its proof, its issuer and its key. A schema other than 1EdTech's is fetched, and refused when it runs a
 * regular expression. A host that wants a deadline for the whole call passes a `signal`: a CLR may hold 1,000 credentials, and
 * each may name a status list, a refresh service and a schema.
 *
 * @param input - A credential as an object, a compact JWS, or what `readPng` and `readSvg` return.
 * @param options - The key resolver, the clock and the other options.
 * @returns The result of the verification.
 * @throws `DataError` when the input is no object and no string, or an option is not valid.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/#verification-and-validation | Open Badges 3.0, 9}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/#verification-and-validation | CLR 2.0, 8}
 */
export async function verifyCredential(input: string | object, options: VerifyOptions): Promise<VerificationResult> {
  const settings = verifySettings(options);
  if (typeof input !== "string" && !isRecord(input)) {
    throw new DataError(`The input must be a credential as an object or a compact JWS, found ${describe(input)}.`);
  }
  settings.jwt.signal?.throwIfAborted();
  const prepared = preparedOf(input, settings);
  if ("reason" in prepared) {
    return resultOf({ format: checkOf("format", "failed", prepared.reason) }, settings.unavailable);
  }
  return await verifyOne(prepared.prepared, "root", contextOf(settings));
}
