import { describe, expect, it } from "vitest";
import * as checks from "../src/checks.js";
import * as http from "../src/http/index.js";
import * as root from "../src/index.js";
import * as oauth from "../src/oauth/index.js";

describe("the public API", () => {
  it("exports from the root only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "callService",
        "checkClock",
        "DataError",
        "DEFAULT_MAX_BYTES",
        "DEFAULT_TIMEOUT_MS",
        "InteropkitError",
        "readClock",
        "requestService",
        "ServiceError",
        "signCompactJws",
        "signerFromCryptoKey",
        "SYSTEM_CLOCK",
        "SYSTEM_RANDOM",
        "untilAborted",
      ].sort(),
    );
  });

  it("exports from the checks subpath only what the package documents", () => {
    expect(Object.keys(checks).sort()).toStrictEqual(
      [
        "checkAbortSignal",
        "checkArray",
        "checkFunction",
        "checkHttpsUrl",
        "checkNonEmptyString",
        "checkNonNegativeInteger",
        "checkPositiveInteger",
        "checkProperties",
        "checkRecord",
        "checkString",
        "describe",
        "finiteSchema",
        "guardSchema",
        "httpsUrlSchema",
        "isRecord",
        "issueText",
        "looseRecord",
        "mapSchema",
        "methodsSchema",
        "nonEmptyStringSchema",
        "nonNegativeIntegerSchema",
        "parseWith",
        "positiveIntegerSchema",
        "positiveSchema",
      ].sort(),
    );
  });

  it("exports from the http subpath only what the package documents", () => {
    expect(Object.keys(http).sort()).toStrictEqual(
      ["checkHttpRequest", "jsonResponse", "negotiate", "readForm", "readJson", "readQuery", "readText"].sort(),
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
        "revokeToken",
      ].sort(),
    );
  });
});
