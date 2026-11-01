import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      ["addBaseProof", "deriveProof", "isBaseProof", "selectiveDisclosureSuite"].sort(),
    );
  });
});
