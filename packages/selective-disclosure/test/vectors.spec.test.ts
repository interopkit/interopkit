import { base58, hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { addBaseProofWith } from "../src/base/internal.js";
import { deriveProof, selectiveDisclosureSuite } from "../src/index.js";
import { parseBaseProofValue, parseDerivedProofValue } from "../src/proof-value/index.js";
import { memoryContexts } from "./contexts.js";
import { downloadedContexts, readVectors, type Vector } from "./downloads.js";
import { deterministicProofKey, deterministicSigner, jwkOf, secretKeyOf } from "./multikey.js";

const VECTORS = readVectors();
const NAMES = ["the first example", "the additional example"] as const;

/** The proof of a document as an object. */
function proofOf(document: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return document.proof as Readonly<Record<string, unknown>>;
}

/** The document without its proof. */
function withoutProof(document: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { proof: _proof, ...rest } = document;
  return rest;
}

/** The base proof of the vector, made with the keys and the HMAC key that the Recommendation prints, over the signed credential. */
function baseProofOf(vector: Vector) {
  const verificationMethod = String(proofOf(vector.signed).verificationMethod);
  const contexts = memoryContexts(downloadedContexts());
  return addBaseProofWith(
    withoutProof(vector.signed),
    {
      signer: deterministicSigner(secretKeyOf(vector.baseKeyPair.secretKeyMultibase), verificationMethod),
      mandatoryPointers: vector.mandatoryPointers,
      contexts: contexts.load,
      created: String(proofOf(vector.signed).created),
    },
    async () => ({
      hmacKey: hex.decode(vector.hmacKeyString.toLowerCase()),
      proofKey: deterministicProofKey(secretKeyOf(vector.proofKeyPair.secretKeyMultibase)),
    }),
  );
}

describe("the test vectors of the Recommendation", () => {
  it("holds the two examples of ecdsa-sd-2023", () => {
    expect(VECTORS).toHaveLength(2);
  });

  describe.each(VECTORS.map((vector, index) => [NAMES[index], vector] as const))("%s", (_name, vector) => {
    it("prints the credential that is signed", () => {
      const differing = Object.keys(vector.unsecured).filter(
        (key) => JSON.stringify(vector.unsecured[key]) !== JSON.stringify(withoutProof(vector.signed)[key]),
      );
      // The additional example prints a description for the credential without a proof that is not the one that it signs.
      expect(differing).toStrictEqual(vector === VECTORS[1] ? ["description"] : []);
    });

    it("is made into the same base proof, byte for byte", async () => {
      expect(await baseProofOf(vector)).toStrictEqual(vector.signed);
    });

    it("has the components that the Recommendation prints for the base proof", () => {
      const parsed = parseBaseProofValue(proofOf(vector.signed).proofValue);
      expect(hex.encode(parsed.baseSignature)).toBe(vector.baseComponents.baseSignature);
      expect(`z${base58.encode(parsed.publicKey)}`).toBe(vector.baseComponents.publicKey);
      expect(parsed.signatures.map((signature) => hex.encode(signature))).toStrictEqual(
        vector.baseComponents.signatures,
      );
      expect(parsed.mandatoryPointers).toStrictEqual(vector.baseComponents.mandatoryPointers);
      expect(hex.encode(parsed.hmacKey)).toBe(vector.hmacKeyString.toLowerCase());
    });

    it("is derived into the same document and proof, byte for byte", async () => {
      const contexts = memoryContexts(downloadedContexts());
      const derived = await deriveProof(vector.signed, {
        selectivePointers: vector.selectivePointers,
        contexts: contexts.load,
      });
      expect(derived).toStrictEqual(vector.derived);
    });

    it("has the components that the Recommendation prints for the derived proof", () => {
      const parsed = parseDerivedProofValue(proofOf(vector.derived).proofValue);
      expect(hex.encode(parsed.baseSignature)).toBe(vector.derivedComponents.baseSignature);
      expect(`z${base58.encode(parsed.publicKey)}`).toBe(vector.derivedComponents.publicKey);
      expect(parsed.signatures.map((signature) => hex.encode(signature))).toStrictEqual(
        vector.derivedComponents.signatures,
      );
      expect([...parsed.labelMap]).toStrictEqual(vector.derivedComponents.labelMap.value);
      expect(parsed.mandatoryIndexes).toStrictEqual(vector.derivedComponents.mandatoryIndexes);
    });

    it("verifies the derived proof under the key of the issuer", async () => {
      const contexts = memoryContexts(downloadedContexts());
      expect(
        await selectiveDisclosureSuite.verify(withoutProof(vector.derived), proofOf(vector.derived), {
          publicKeyJwk: jwkOf(vector.baseKeyPair.publicKeyMultibase),
          contexts: contexts.load,
        }),
      ).toBe(true);
    });
  });
});
