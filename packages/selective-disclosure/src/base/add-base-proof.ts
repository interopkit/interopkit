import { type CallOptions, DataError, raceAbort, type Signer } from "@interopkit/core";
import { checkFunction, checkNonEmptyString, checkRecord, describe, isDateTime } from "@interopkit/core/checks";
import {
  canonicalizeAndGroup,
  checkPointers,
  checkSize,
  createProcessing,
  hashCanonizedProof,
  hashMandatory,
  hmacLabelMap,
  type JsonDocument,
  readCommonOptions,
  readJson,
  withoutProof,
} from "../document/index.js";
import { serializeBaseProofValue, signData } from "../proof-value/index.js";
import { CRYPTOSUITE, PROOF_PURPOSE, PROOF_TYPE, SIGNATURE_BYTES } from "../suite.js";
import { createSecrets, type Secrets } from "./secrets.js";

/** The options of `addBaseProof`. */
export interface BaseProofOptions extends CallOptions {
  /** Signs with ES256, and its `keyId` is the verification method of the proof. */
  readonly signer: Signer;
  /** Returns the JSON-LD context behind a URL. The processors read no context from anywhere else. */
  readonly contexts: (url: string, options?: CallOptions) => Promise<unknown>;
  /**
   * The most bytes of the document as JSON.
   *
   * @defaultValue 1,048,576
   */
  readonly maxBytes?: number;
  /**
   * The most tokens of the document as JSON: strings, numbers, literals and the six structural characters. They bound the work
   * of the JSON-LD processor, which grows with the square of the values of one property.
   *
   * @defaultValue 20,000
   */
  readonly maxTokens?: number;
  /**
   * The JSON pointers to what a holder can never hide.
   *
   * @defaultValue none
   */
  readonly mandatoryPointers?: readonly string[];
  /**
   * The `created` of the proof, as a date and time with an offset, such as `2026-11-01T09:30:00Z`. The proof options are
   * signed, so a holder cannot hide it: every verifier reads it in every disclosure, whatever else the disclosure hides.
   *
   * @defaultValue none: the proof has no `created`, which Data Integrity leaves optional
   */
  readonly created?: string;
}

/** Checks the signer, as a host passes it from JavaScript, and returns the verification method it names. */
function verificationMethodOf(signer: Signer): string {
  checkRecord(signer, "The option signer must be an object");
  if (signer.algorithm !== "ES256") {
    throw new DataError(
      `The option signer must sign with ES256, the algorithm of the curve P-256, found ${describe(signer.algorithm)}.`,
    );
  }
  checkFunction(signer.sign, "The function sign of the option signer must be a function");
  checkNonEmptyString(signer.keyId, "The keyId of the option signer (the verification method of the proof)");
  return signer.keyId;
}

/** Checks that a signer answered with the signature of ES256 in the form of JOSE. */
function checkSignature(signature: unknown): Uint8Array {
  if (!(signature instanceof Uint8Array && signature.length === SIGNATURE_BYTES)) {
    const found = signature instanceof Uint8Array ? `${signature.length} bytes` : describe(signature);
    throw new DataError(
      `The signer must return the signature as ${SIGNATURE_BYTES} bytes, the R and S of ES256 and not DER, found ${found}.`,
    );
  }
  return signature;
}

/**
 * Adds a base proof of `ecdsa-sd-2023` to a document: the proof for the holder, from which the holder derives the proofs
 * that go to verifiers.
 *
 * @remarks
 * The proof holds the key of an HMAC that relabels the blank nodes of the document, a signature for every statement that a
 * holder may hide, made with a key that is new to this proof, and the signature of the issuer's key over the public key of the
 * proof and the mandatory statements. The HMAC key comes from `crypto.getRandomValues` and the key of the proof from Web
 * Crypto, which does not let it be exported, and no option replaces them: a source that could be predicted would let anyone who
 * holds the base proof replace the statements that a holder may hide. A base proof never goes to a verifier; `deriveProof`
 * makes the proof that does.
 *
 * @param document - The document to sign: JSON-LD with an `@context` and no `proof`. It is not changed.
 * @param options - The signer, the mandatory pointers, the `created` of the proof and the loader of contexts.
 * @returns A copy of the document with the base proof as its `proof`.
 * @throws `DataError` when an argument is not valid, the document is larger than `maxBytes` or `maxTokens`, the document
 * already has a proof, a pointer points at nothing in the document, or the JSON-LD processors refuse the document or its
 * contexts (a term the contexts do not define, blank nodes that take more than 1,000 runs of Hash N-Degree Quads to tell apart).
 * @throws The error of the signer or of the context loader when one fails, and the `reason` of the signal when it aborts.
 * @see {@link https://www.w3.org/TR/vc-di-ecdsa/#create-base-proof-ecdsa-sd-2023 | Create Base Proof (ecdsa-sd-2023)}
 */
