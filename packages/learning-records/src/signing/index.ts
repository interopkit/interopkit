/**
 * The signature of a Statement (4.2.6): a compact JWS of the Statement, in an Attachment, signed with the RSA series of
 * algorithms and verified against the certificate of its header or a key.
 *
 * @module @interopkit/learning-records/signing
 */
export { SIGNATURE_USAGE_TYPE } from "./constants.js";
export { type SignedStatement, type SignStatementOptions, signStatement } from "./sign-statement.js";
export {
  type SignatureCheck,
  type SignatureVerifyOptions,
  verifyStatementSignature,
} from "./verify-statement-signature.js";
