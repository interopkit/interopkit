import { CONTEXTS, type EndorsementCredential } from "../model/index.js";
import { CLASS_SCHEMAS, ruleIssues } from "../read/internal.js";
import { finish, readInput } from "./finish.js";
import { endorsementCredentialInputSchema } from "./input-schemas.js";
import type { EndorsementCredentialInput } from "./inputs.js";
import { ENDORSEMENT_CREDENTIAL_SCHEMA } from "./schema-urls.js";

/**
 * Builds an EndorsementCredential of Open Badges 3.0 under the Verifiable Credentials Data Model 2.0: writes the contexts, the
 * types, the subject that names what is endorsed and the `credentialSchema` of the official JSON Schema, and checks the
 * result as `readCredential` does.
 *
 * @remarks
 * The result has no proof: a signer adds one. It shares nothing with the input.
 *
 * @param input - The endorsement. It is JSON that nests at most 64 levels.
 * @returns The credential.
 * @throws `DataError` that names every fault of the input or of the credential.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#endorsementcredential | Open Badges 3.0, EndorsementCredential}
 */
export function buildEndorsementCredential(input: EndorsementCredentialInput): EndorsementCredential {
  const { id, endorses, comment, ...rest } = readInput(endorsementCredentialInputSchema, input, "The input");
  const written = {
    "@context": [CONTEXTS.credentialsV2, CONTEXTS.openBadges, CONTEXTS.extensions],
    id,
    type: ["VerifiableCredential", "EndorsementCredential"],
    ...rest,
    credentialSubject: {
      id: endorses,
      type: ["EndorsementSubject"],
      ...(comment === undefined ? {} : { endorsementComment: comment }),
    },
    credentialSchema: [ENDORSEMENT_CREDENTIAL_SCHEMA],
  };
  return finish(CLASS_SCHEMAS.endorsementCredentialSchema, written, "The credential", ruleIssues);
}
