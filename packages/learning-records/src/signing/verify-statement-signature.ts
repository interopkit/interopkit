import { type CallOptions, DataError, untilAborted } from "@interopkit/core";
import {
  abortSignalSchema,
  describe,
  guardSchema,
  isRecord,
  parseDateTime,
  parseWith,
  strictRecord,
} from "@interopkit/core/checks";
import {
  base64url,
  compactVerify,
  decodeProtectedHeader,
  errors,
  importX509,
  type ProtectedHeaderParameters,
} from "jose";
import * as v from "valibot";
import { toStatementVersion } from "../compare/index.js";
import { equivalenceKey } from "../compare/internal.js";
import { type Statement, XAPI_VERSIONS, type XapiVersion } from "../model/index.js";
import { parseIsoTimestamp } from "../model/internal.js";
import { type ReadStatementJsonOptions, readStatement, readStatementJson } from "../read/index.js";
import { readEitherVersion } from "../read/internal.js";
import { isCertificate, SIGNATURE_ALGORITHMS } from "./constants.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** Whether a signature is good, and if not why. */
export type SignatureCheck =
  | {
      /** The signature is good. */
      readonly valid: true;
      /**
       * Whether `trustCertificate` trusted the chain of the `x5c` header that verified the signature. It is `false` without a
       * chain or a function, and when `key` verified it. Anyone can make a certificate, so without it or `key` a good signature
       * says that the Statement was not changed after it was signed, and not who signed it.
       */
      readonly certified: boolean;
    }
  | {
      /** The signature is not good. */
      readonly valid: false;
      /**
       * Why not: `malformed` for bytes that are no compact JWS, a certificate or a payload that cannot be read; `algorithm`
       * for an algorithm other than RS256, RS384 or RS512, or a key made for another hash or shorter than 2,048 bits; `no-key` when the JWS has no `x5c`
       * and the caller gave no key, though its payload is the Statement given; `signature` when the key does not verify it; `not-equivalent` when the payload is another
       * Statement than the one given.
       */
      readonly reason: "malformed" | "not-equivalent" | "algorithm" | "signature" | "no-key";
    };

/** The options of `verifyStatementSignature`. */
export interface SignatureVerifyOptions extends CallOptions {
  /**
   * The public key that the caller trusts, which verifies the signature whatever the header of the JWS says: an
   * RSASSA-PKCS1-v1_5 key made for the hash of the algorithm that the JWS names.
   *
   * @defaultValue none: the leaf of the `x5c` of the JWS verifies it, and a JWS without `x5c` is `valid: false` with the reason `no-key`
   */
  readonly key?: CryptoKey;
  /**
   * Decides whether the certificate chain of the `x5c` header is trusted, leaf first, each as the base64 of its DER encoding.
   * The signature is checked against the leaf whatever it answers; the answer is `certified`.
   *
   * @defaultValue none: the leaf is checked and trust is not claimed
   */
  readonly trustCertificate?: (chain: readonly string[], options?: CallOptions) => Promise<boolean>;
  /**
   * The version of xAPI of the route that the Statement came from. On `1.0.3` the Statement is read with the rules of 1.0.3,
   * and the payload, which may have been signed in either version, is compared in the form of 1.0.3 (`toStatementVersion`):
   * the route of 1.0.3 answers a Statement of 2.0 without what 1.0.3 does not have, and its signature keeps them.
   *
   * @defaultValue `"2.0.0"`
   */
  readonly version?: XapiVersion;
}

/** Tells whether a value is a public key for RSASSA-PKCS1-v1_5 that can verify. */
function isRsaVerificationKey(value: unknown): value is CryptoKey {
  return (
    isRecord(value) &&
    value.type === "public" &&
    isRecord(value.algorithm) &&
    value.algorithm.name === "RSASSA-PKCS1-v1_5" &&
    Array.isArray(value.usages) &&
    value.usages.includes("verify")
  );
}

const optionsSchema = strictRecord({
  key: v.optional(guardSchema(isRsaVerificationKey, "a public RSASSA-PKCS1-v1_5 CryptoKey that can verify")),
  trustCertificate: v.optional(
    guardSchema(
      (value): value is NonNullable<SignatureVerifyOptions["trustCertificate"]> => typeof value === "function",
      "a function",
    ),
  ),
  version: v.optional(v.picklist(XAPI_VERSIONS)),
  signal: v.optional(abortSignalSchema),
});

/** Tells whether the header names the certificate chain as a list of certificates, of which the first is the leaf. */
function isChain(value: unknown): value is readonly [string, ...string[]] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((certificate) => typeof certificate === "string" && isCertificate(certificate))
  );
}

