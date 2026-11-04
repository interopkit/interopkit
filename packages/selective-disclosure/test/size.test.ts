import { describe, expect, it } from "vitest";
import { type EntrySize, entryPoints, entrySize } from "../../../scripts/entry-size.js";

/**
 * The budget of the entry point of the package, bundled alone as a host's bundler makes it (`scripts/entry-size.ts`): the most
 * bytes after gzip, 1.25 times those measured rounded up to the next 500, and every module other than its own that it holds, so
 * that an import which pulls another module into the entry point fails until the list says so. docs/selective-disclosure/performance.md
 * lists the size. A budget changes only with the reason in the commit that changes it.
 */
const ENTRY_BUDGETS: Readonly<Record<string, Pick<EntrySize, "gzip" | "holds">>> = {
  "@interopkit/selective-disclosure": {
    gzip: 88_000,
    holds: [
      "@digitalbazaar/di-sd-primitives",
      "@interopkit/core",
      "@noble/curves",
      "@noble/hashes",
      "@scure/base",
      "base64url",
      "base64url-universal",
      "canonicalize",
      "cborg",
      "jsonld",
      "klona",
      "lru-cache",
      "rdf-canonize",
      "selective-disclosure/base",
      "selective-disclosure/derive",
      "selective-disclosure/document",
      "selective-disclosure/keys",
      "selective-disclosure/proof-value",
      "selective-disclosure/suite",
      "selective-disclosure/verify",
      "setimmediate",
      "valibot",
      "yallist",
    ],
  },
};

const ENTRIES = entryPoints("selective-disclosure");

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
