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
        "createJwksCache",
        "createKeyedCache",
        "DataError",
        "DEFAULT_MAX_BYTES",
        "DEFAULT_TIMEOUT_MS",
        "hasNextLink",
        "InteropkitError",
        "linkTarget",
        "readClock",
        "requestService",
        "retryAfterSeconds",
        "ServiceError",
        "signCompactJws",
        "signerFromCryptoKey",
        "SYSTEM_CLOCK",
        "SYSTEM_RANDOM",
        "totalCountOf",
        "untilAborted",
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
        "exceededJsonLimit",
        "finiteSchema",
        "abortSignalSchema",
        "findingsOf",
        "guardSchema",
        "hasMoreTokensThan",
        "httpsUrlSchema",
        "isAbsoluteUri",
        "isDate",
        "isDateTime",
        "isLanguageTag",
        "isRecord",
        "isUuid",
        "issueText",
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
        "pathOf",
        "positiveIntegerSchema",
        "positiveSchema",
        "refusalOf",
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
        "checkHttpRequest",
        "jsonResponse",
        "negotiate",
        "offsetPageLinks",
        "readAccessDecision",
        "readForm",
        "readJson",
        "readOffsetPage",
        "readQuery",
        "readText",
        "statusInfoResponse",
      ].sort(),
    );
  });

  it("exports from the oauth subpath only what the package documents", () => {
    expect(Object.keys(oauth).sort()).toStrictEqual(
      [
        "authorizationRequest",
        "clientCredentialsToken",
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
