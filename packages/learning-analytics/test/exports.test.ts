import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "buildEvent",
        "CALIPER_CONTEXT",
        "caliperTime",
        "checkIri",
        "DEFAULT_CALIPER_TIMEOUT_MS",
        "mintUrn",
        "sendCaliper",
      ].sort(),
    );
  });
});
