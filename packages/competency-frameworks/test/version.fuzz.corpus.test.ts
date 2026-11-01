import { describe, it } from "vitest";
import { ENTITY_KINDS } from "../src/index.js";
import { convertsOrRefuses } from "./fuzz.js";
import { officialArbitrary } from "./official.js";

describe("the conversion on the values that the official schemas describe", () => {
  it.each(["package", ...ENTITY_KINDS] as const)("converts %s with a change, or throws a DataError", (kind) => {
    convertsOrRefuses(officialArbitrary("1.1", kind, "1.1"));
  });
});
