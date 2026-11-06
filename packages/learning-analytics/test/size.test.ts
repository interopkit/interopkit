import { describe, expect, it } from "vitest";
import { type EntrySize, entryPoints, entrySize } from "../../../scripts/entry-size.js";

/**
 * The budget of each entry point of the package, bundled alone as a host's bundler makes it (`scripts/entry-size.ts`): the
 * most bytes after gzip, 1.25 times those measured rounded up to the next 500, and every module other than its own that it
 * holds, so that an import which pulls another module into an entry point fails until the list says so.
 * docs/learning-analytics/performance.md lists the sizes. Every budget is set again by this rule from main before a release,
 * and one budget, in a commit that says why, when its entry passes it; gzip is measured on Node.js 22.
 */
const ENTRY_BUDGETS: Readonly<Record<string, Pick<EntrySize, "gzip" | "holds">>> = {
  "@interopkit/learning-analytics": {
    gzip: 27_500,
    holds: [
      "@interopkit/core",
      "learning-analytics/build",
      "learning-analytics/model",
      "learning-analytics/read",
      "learning-analytics/send",
      "learning-analytics/v1p1",
      "learning-analytics/validate",
      "uuid",
      "valibot",
    ],
  },
  "@interopkit/learning-analytics/endpoint": {
    gzip: 24_000,
    holds: [
      "@interopkit/core",
      "learning-analytics/model",
      "learning-analytics/read",
      "learning-analytics/v1p1",
      "learning-analytics/validate",
      "valibot",
    ],
  },
};

const ENTRIES = entryPoints("learning-analytics");

describe("every entry point bundled alone", () => {
  it("has a budget for each entry point of the package, and none for a name that is not one", () => {
    expect(Object.keys(ENTRY_BUDGETS).sort()).toStrictEqual([...ENTRIES].sort());
  });

  it.each(ENTRIES)("keeps %s within its budget, holding only the modules it lists", async (specifier) => {
    const { gzip, holds } = await entrySize(specifier);
    const budget = ENTRY_BUDGETS[specifier] ?? expect.unreachable(`No budget for ${specifier}.`);
    expect(gzip, `The gzipped bytes of ${specifier}`).toBeLessThan(budget.gzip);
    expect(holds, `The modules other than its own in ${specifier}`).toStrictEqual(budget.holds);
  });
});
