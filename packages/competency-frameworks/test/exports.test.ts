import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "ASSOCIATION_TYPES",
        "ENTITY_KINDS",
        "readEntity",
        "readPackage",
        "STATUS_CODES_MAJOR",
        "STATUS_CODES_MINOR",
        "STATUS_SEVERITIES",
        "toCaseVersion",
        "validateEntity",
        "validatePackage",
      ].sort(),
    );
  });
});
