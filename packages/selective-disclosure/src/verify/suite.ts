import { type CallOptions, DataError } from "@interopkit/core";
import { checkRecord } from "@interopkit/core/checks";
import {
  checkSize,
  createProcessing,
  type JsonDocument,
  readCommonOptions,
  readJson,
  withoutProof,
} from "../document/index.js";
import { importIssuerKey, importMultikey, verifyBaseSignature, verifyStatements } from "../keys/index.js";
import { parseDerivedProofValue, signData } from "../proof-value/index.js";
import { CRYPTOSUITE, PROOF_TYPE } from "../suite.js";
import { createVerifyData } from "./verify-data.js";

/** The options of `selectiveDisclosureSuite.verify`. */
export interface VerifyProofOptions extends CallOptions {
  /** The public key of the verification method of the proof, which the caller has resolved and bound to the issuer. */
  readonly publicKeyJwk: JsonWebKey;
  /** Returns the JSON-LD context behind a URL. The processors read no context from anywhere else. */
  readonly contexts: (url: string, options?: CallOptions) => Promise<unknown>;
  /**
   * The most bytes of the document with its proof as JSON. Over it, `verify` answers `false`.
   *
   * @defaultValue 1,048,576
   */
  readonly maxBytes?: number;
  /**
   * The most tokens of the document with its proof as JSON. Over it, `verify` answers `false`. They bound the work of the
   * JSON-LD processor, which grows with the square of the values of one property.
   *
   * @defaultValue 20,000
   */
  readonly maxTokens?: number;
}

/**
 * Verifies a derived proof.
 *
 * @remarks
 * The verdict is `false` for anything that is wrong with the document or the proof: a base proof, a proof that is not a
 * proof of this suite, a proof value that does not parse, a document that cannot be read as JSON-LD with its contexts, a
 * document larger than `maxBytes` or `maxTokens`, a signature that does not verify, a key that is not a P-256 key. Wrong
 * arguments throw.
 */
async function verify(document: JsonDocument, proof: JsonDocument, options: VerifyProofOptions): Promise<boolean> {
  const limits = readCommonOptions(options, "The options of verify");
  const { contexts, signal } = limits;
  checkRecord(document, "The document must be an object");
  checkRecord(proof, "The proof must be an object");
  checkRecord(options.publicKeyJwk, "The option publicKeyJwk must be an object");
  const issuerKey = await importIssuerKey(options.publicKeyJwk);
  if (issuerKey === undefined) return false;
  signal?.throwIfAborted();

  const processing = createProcessing(contexts, signal);
  try {
    const documentCopy = readJson(document, "The document");
    const proofCopy = readJson(proof, "The proof");
    checkSize(JSON.stringify(documentCopy) + JSON.stringify(proofCopy), limits);
    if (proofCopy.type !== PROOF_TYPE || proofCopy.cryptosuite !== CRYPTOSUITE) return false;
    const { proofValue, ...proofOptions } = proofCopy;
    const derived = parseDerivedProofValue(proofValue);
    // The proof options are signed with the context of the document, whatever context the proof carries.
    const { "@context": _context, ...proofConfig } = proofOptions;
    const { proofHash, mandatoryHash, nonMandatory } = await processing.wait(
      createVerifyData(withoutProof(documentCopy), proofConfig, derived.labelMap, derived.mandatoryIndexes, processing),
    );
    const proofKey = await importMultikey(derived.publicKey);
    const verdicts = await Promise.all([
      verifyBaseSignature(issuerKey, signData(proofHash, derived.publicKey, mandatoryHash), derived.baseSignature),
      verifyStatements(proofKey, nonMandatory, derived.signatures),
    ]);
    return verdicts.every(Boolean);
  } catch (error) {
    // A fault of the document or the proof is a verdict; a failure of the caller's loader or signal is not.
    if (error instanceof DataError && !processing.callerFailed()) return false;
    throw error;
  }
}

/**
 * The cryptosuite `ecdsa-sd-2023` as a verifier uses it: the name that a proof carries, and the check of a derived proof. A
 * verifier of Data Integrity proofs that looks a suite up by the `cryptosuite` of a proof and calls `verify` with the key it
 * resolved can take this object as it is.
 *
 * @remarks
 * `verify` checks derived proofs. A base proof holds the HMAC key and every signature, so it never goes to a verifier, and
 * `verify` answers `false` for it: `isBaseProof` tells a caller to ask the holder for a derived proof.
 *
 * @see {@link https://www.w3.org/TR/vc-di-ecdsa/#verify-derived-proof-ecdsa-sd-2023 | Verify Derived Proof (ecdsa-sd-2023)}
 */
export const selectiveDisclosureSuite: {
  /** The `cryptosuite` of the proofs it checks. */
  readonly cryptosuite: "ecdsa-sd-2023";
  /**
   * Verifies a derived proof against the key that the caller resolved and bound to the issuer.
   *
   * @param document - The revealed document. A `proof` property is ignored.
   * @param proof - The derived proof of the document.
   * @param options - The issuer's public key, the loader of contexts and the largest size of the document.
   * @returns Whether the proof is valid for the document under the key. `false` for any fault of the document or the proof,
   * and for a base proof.
   * @throws `DataError` when an argument is not valid, or the key is a private key.
   * @throws The error of the context loader when it fails, and the `reason` of the signal when it aborts.
   */
  verify(document: JsonDocument, proof: JsonDocument, options: VerifyProofOptions): Promise<boolean>;
} = { cryptosuite: CRYPTOSUITE, verify };
