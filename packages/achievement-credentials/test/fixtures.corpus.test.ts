import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FILE_CASES, oracleOf, withOrderedPeriod } from "./official.js";

/** How many references the full value of a class follows. */
const DEPTH = 2;

describe.each(FILE_CASES)("$name", ({ name, schema }) => {
  it("has the full value that the schema generates in the fixtures that the offline tests read", async () => {
    const [value] = fc.sample(oracleOf(schema(), { full: true, depth: DEPTH }).arbitrary, { numRuns: 1, seed: 1 });
    await expect(`${JSON.stringify(withOrderedPeriod(value), null, 1)}\n`).toMatchFileSnapshot(`fixtures/${name}.json`);
  });
});
