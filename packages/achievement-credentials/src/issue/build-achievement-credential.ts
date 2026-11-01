import { type AchievementCredential, CONTEXTS } from "../model/index.js";
import { CLASS_SCHEMAS, ruleIssues } from "../read/internal.js";
import { finish, readInput } from "./finish.js";
import { achievementCredentialInputSchema } from "./input-schemas.js";
import type { AchievementCredentialInput } from "./inputs.js";
import { ACHIEVEMENT_CREDENTIAL_SCHEMA } from "./schema-urls.js";

/**
 * Builds an AchievementCredential of Open Badges 3.0 under the Verifiable Credentials Data Model 2.0: writes the contexts, the
 * types and the `credentialSchema` of the official JSON Schema, and checks the result as `readCredential` does.
 *
 * @remarks
 * The contexts are those of the Verifiable Credentials Data Model 2.0 and Open Badges 3.0.3, the types are
 * `VerifiableCredential` and `OpenBadgeCredential`, and the subject has the type `AchievementSubject`. The result has no proof:
 * a signer adds one. It shares nothing with the input. The `id` is an absolute URI, which the specification leaves open; a
 * credential whose address is relative cannot be compared or fetched.
 *
 * @param input - The credential. It is JSON that nests at most 64 levels.
 * @returns The credential.
 * @throws `DataError` that names every fault of the input or of the credential, such as a subject with neither an `id` nor an
 * `identifier`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#achievementcredential | Open Badges 3.0, AchievementCredential}
 */
export function buildAchievementCredential(input: AchievementCredentialInput): AchievementCredential {
  const { id, subject, achievement, ...rest } = readInput(achievementCredentialInputSchema, input, "The input");
  const written = {
    "@context": [CONTEXTS.credentialsV2, CONTEXTS.openBadges],
    id,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    ...rest,
    credentialSubject: { type: ["AchievementSubject"], ...subject, achievement },
    credentialSchema: [ACHIEVEMENT_CREDENTIAL_SCHEMA],
  };
  return finish(CLASS_SCHEMAS.achievementCredentialSchema, written, "The credential", ruleIssues);
}
