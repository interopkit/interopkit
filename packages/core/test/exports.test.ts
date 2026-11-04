import { describe, expect, it } from "vitest";
import * as checks from "../src/checks.js";
import * as http from "../src/http/index.js";
import * as root from "../src/index.js";
import * as oauth from "../src/oauth/index.js";

describe("the public API", () => {
  it("exports from the root only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "callPort",
        "callService",
        "checkClock",
        "clientOptionsEntries",
        "createCryptoKeySigner",
        "createJwksCache",
        "createKeyedCache",
        "DataError",
        "DEFAULT_MAX_BYTES",
        "DEFAULT_TIMEOUT_MS",
        "findLinkTarget",
        "hasNextLink",
        "hasNextPage",
        "InteropkitError",
        "LimitError",
        "raceAbort",
        "readAnswer",
        "readAnswerJson",
        "readClock",
        "readRetryAfterSeconds",
        "readStatusDetail",
        "readTotalCount",
        "requestService",
        "requestWithCredential",
        "ServiceError",
        "signCompactJws",
        "SYSTEM_CLOCK",
        "SYSTEM_RANDOM",
      ].sort(),
    );
  });

  it("exports from the checks subpath only what the package documents", () => {
    expect(Object.keys(checks).sort()).toStrictEqual(
      [
        "absoluteUriSchema",
        "checkAbortSignal",
        "checkArray",
        "checkFunction",
        "checkHttpsUrl",
        "checkNonEmptyString",
        "checkNonNegativeInteger",
        "checkPositiveInteger",
        "checkProperties",
        "checkRecord",
        "checkRemoteUrl",
        "checkString",
        "copyJson",
        "createFindingSink",
        "dateSchema",
        "DEFAULT_MAX_FINDINGS",
        "dateTimeSchema",
        "describe",
        "findExceededJsonLimit",
        "finiteSchema",
        "abortSignalSchema",
        "buildFindings",
        "guardSchema",
        "hasMoreTokensThan",
        "httpsUrlSchema",
        "isAbsoluteUri",
        "isDate",
        "isDateTime",
        "isLanguageTag",
        "isRecord",
        "isUuid",
        "describeIssue",
        "jsonObjectSchema",
        "languageTagSchema",
        "looseRecord",
        "mapSchema",
        "MAX_JSON_DEPTH",
        "MAX_JSON_TOKENS",
        "methodsSchema",
        "nestsDeeperThan",
        "nonEmptyStringSchema",
        "nonNegativeIntegerSchema",
        "openRecord",
        "parseDateTime",
        "parseWith",
        "readCallOptions",
        "formatDateTime",
        "checkBaseUrl",
        "formatIssuePath",
        "positiveIntegerSchema",
        "positiveSchema",
        "describeRefusal",
        "remoteUrlSchema",
        "safeParseBounded",
        "strictRecord",
        "uuidSchema",
      ].sort(),
    );
  });

  it("exports from the http subpath only what the package documents", () => {
    expect(Object.keys(http).sort()).toStrictEqual(
      [
        "ACCESS_REFUSAL_STATUSES",
        "basePathSchema",
        "buildJsonResponse",
        "buildPageLinks",
        "buildStatusInfoResponse",
        "checkHttpRequest",
        "negotiate",
        "readAccessDecision",
        "readBearerToken",
        "readForm",
        "readJson",
        "readOffsetPage",
        "readQuery",
        "readText",
      ].sort(),
    );
  });

  it("exports from the oauth subpath only what the package documents", () => {
    expect(Object.keys(oauth).sort()).toStrictEqual(
      [
        "startAuthorization",
        "requestClientCredentialsToken",
        "createTokenCache",
        "exchangeCode",
        "refreshAccessToken",
        "registerClient",
        "GRANT_TYPES",
        "revokeToken",
      ].sort(),
    );
  });
});
