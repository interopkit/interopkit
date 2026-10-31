import { describe, expect, it } from "vitest";
import * as checks from "../src/checks.js";
import * as root from "../src/index.js";

describe("the public API", () => {
  it("exports from the root only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "callService",
        "checkClock",
        "DataError",
        "DEFAULT_TIMEOUT_MS",
        "InteropkitError",
        "readClock",
        "ServiceError",
        "SYSTEM_CLOCK",
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
});
