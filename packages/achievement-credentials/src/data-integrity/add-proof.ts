import { DataIntegrityProof } from "@interop/data-integrity-proof";
import { eddsaRdfc2022 } from "@interop/ed25519-signature";
import jsigs from "@interop/jsonld-signatures";
import { DataError, readClock, type Signer } from "@interopkit/core";
import { checkRecord, describe } from "@interopkit/core/checks";
import { addBaseProof } from "@interopkit/selective-disclosure";
import type { IssuableCredential } from "../model/index.js";
import { credentialOrReason } from "../read/internal.js";
import { documentLoaderOf, failOperation } from "./document-loader.js";
import { defaultMandatoryPointers } from "./mandatory-pointers.js";
import { type ProofOptions, proofSettings } from "./options.js";
import { withProofList } from "./proof-list.js";

/** The JOSE algorithm of the signer, and the name that the Data Integrity library gives the same algorithm. */
const ED25519 = { jose: "EdDSA", library: "Ed25519" } as const;

/** Writes a time as the `created` of a proof: UTC, with whole seconds. */
function createdAt(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/u, "Z");
}

/** Checks that a signer can sign a proof: it names its key, which is the verification method of the proof. */
function proofKeyId(signer: Signer, algorithm: string): string {
  checkRecord(signer, "The signer must be an object");
  if (signer.algorithm !== algorithm) {
    throw new DataError(
      `The signer must sign with ${algorithm} for this cryptosuite, found ${describe(signer.algorithm)}.`,
    );
  }
  if (typeof signer.keyId !== "string" || signer.keyId === "") {
    throw new DataError("The keyId of the signer must be the verification method of the proof, a non-empty string.");
  }
  return signer.keyId;
}

/**
 * Signs a credential with a Data Integrity proof.
 *
 * @remarks
 * `eddsa-rdfc-2022` signs the canonical form of the credential with Ed25519 and writes a proof that names the signer's `keyId`
 * as its verification method and the clock's time as `created`. `ecdsa-sd-2023` writes a base proof with ES256 for a holder to
 * derive disclosures from; it never goes to a verifier (`verifyProof` refuses it). The credential is checked as the readers
 * check it before it is signed, every context is loaded through `contexts` and no other way, and the result is a new
 * credential: the input is not changed.
 *
 * @param credential - The credential to sign.
 * @param signer - Signs the bytes, and its `keyId` is the verification method.
 * @param options - The cryptosuite, the loader of contexts and the clock.
 * @returns The credential with a proof added to any it had.
 * @throws `DataError` when the credential, the signer or an option is not valid, or a context is not pinned.
 * @throws `ServiceError` when a context cannot be fetched.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.w3.org/TR/vc-di-eddsa/ | Data Integrity EdDSA Cryptosuites}
 */
export async function addProof(
  credential: IssuableCredential,
  signer: Signer,
  options: ProofOptions,
): Promise<IssuableCredential> {
  const settings = proofSettings(options);
  settings.signal?.throwIfAborted();
  const checked = credentialOrReason(credential, "The credential");
  if ("reason" in checked) throw new DataError(checked.reason);
  const document = { ...structuredClone(credential) };
  const { signal, contexts } = settings;
  const withSignal = signal === undefined ? {} : { signal };
  try {
    if (settings.cryptosuite === "ecdsa-sd-2023") {
      proofKeyId(signer, "ES256");
      const signed = await addBaseProof(document, {
        signer,
        contexts,
        created: createdAt(readClock(settings.clock)),
        mandatoryPointers: settings.mandatoryPointers ?? defaultMandatoryPointers(document),
        ...withSignal,
      });
      return withProofList(signed) as unknown as IssuableCredential;
    }
    const keyId = proofKeyId(signer, ED25519.jose);
    const suite = new DataIntegrityProof({
      cryptosuite: eddsaRdfc2022,
      date: readClock(settings.clock),
      signer: {
        id: keyId,
        algorithm: ED25519.library,
        sign: ({ data }: { data: Uint8Array }) => signer.sign(data, withSignal),
      },
    });
    const signed: unknown = await jsigs.sign(document, {
      suite,
      purpose: new jsigs.purposes.AssertionProofPurpose(),
      documentLoader: documentLoaderOf(contexts, signal),
    });
    return withProofList(signed as Readonly<Record<string, unknown>>) as unknown as IssuableCredential;
  } catch (error) {
    return failOperation(error, signal);
  }
}
