/**
 * What the tool role and the platform role must spell the same, because each is the other's counterpart: the media types and
 * the path of the grade services (LTI AGS 2.0), and the grant and the assertion type of the token endpoint (RFC 6749 section
 * 4.4, RFC 7523 section 2.2).
 */

/** The media type of a score (LTI AGS 2.0 section 3.4.1). */
export const SCORE_MEDIA_TYPE = "application/vnd.ims.lis.v1.score+json";
/** The media type of a line item (LTI AGS 2.0 section 3.2.1). */
export const LINE_ITEM_MEDIA_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
/** The path that follows a line item URL to make the URL of its scores (LTI AGS 2.0 section 3.4). */
export const SCORES_SUFFIX = "/scores";
/** The `grant_type` of the client-credentials grant. */
export const CLIENT_CREDENTIALS_GRANT = "client_credentials";
/** The `client_assertion_type` of a JWT bearer assertion (RFC 7523 section 2.2). */
export const JWT_BEARER_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
