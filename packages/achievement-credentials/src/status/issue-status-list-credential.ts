import { DataError, type Signer } from "@interopkit/core";
import { signCredentialJwt } from "../jwt/index.js";
import type { VerifiableCredential } from "../model/index.js";
import { checkStatusList } from "./bitstring.js";
import { encodeList } from "./encoded-list.js";
import { checkInput, issueSettings, type StatusIssueOptions, type StatusListCredentialInput } from "./options.js";

/** The contexts of a status list credential: the Verifiable Credentials Data Model 2.0 defines its terms. */
const CONTEXT = "https://www.w3.org/ns/credentials/v2";

/**
 * Issues a status list credential: the list, secured by the issuer.
 *
 * @remarks
 * The credential has the types `VerifiableCredential` and `BitstringStatusListCredential`, and a subject of type
 * `BitstringStatusList` with the purpose and the `encodedList` (GZIP, then multibase base64url). It is secured as a compact JWS
 * by default, with the signer's `keyId` as the `kid`, or with a Data Integrity proof (`eddsa-rdfc-2022`) that names the
 * `keyId` as its method. The issuer of the list is the issuer of the credentials that name it unless a verifier is told
 * another in `statusIssuers`.
 *
 * @param input - The address, the issuer, the dates, the purpose and the list.
 * @param signer - Signs the credential; its `keyId` names the key.
 * @param options - How the credential is secured, with the clock and the contexts for a Data Integrity proof.
 * @returns The compact JWS, or the credential with its proof.
 * @throws `DataError` when an argument is not valid or the signer has no `keyId`.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.w3.org/TR/vc-bitstring-status-list/ | Bitstring Status List v1.0}
 */
export async function issueStatusListCredential(
  input: StatusListCredentialInput,
  signer: Signer,
  options: StatusIssueOptions,
): Promise<string | VerifiableCredential> {
  checkInput(input);
  checkStatusList(input.list);
  const settings = issueSettings(options);
  const keyId = signer?.keyId;
  if (typeof keyId !== "string" || keyId === "") {
    throw new DataError(
      "The keyId of the signer must be the key that verifies the status list credential, a non-empty string.",
    );
  }
  const subject = {
    id: `${input.id}#list`,
    type: "BitstringStatusList",
    statusPurpose: input.purpose,
    encodedList: await encodeList(input.list),
    ...(input.ttlMs === undefined ? {} : { ttl: input.ttlMs }),
  };
  const credential: VerifiableCredential = {
    "@context": [CONTEXT],
    id: input.id,
    type: ["VerifiableCredential", "BitstringStatusListCredential"],
    issuer: input.issuer,
    validFrom: input.validFrom,
    ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
    credentialSubject: subject,
  };
  const withSignal = settings.signal === undefined ? {} : { signal: settings.signal };
  if (settings.proof === "jwt") return await signCredentialJwt(credential, signer, { kid: keyId, ...withSignal });
  // The proof is loaded only when it is asked for, so that a verifier that holds JWTs never loads JSON-LD.
  const { addProof } = await import("../data-integrity/index.js");
  return await addProof(credential, signer, { contexts: settings.contexts, clock: settings.clock, ...withSignal });
}
