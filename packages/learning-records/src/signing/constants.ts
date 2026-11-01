/** The usage type of the Attachment that holds the signature of a Statement (4.2.6). */
export const SIGNATURE_USAGE_TYPE = "http://adlnet.gov/expapi/attachments/signature";

/** The content type of the Attachment that holds a signature (4.2.6). */
export const SIGNATURE_CONTENT_TYPE = "application/octet-stream";

/** The algorithms of a signature of a Statement: the "RSA + SHA" series of JWS (4.2.6). */
export const SIGNATURE_ALGORITHMS: readonly string[] = ["RS256", "RS384", "RS512"];

/** A certificate of the `x5c` header: the base64 of its DER encoding with padding (RFC 7515 section 4.1.6). */
export const CERTIFICATE_BASE64 = /^(?=.)(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