export async function addBaseProof(document: JsonDocument, options: BaseProofOptions): Promise<JsonDocument> {
  return addBaseProofWith(document, options, createSecrets);
}

/**
 * Adds a base proof with the secrets that a function makes. `addBaseProof` passes `createSecrets`; the test vectors of the
 * Recommendation pass fixed ones, which only the tests can reach.
 */
export async function addBaseProofWith(
  document: JsonDocument,
  options: BaseProofOptions,
  secretsOf: () => Promise<Secrets>,
): Promise<JsonDocument> {
  const limits = readCommonOptions(options, "The options of addBaseProof");
  const { contexts, signal } = limits;
  const verificationMethod = verificationMethodOf(options.signer);
  const { created } = options;
  if (created !== undefined && (typeof created !== "string" || !isDateTime(created))) {
    throw new DataError(
      `The option created must be a date and time with an offset, such as 2026-11-01T09:30:00Z, found ${describe(created)}.`,
    );
  }
  checkRecord(document, "The document must be an object");
  const copy = readJson(document, "The document");
  checkSize(JSON.stringify(copy), limits);
  if (copy.proof !== undefined) {
    throw new DataError("The document already has a proof: the base proof signs a document without one.");
  }
  const unsecured = withoutProof(copy);
  const mandatoryPointers = checkPointers(
    options.mandatoryPointers === undefined ? [] : options.mandatoryPointers,
    "The option mandatoryPointers",
    unsecured,
  );
  signal?.throwIfAborted();

  const { hmacKey, proofKey } = await secretsOf();
  const proofOptions = {
    type: PROOF_TYPE,
    cryptosuite: CRYPTOSUITE,
    ...(created === undefined ? {} : { created }),
    verificationMethod,
    proofPurpose: PROOF_PURPOSE,
  };
  const processing = createProcessing(contexts, signal);
  const { proofHash, mandatoryHash, nonMandatory } = await processing.wait(
    (async () => {
      const [proofHash, grouped] = await Promise.all([
        hashCanonizedProof({ document: unsecured, proof: proofOptions, options: processing.options }),
        hmacLabelMap(hmacKey).then((labelMapFactoryFunction) =>
          canonicalizeAndGroup({
            document: unsecured,
            labelMapFactoryFunction,
            groups: { mandatory: mandatoryPointers },
            options: processing.options,
          }),
        ),
      ]);
      const { mandatory } = grouped.groups;
      const { mandatoryHash } = await hashMandatory({ mandatory: [...mandatory.matching.values()] });
      return { proofHash, mandatoryHash, nonMandatory: [...mandatory.nonMatching.values()] };
    })(),
  );

  const toSign = signData(proofHash, proofKey.publicKey, mandatoryHash);
  const [signatures, signed] = await raceAbort(
    Promise.all([
      Promise.all(nonMandatory.map((statement) => proofKey.sign(statement))),
      options.signer.sign(toSign, signal === undefined ? undefined : { signal }),
    ]),
    signal,
  );
  const baseSignature = checkSignature(signed);
  const proofValue = serializeBaseProofValue({
    baseSignature,
    publicKey: proofKey.publicKey,
    hmacKey,
    signatures,
    mandatoryPointers,
  });
  return { ...copy, proof: { ...proofOptions, proofValue } };
}
