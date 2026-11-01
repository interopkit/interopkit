import { describe, expect, it } from "vitest";
import { APPROVED_EXCEPTIONS, disallowed, isAllowed } from "../check-licenses.ts";

describe("isAllowed", () => {
  it("accepts MIT, Apache-2.0, BSD and ISC", () => {
    for (const license of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]) {
      expect(isAllowed(license), license).toBe(true);
    }
  });

  it("accepts an expression when one alternative of an OR is allowed", () => {
    expect(isAllowed("MIT OR GPL-3.0-only")).toBe(true);
    expect(isAllowed("(GPL-3.0-only OR MPL-2.0)")).toBe(false);
  });

  it("accepts an AND only when every part is allowed", () => {
    expect(isAllowed("MIT AND ISC")).toBe(true);
    expect(isAllowed("MIT AND CC-BY-4.0")).toBe(false);
  });

  it("refuses other licenses", () => {
    for (const license of ["GPL-3.0-only", "MPL-2.0", "WTFPL", "UNLICENSED", ""]) {
      expect(isAllowed(license), license).toBe(false);
    }
  });
});

describe("disallowed", () => {
  it("names each package whose license is not allowed, with its versions", () => {
    const report = {
      MIT: [{ name: "valibot", versions: ["1.5.0"] }],
      "GPL-3.0-only": [{ name: "copyleft", versions: ["1.0.0", "2.0.0"] }],
    };
    expect(disallowed(report)).toStrictEqual(["copyleft@1.0.0 (GPL-3.0-only)", "copyleft@2.0.0 (GPL-3.0-only)"]);
  });

  it("returns nothing for a report of allowed licenses", () => {
    expect(disallowed({ ISC: [{ name: "a", versions: ["1.0.0"] }] })).toStrictEqual([]);
  });

  it("lets an approved package through only under the license that was approved", () => {
    expect(APPROVED_EXCEPTIONS.get("lru-cache")).toBe("BlueOak-1.0.0");
    expect(disallowed({ "BlueOak-1.0.0": [{ name: "lru-cache", versions: ["11.5.3"] }] })).toStrictEqual([]);
    expect(disallowed({ "GPL-3.0-only": [{ name: "lru-cache", versions: ["11.5.3"] }] })).toStrictEqual([
      "lru-cache@11.5.3 (GPL-3.0-only)",
    ]);
    expect(disallowed({ "BlueOak-1.0.0": [{ name: "other", versions: ["1.0.0"] }] })).toStrictEqual([
      "other@1.0.0 (BlueOak-1.0.0)",
    ]);
  });
});
