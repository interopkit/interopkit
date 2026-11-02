import { type CallOptions, DataError, type Signer, signCompactJws } from "@interopkit/core";
import { abortSignalSchema, checkRecord, describe, parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { attachmentHash } from "../attachments/index.js";
import {
  type Attachment,
  type AttachmentData,
  type Statement,
  XAPI_VERSIONS,
  type XapiVersion,
} from "../model/index.js";
import { readStatement } from "../read/index.js";
import { isCertificate, SIGNATURE_ALGORITHMS, SIGNATURE_CONTENT_TYPE, SIGNATURE_USAGE_TYPE } from "./constants.js";

const encoder = new TextEncoder();

/** A Statement with its signature: the Statement, whose `attachments` now list the signature, and the data of that Attachment. */
export interface SignedStatement {
  /** The Statement as it was given, with the header of the signature added to its `attachments`. */
  readonly statement: Statement;
  /** The data of the signature, the compact JWS, to send as the part of the Attachment with that hash. */
  readonly signature: AttachmentData;
}

/** The options of `signStatement`. */
export interface SignStatementOptions extends CallOptions {
  /**
   * The certificate chain of the key, leaf first, each as the base64 of its DER encoding, for the `x5c` header of the JWS.
   * The standard asks for it when an X.509 certificate signed.
   *
   * @defaultValue none
   */
  readonly x5c?: readonly string[];
  /**
   * The version of xAPI whose provider rules the Statement is read with first.
   *
   * @defaultValue `"2.0.0"`
   */
  readonly version?: XapiVersion;
}

const optionsSchema = strictRecord({
  x5c: v.optional(
    v.pipe(
      v.array(
        v.pipe(
          v.string(),
          v.check(
            isCertificate,
            (issue) => `expected a certificate as the base64 of its DER encoding, found ${issue.received}`,
          ),
        ),
      ),
      v.nonEmpty(),
    ),
  ),
  version: v.optional(v.picklist(XAPI_VERSIONS)),
  signal: v.optional(abortSignalSchema),
});

/** Checks that the signer signs with an algorithm that a signature of a Statement may use. */
function checkAlgorithm(signer: unknown): asserts signer is Signer {
  checkRecord(signer, "The signer must be an object");
  const { algorithm } = signer;
  if (typeof algorithm !== "string" || !SIGNATURE_ALGORITHMS.includes(algorithm)) {
    throw new DataError(
      `The signature of a Statement is RS256, RS384 or RS512, and the signer signs with ${describe(algorithm)}.`,
    );
  }
}

/**
 * Signs a Statement (4.2.6): the JSON of the Statement is the payload of a compact JWS, which becomes an Attachment of the
 * Statement.
 *
 * @remarks
 * The Statement is read with the rules of a Learning Record Provider of the version first, and the payload is its JSON before the signature
 * is added, as the standard asks. The signature has the usage type `http://adlnet.gov/expapi/attachments/signature` and the
 * content type `application/octet-stream`; the host sends the returned Statement with `signature` as the data of that
 * Attachment. The algorithm is the signer's and is RS256, RS384 or RS512, and the key id of the signer, if it has one, is the
 * `kid` of the JWS. RSA PKCS#1 v1.5 is deterministic, so the same Statement and key give the same signature.
 *
 * @param statement - The Statement, which has no signature yet.
 * @param signer - Signs the bytes with an RSA key, in a `CryptoKey` or a KMS.
 * @param options - The certificate chain, the version and the `signal`.
 * @returns The Statement with the header of its signature, and the signature.
 * @throws `DataError` when the Statement breaks a rule of a provider or has a signature already, the signer does not sign with
 * RS256, RS384 or RS512, or the options are not valid.
 * @throws The `reason` of the signal when it aborts, and the error of the signer when it rejects.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export async function signStatement(
  statement: Statement,
  signer: Signer,
  options?: SignStatementOptions,
): Promise<SignedStatement> {
  const { x5c, version, signal } = parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
  const read = readStatement(statement, { role: "provider", version: version ?? "2.0.0" });
  checkAlgorithm(signer);
  if (read.attachments?.some(({ usageType }) => usageType === SIGNATURE_USAGE_TYPE)) {
    throw new DataError("The Statement has a signature already: a Statement is signed once.");
  }
  const jws = await signCompactJws(
    x5c === undefined ? {} : { x5c },
    encoder.encode(JSON.stringify(read)),
    signer,
    signal === undefined ? undefined : { signal },
  );
  const body = encoder.encode(jws);
  const sha2 = attachmentHash(body);
  const header: Attachment = {
    usageType: SIGNATURE_USAGE_TYPE,
    display: { "en-US": "Signature" },
    contentType: SIGNATURE_CONTENT_TYPE,
    length: body.byteLength,
    sha2,
  };
  return {
    statement: { ...read, attachments: [...(read.attachments ?? []), header] },
    signature: { sha2, contentType: SIGNATURE_CONTENT_TYPE, body },
  };
}