/** Writes a certificate as PEM, which `importX509` reads. */
function toPem(certificate: string): string {
  return `-----BEGIN CERTIFICATE-----\n${certificate.match(/.{1,64}/gu)?.join("\n")}\n-----END CERTIFICATE-----`;
}

/** A signature that is not good. */
type Failure = Extract<SignatureCheck, { readonly valid: false }>;

function fail(reason: Failure["reason"]): Failure {
  return { valid: false, reason };
}

function isFailure(value: object): value is Failure {
  return "valid" in value;
}

/** The text of the JWS, and its protected header. */
interface ParsedJws {
  readonly jws: string;
  readonly header: ProtectedHeaderParameters;
}

/** Reads the bytes as a compact JWS, whose protected header it decodes. */
function parseJws(signature: Uint8Array): ParsedJws | Failure {
  try {
    const jws = textDecoder.decode(signature);
    return { jws, header: decodeProtectedHeader(jws) };
  } catch {
    return fail("malformed");
  }
}

/** The key that verifies a JWS, the algorithm it names, and the chain whose leaf is the key. */
interface VerifyingKey {
  readonly key: CryptoKey;
  readonly algorithm: string;
  readonly chain?: readonly [string, ...string[]];
}

/**
 * Finds the key for the JWS: the key given, or else the leaf of its `x5c`. The signer chose the header, so a chain never takes
 * the place of a key that the caller trusts.
 */
async function findKey(
  header: ProtectedHeaderParameters,
  given: CryptoKey | undefined,
): Promise<VerifyingKey | Failure> {
  const { alg, x5c } = header;
  if (alg === undefined || !SIGNATURE_ALGORITHMS.includes(alg)) return fail("algorithm");
  if (given !== undefined) return { key: given, algorithm: alg };
  if (x5c === undefined) return fail("no-key");
  if (!isChain(x5c)) return fail("malformed");
  try {
    return { key: await importX509(toPem(x5c[0]), alg), algorithm: alg, chain: x5c };
  } catch {
    return fail("malformed");
  }
}

/** Verifies the JWS and returns its payload. */
async function verifyJws(jws: string, { key, algorithm }: VerifyingKey): Promise<Uint8Array | Failure> {
  try {
    return (await compactVerify(jws, key, { algorithms: [algorithm] })).payload;
  } catch (error) {
    if (error instanceof errors.JWSSignatureVerificationFailed) return fail("signature");
    // jose refuses with a TypeError a key that the algorithm cannot use: made for another hash, or RSA under 2,048 bits.
    return fail(error instanceof TypeError ? "algorithm" : "malformed");
  }
}

/**
 * Reads the payload of a signature as a Statement in the form of the version, within the limits of its JSON, or says that it is
 * none. On 1.0.3 the payload may have been signed in either version, and is compared in the form of 1.0.3.
 */
function readPayload(
  payload: Uint8Array,
  version: XapiVersion,
  limits: ReadStatementJsonOptions,
): Statement | undefined {
  let text: string;
  try {
    text = textDecoder.decode(payload);
  } catch {
    return undefined;
  }
  try {
    const json = readStatementJson(text, limits);
    return version === "1.0.3" ? toStatementVersion(readEitherVersion(json), "1.0.3") : readStatement(json);
  } catch (error) {
    if (error instanceof DataError) return undefined;
    throw error;
  }
}

/** Reads a time of a Statement of either version as epoch milliseconds. */
function instantOf(time: string | undefined): number | undefined {
  return time === undefined ? undefined : (parseDateTime(time) ?? parseIsoTimestamp(time));
}

/**
 * Tells whether the Statement received keeps what the signature says of the properties that immutability leaves out: an LRS
 * sets what a Statement lacks, and nothing else may change under a signature. The id and the time are those of the payload when
 * it has them, and every Attachment of the payload is one of the Statement, which also lists the signature.
 */
function keepsSigned(stated: Statement, signed: Statement): boolean {
  const attachments = new Set((stated.attachments ?? []).map(({ sha2 }) => sha2.toLowerCase()));
  return (
    (signed.id === undefined || signed.id.toLowerCase() === stated.id?.toLowerCase()) &&
    (signed.timestamp === undefined || instantOf(signed.timestamp) === instantOf(stated.timestamp)) &&
    (signed.attachments ?? []).every(({ sha2 }) => attachments.has(sha2.toLowerCase()))
  );
}

/** Tells whether the payload of a signature is the Statement received: the same Statement, and what it signed is kept. */
function equivalent(stated: Statement, signed: Statement): boolean {
  return equivalenceKey(stated) === equivalenceKey(signed) && keepsSigned(stated, signed);
}

