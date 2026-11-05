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
        "createKeyedCache",
        "DataError",
        "DEFAULT_MAX_BYTES",
        "DEFAULT_TIMEOUT_MS",
        "findLinkTarget",
        "hasNextPage",
        "InteropkitError",
        "LimitError",
        "raceAbort",
        "readAnswer",
        "readAnswerJson",
        "readClock",
        "readRetryAfterSeconds",
        "readStatusInfo",
        "requestService",
        "requestWithCredential",
        "ServiceError",
        "signCompactJws",
        "STATUS_CODES_MAJOR",
        "STATUS_SEVERITIES",
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
        "buildIssues",
        "copyJson",
        "createIssueSink",
        "dateSchema",
        "DEFAULT_MAX_FINDINGS",
        "dateTimeSchema",
        "describe",
        "endOfJsonString",
        "findExceededJsonLimit",
        "findInstant",
        "findIsoInstant",
        "finiteSchema",
        "abortSignalSchema",
        "guardSchema",
        "hasMoreTokensThan",
        "httpsUrlSchema",
        "isAbsoluteUri",
        "isDate",
        "isDateTime",
        "isLanguageTag",
        "isRecord",
        "isSameJson",
        "isUuid",
        "describeIssue",
        "jsonObjectSchema",
        "languageTagSchema",
        "looseRecord",
        "mapSchema",
        "MAX_JSON_DEPTH",
        "MAX_JSON_TOKENS",
        "methodsSchema",
        "nonEmptyStringSchema",
        "nonNegativeIntegerSchema",
        "opaqueJsonObjectSchema",
        "opaqueJsonValueSchema",
        "openRecord",
        "parseDateTime",
        "parseJsonText",
        "parseWith",
        "readCallOptions",
        "formatDateTime",
        "checkBaseUrl",
        "formatIssuePath",
        "positiveIntegerSchema",
        "positiveSchema",
        "describeRefusal",
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
        "buildRefusalResponse",
        "buildStatusInfoResponse",
        "checkHttpRequest",
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
