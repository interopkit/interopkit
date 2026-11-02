/**
 * What the other modules and the tests share of `read` and the package does not export.
 *
 * @module
 */
import * as api from "./api-schemas.js";
import * as clr from "./clr-schemas.js";
import * as credentials from "./credential-schemas.js";
import * as keys from "./key-schemas.js";
import * as openBadgesV2 from "./open-badges-v2-schemas.js";
import * as v1p1 from "./v1p1-schemas.js";

export { ALIASES_V2, KEYWORD_TERMS_V2, PREFIXES_V2, TERMS_V2 } from "./context-v2.js";
export { parseDateTimeV2 } from "./formats-v2.js";
export { credentialOrReason, issueSink, parseJson, ruleIssues } from "./inspect.js";
export { DOCUMENT_PLACES, inspectBadgeV2, inspectDocumentV2, isBadgeAssertionV2, isDocumentV2 } from "./inspect-v2.js";
export { readJwsPayload } from "./jws-payload.js";
export { identityObjectV2Schema } from "./open-badges-v2-schemas.js";
export { jws } from "./primitives.js";

/** Every schema of a class, by the name of its export: the class name with a lower-case initial and `Schema`. */
export const CLASS_SCHEMAS = { ...credentials, ...v1p1, ...clr, ...api, ...keys };

/** Every schema of a class of Open Badges 2.0, by the name of its export. */
export const V2_SCHEMAS = { ...openBadgesV2 };
