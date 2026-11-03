import { describe, expect, it } from "vitest";
import { type EntrySize, entryPoints, entrySize } from "../../../scripts/entry-size.js";

/**
 * The budget of each entry point of the package, bundled alone as a host's bundler makes it (`scripts/entry-size.ts`): the most
 * bytes after gzip, 1.25 times those measured rounded up to the next 500, and every module other than its own that it holds, so
 * that an import which pulls another module into an entry point fails until the list says so. A budget changes only with the
 * reason in the commit that changes it.
 */
const ENTRY_BUDGETS: Readonly<Record<string, Pick<EntrySize, "gzip" | "holds">>> = {
  "@interopkit/course-launch": {
    gzip: 40_500,
    holds: [
      "@interopkit/core",
      "course-launch/model",
      "course-launch/rules",
      "course-launch/structure",
      "learning-records/model",
      "learning-records/read",
      "saxes",
      "valibot",
      "xmlchars",
    ],
  },
  "@interopkit/course-launch/lms": {
    gzip: 51_500,
    holds: [
      "@interopkit/core",
      "course-launch/model",
      "course-launch/rules",
      "course-launch/structure",
      "learning-records/build",
      "learning-records/model",
      "learning-records/read",
      "learning-records/store",
      "saxes",
      "uuid",
      "valibot",
      "xmlchars",
    ],
  },
  "@interopkit/course-launch/package": {
    gzip: 92_000,
    holds: [
      "@interopkit/core",
      "@zip.js/zip.js",
      "course-launch/model",
      "course-launch/structure",
      "saxes",
      "valibot",
      "xmlchars",
    ],
  },
};

const ENTRIES = entryPoints("course-launch");

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
