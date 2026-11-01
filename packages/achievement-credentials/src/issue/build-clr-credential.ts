import {
  type AchievementCredential,
  type ClrCredential,
  type ClrCredentialJwtPayload,
  CONTEXTS,
} from "../model/index.js";
import { CLASS_SCHEMAS, ruleIssues } from "../read/internal.js";
import { finish, readInput } from "./finish.js";
import { clrCredentialInputSchema } from "./input-schemas.js";
import type { ClrCredentialInput } from "./inputs.js";
import { CLR_CREDENTIAL_SCHEMA } from "./schema-urls.js";

/**
 * Builds a ClrCredential of CLR 2.0 under the Verifiable Credentials Data Model 2.0: writes the contexts, the types, the
 * subject that holds the credentials, the achievements and the associations, and the `credentialSchema` of the official JSON Schema, and checks
 * the result as `readCredential` does.
 *
 * @remarks
 * The credentials are objects, or all of them compact JWS strings for a CLR that is signed as a VC-JWT after its credentials
 * were signed (CLR 7.2.4.1); with strings the result is the payload of that JWT and not a ClrCredential. The result has no
 * proof: a signer adds one. It shares nothing with the input.
 *
 * @param input - The CLR. It is JSON that nests at most 64 levels.
 * @returns The CLR.
 * @throws `DataError` that names every fault of the input or of the CLR, such as a subject with neither an `id` nor an
 * `identifier`, or a list of credentials that is empty.
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/#clrcredential | CLR 2.0, ClrCredential}
 */
export function buildClrCredential(input: ClrCredentialInput): ClrCredential;
export function buildClrCredential(input: ClrCredentialInput<string>): ClrCredentialJwtPayload;
export function buildClrCredential(
  input: ClrCredentialInput<AchievementCredential | string>,
): ClrCredential | ClrCredentialJwtPayload {
  const { id, subject, credentials, achievements, associations, ...rest } = readInput(
    clrCredentialInputSchema,
    input,
    "The input",
  );
  const written = {
    "@context": [CONTEXTS.credentialsV2, CONTEXTS.clr, CONTEXTS.openBadges],
    id,
    type: ["VerifiableCredential", "ClrCredential"],
    ...rest,
    credentialSubject: {
      type: ["ClrSubject"],
      ...subject,
      verifiableCredential: credentials,
      ...(achievements === undefined ? {} : { achievement: achievements }),
      ...(associations === undefined ? {} : { association: associations }),
    },
    credentialSchema: [CLR_CREDENTIAL_SCHEMA],
  };
  return credentials.some((credential) => typeof credential === "string")
    ? finish(CLASS_SCHEMAS.clrCredentialJwtPayloadSchema, written, "The credential", ruleIssues)
    : finish(CLASS_SCHEMAS.clrCredentialSchema, written, "The credential", ruleIssues);
}
