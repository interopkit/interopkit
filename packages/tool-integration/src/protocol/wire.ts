/**
 * What the tool role and the platform role must spell the same, because each is the other's counterpart: the media types and
 * the path of the grade services (LTI AGS 2.0), and the grant and the assertion type of the token endpoint (RFC 6749 section
 * 4.4, RFC 7523 section 2.2).
 */

/** The media type of a score (LTI AGS 2.0 section 3.4.1). */
export const SCORE_MEDIA_TYPE = "application/vnd.ims.lis.v1.score+json";
/** The media type of a line item (LTI AGS 2.0 section 3.2.1). */
export const LINE_ITEM_MEDIA_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
/** The media type of the line items of a context (LTI AGS 2.0 section 3.2). */
export const LINE_ITEM_CONTAINER_MEDIA_TYPE = "application/vnd.ims.lis.v2.lineitemcontainer+json";
/** The media type of the results of a line item (LTI AGS 2.0 section 3.3). */
export const RESULT_CONTAINER_MEDIA_TYPE = "application/vnd.ims.lis.v2.resultcontainer+json";
/** The media type of the members of a context or a resource link (NRPS 2.0, membership container). */
export const MEMBERSHIP_MEDIA_TYPE = "application/vnd.ims.lti-nrps.v2.membershipcontainer+json";
/** The media type of the groups of a context (Context Groups 1.0 section 2.1.1). */
export const GROUP_CONTAINER_MEDIA_TYPE = "application/vnd.ims.lti-gs.v1.contextgroupcontainer+json";
/** The media type of the group sets of a context (Context Groups 1.0 section 2.2.1). */
export const GROUP_SET_CONTAINER_MEDIA_TYPE = "application/vnd.ims.lti-gs.v1.contextgroupsetcontainer+json";
/** The media type of the record of the AfA PNP Connector (its OpenAPI file gives `application/json`). */
export const PREFERENCES_MEDIA_TYPE = "application/json";
/** The path below the host of the claim at which the paths of the AfA PNP Connector lie (AfA PNP Connector 1.0, overview). */
export const PREFERENCES_BASE_PATH = "/ims/afapnp/v1p0";
/** The path that follows a line item URL to make the URL of its scores (LTI AGS 2.0 section 3.4). */
export const SCORES_SUFFIX = "/scores";
/** The path that follows a line item URL to make the URL of its results (LTI AGS 2.0 section 3.3). */
export const RESULTS_SUFFIX = "/results";
/** The `grant_type` of the client-credentials grant. */
export const CLIENT_CREDENTIALS_GRANT = "client_credentials";
/** The `client_assertion_type` of a JWT bearer assertion (RFC 7523 section 2.2). */
export const JWT_BEARER_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