/** The characters of base64url (RFC 4648 section 5), which a section of a compact JWS is written in. */
const BASE64URL = /^[A-Za-z0-9_-]*$/u;

/** Reads the payload of a compact JWS without verifying it, or says that the JWS is none. */
function unverifiedPayload(jws: string): Uint8Array | undefined {
  const sections = jws.split(".");
  const payload = sections[1];
  // A section of one more character than a multiple of four is no base64: a byte needs at least two.
  if (sections.length !== 3 || payload === undefined || !BASE64URL.test(payload) || payload.length % 4 === 1) {
    return undefined;
  }
  return base64url.decode(payload);
}

/**
 * Judges a signature that cannot be verified for want of a key: the payload must still be the JSON of a Statement, and the same
 * Statement as the one received, which the LRS checks whether it holds a key or not (4.2.6). What is left is `no-key`.
 */
function checkWithoutKey(
  jws: string,
  stated: Statement,
  version: XapiVersion,
  limits: ReadStatementJsonOptions,
  noKey: Failure,
): Failure {
  const payload = unverifiedPayload(jws);
  const signed = payload === undefined ? undefined : readPayload(payload, version, limits);
  if (signed === undefined) return fail("malformed");
  return equivalent(stated, signed) ? noKey : fail("not-equivalent");
}

/**
 * Verifies the signature of a Statement (4.2.6): the JWS verifies against the key given or the leaf of its `x5c`, and its
 * payload is the same Statement as the one given.
 *
 * @remarks
 * The algorithm must be RS256, RS384 or RS512, and the JWS must be in compact serialization; the JWS JSON serialization is
 * `malformed`. A key that the JWS carries in a `jwk` header is not used, since the signer chose it. The Statement given is the
 * one received, with whatever the LRS added; the payload is compared to it by the rules of `sameStatement`, and the `id`, the
 * `timestamp` and the Attachments that the payload has must be kept. The chain is not validated: `trustCertificate` decides
 * whether it is trusted, and without it `certified` is `false`. A signature that is not good is a value in the result; a
 * Statement or options that are not valid throw.
 *
 * @param statement - The Statement that was received, with or without the header of its signature.
 * @param signature - The data of the Attachment of the signature: the compact JWS as UTF-8.
 * @param options - The key, the trust function, the version of the route and the `signal`.
 * @returns Whether the signature is good, whether the chain is trusted, or why it is not good.
 * @throws `DataError` when the Statement is not valid as an LRS of the version reads it, the signature is not a `Uint8Array`, or the options
 * are not valid.
 * @throws The `reason` of the signal when it aborts, and the error of `trustCertificate` when it rejects.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function verifyStatementSignature(
  statement: Statement,
  signature: Uint8Array,
  options?: SignatureVerifyOptions,
): Promise<SignatureCheck> {
  return verifySignature(statement, signature, options, {});
}

/**
 * Verifies a signature as `verifyStatementSignature` does, and reads its payload within the limits of the JSON of a request that
 * the handler of an LRS sets, which the defaults of `readStatementJson` would exceed.
 *
 * @param limits - The limits of the JSON of the payload, as `readStatementJson` takes them.
 */
export async function verifySignature(
  statement: Statement,
  signature: Uint8Array,
  options: SignatureVerifyOptions | undefined,
  limits: ReadStatementJsonOptions,
): Promise<SignatureCheck> {
  const {
    key,
    trustCertificate,
    version = "2.0.0",
    signal,
  } = parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
  const stated = readStatement(statement, { version });
  if (!(signature instanceof Uint8Array)) {
    throw new DataError(`The signature must be a Uint8Array, found ${describe(signature)}.`);
  }
  signal?.throwIfAborted();
  const parsed = parseJws(signature);
  if (isFailure(parsed)) return parsed;
  const found = await findKey(parsed.header, key);
  if (isFailure(found)) {
    return found.reason === "no-key" ? checkWithoutKey(parsed.jws, stated, version, limits, found) : found;
  }
  const payload = await verifyJws(parsed.jws, found);
  if (isFailure(payload)) return payload;
  const signed = readPayload(payload, version, limits);
  if (signed === undefined) return fail("malformed");
  if (!equivalent(stated, signed)) return fail("not-equivalent");
  const certified =
    found.chain !== undefined && trustCertificate !== undefined
      ? await untilAborted(trustCertificate(found.chain, signal === undefined ? undefined : { signal }), signal)
      : false;
  return { valid: true, certified };
}
