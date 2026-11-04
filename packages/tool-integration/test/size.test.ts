import { describe, expect, it } from "vitest";
import { type EntrySize, entryPoints, entrySize } from "../../../scripts/entry-size.js";

/** The modules of the package and the dependencies that every entry point holds: what the two roles share. */
const SHARED = ["@interopkit/core", "jose", "tool-integration/errors", "tool-integration/protocol", "valibot"];

/**
 * The budget of each entry point of the package, bundled alone as a host's bundler makes it (`scripts/entry-size.ts`): the most
 * bytes after gzip, 1.25 times those measured rounded up to the next 500, and every module other than its own that it holds, so
 * that an import which pulls another module into an entry point fails until the list says so: the platform never holds the tool,
 * nor the tool the platform. docs/tool-integration/performance.md lists the sizes. A budget changes only with the reason in the
 * commit that changes it.
 */
const ENTRY_BUDGETS: Readonly<Record<string, Pick<EntrySize, "gzip" | "holds">>> = {
  "@interopkit/tool-integration": { gzip: 10_500, holds: SHARED },
  "@interopkit/tool-integration/platform": { gzip: 55_500, holds: SHARED },
  // The tool obtains its access tokens with the OAuth 2.0 client of core.
  "@interopkit/tool-integration/tool": { gzip: 54_000, holds: [...SHARED, "oauth4webapi"].sort() },
};

const ENTRIES = entryPoints("tool-integration");

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
