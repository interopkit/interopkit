import { describe, expect, it } from "vitest";
import { type EntrySize, entryPoints, entrySize } from "../../../scripts/entry-size.js";

/**
 * The budget of each entry point of the package, bundled alone as a host's bundler makes it (`scripts/entry-size.ts`): the most
 * bytes after gzip, 1.25 times those measured rounded up to the next 500, and every module other than its own that it holds, so
 * that an import which pulls another module into an entry point fails until the list says so. docs/learning-records/performance.md
 * lists the sizes. A budget changes only with the reason in the commit that changes it.
 */
const ENTRY_BUDGETS: Readonly<Record<string, Pick<EntrySize, "gzip" | "holds">>> = {
  "@interopkit/learning-records": {
    gzip: 24_500,
    holds: [
      "@interopkit/core",
      "@noble/hashes",
      "learning-records/build",
      "learning-records/compare",
      "learning-records/format",
      "learning-records/model",
      "learning-records/read",
      "uuid",
      "valibot",
    ],
  },
  "@interopkit/learning-records/attachments": {
    gzip: 28_500,
    holds: [
      "@interopkit/core",
      "@noble/hashes",
      "@remix-run/headers",
      "@remix-run/multipart-parser",
      "learning-records/model",
      "learning-records/read",
      "valibot",
    ],
  },
  "@interopkit/learning-records/client": {
    gzip: 36_000,
    holds: [
      "@interopkit/core",
      "@noble/hashes",
      "@remix-run/headers",
      "@remix-run/multipart-parser",
      "learning-records/attachments",
      "learning-records/compare",
      "learning-records/model",
      "learning-records/read",
      "valibot",
    ],
  },
  "@interopkit/learning-records/signing": {
    gzip: 32_000,
    holds: [
      "@interopkit/core",
      "@noble/hashes",
      "jose",
      "learning-records/attachments",
      "learning-records/compare",
      "learning-records/model",
      "learning-records/read",
      "valibot",
    ],
  },
  "@interopkit/learning-records/store": {
    gzip: 56_500,
    holds: [
      "@interopkit/core",
      "@noble/hashes",
      "@remix-run/headers",
      "@remix-run/multipart-parser",
      "jose",
      "learning-records/attachments",
      "learning-records/compare",
      "learning-records/format",
      "learning-records/model",
      "learning-records/read",
      "learning-records/signing",
      "valibot",
    ],
  },
};

const ENTRIES = entryPoints("learning-records");

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
