/** The usage type of the Attachment that holds the signature of a Statement (4.2.6). */
export const SIGNATURE_USAGE_TYPE = "http://adlnet.gov/expapi/attachments/signature";

/** The content type of the Attachment that holds a signature (4.2.6). */
export const SIGNATURE_CONTENT_TYPE = "application/octet-stream";

/** The algorithms of a signature of a Statement: the "RSA + SHA" series of JWS (4.2.6). */
export const SIGNATURE_ALGORITHMS: readonly string[] = ["RS256", "RS384", "RS512"];

/** The characters of the base64 of a certificate, with its padding. No group repeats, so a long text cannot exhaust the stack. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

/** The length of a group of base64, which the padding fills. */
const BASE64_GROUP = 4;

/** Tells whether text is a certificate of the `x5c` header: the base64 of its DER encoding with padding (RFC 7515 section 4.1.6). */
export function isCertificate(text: string): boolean {
  return text.length % BASE64_GROUP === 0 && BASE64.test(text);
}
