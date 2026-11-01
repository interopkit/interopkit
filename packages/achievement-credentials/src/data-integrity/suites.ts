import { DataIntegrityProof } from "@interop/data-integrity-proof";
import { ecdsaRdfc2019 } from "@interop/ecdsa-signature";
import { Ed25519Signature2020, eddsaRdfc2022 } from "@interop/ed25519-signature";
import { selectiveDisclosureSuite } from "@interopkit/selective-disclosure";
import type { DataIntegritySuite } from "../model/index.js";
import { documentLoaderOf, rethrowOperational } from "./document-loader.js";

/** A cryptosuite of the adopted library. */
type Cryptosuite = ConstructorParameters<typeof DataIntegrityProof>[0]["cryptosuite"];

/** The verification method of the library, which describes a key. */
type LibraryMethod = Parameters<DataIntegrityProof["verifySignature"]>[0]["verificationMethod"];

/**
 * The verification method that a proof names, as the cryptosuites of the adopted library read a key. The key is the public
 * key that the glue resolved and bound: `publicJwk` already left out every private member, which the library's type cannot know.
 */
function methodOf(proof: Readonly<Record<string, unknown>>, publicKeyJwk: JsonWebKey): LibraryMethod {
  return {
    id: typeof proof.verificationMethod === "string" ? proof.verificationMethod : "",
    type: "JsonWebKey",
    controller: "",
    publicKeyJwk,
  } as LibraryMethod;
}

/**
 * Makes the suite of a cryptosuite of the adopted library: the data that the proof signs, as the Data Integrity algorithm
 * builds it, and the check of the signature with the key that the glue resolved.
 *
 * @param name - The `cryptosuite` of the proofs, or the `type` of a legacy proof.
 * @param make - Makes the proof object of the library, which holds the cryptosuite.
 * @param cryptosuite - The cryptosuite, which may build its own data to sign.
 */
function libraryGlue(name: string, make: () => DataIntegrityProof, cryptosuite: Cryptosuite): DataIntegritySuite {
  return {
    cryptosuite: name,
    async verify(document, proof, { publicKeyJwk, contexts, signal }) {
      const { proof: _secured, ...unsecured } = document;
      const instance = make();
      const verificationMethod = methodOf(proof, publicKeyJwk);
      try {
        const input = {
          cryptosuite,
          document: unsecured,
          proof,
          documentLoader: documentLoaderOf(contexts, signal),
          dataIntegrityProof: instance,
          verificationMethod,
        };
        const verifyData = cryptosuite.createVerifyData
          ? await cryptosuite.createVerifyData(input)
          : await instance.createVerifyData(input);
        return await instance.verifySignature({ verifyData, verificationMethod, proof });
      } catch (error) {
        rethrowOperational(error, signal);
        return false;
      }
    },
  };
}

/** The suite of `eddsa-rdfc-2022`. */
export const EDDSA_RDFC_2022: DataIntegritySuite = libraryGlue(
  "eddsa-rdfc-2022",
  () => new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 }),
  eddsaRdfc2022,
);

/** The suite of `ecdsa-rdfc-2019`, over P-256 and P-384. */
const ECDSA_RDFC_2019: DataIntegritySuite = libraryGlue(
  "ecdsa-rdfc-2019",
  () => new DataIntegrityProof({ cryptosuite: ecdsaRdfc2019 }),
  ecdsaRdfc2019,
);

/** The suite of the legacy proof type `Ed25519Signature2020`. */
export const ED25519_SIGNATURE_2020: DataIntegritySuite = libraryGlue(
  "Ed25519Signature2020",
  () => new Ed25519Signature2020(),
  eddsaRdfc2022,
);

/** The suites that `verifyProof` has beside those a host passes: the cryptosuites that Open Badges names. */
export const BUILT_IN_SUITES: readonly DataIntegritySuite[] = [
  EDDSA_RDFC_2022,
  ECDSA_RDFC_2019,
  selectiveDisclosureSuite,
];
