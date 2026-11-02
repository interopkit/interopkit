import { describe, expect, it } from "vitest";
import { createCaseClient } from "../src/client/index.js";
import { framework } from "./bank.js";
import { fakeProvider } from "./fake-provider.js";

const MIB = 1024 * 1024;
/** The most bytes of an answer that a client reads unless it is told another: 16 MiB. */
const MAX_BYTES = 16 * MIB;
/**
 * The bytes that the reading may raise the peak of the process by: the text, its parse and the package that the reader returns.
 * A client that read an answer without its limit of bytes would take far more.
 */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** The text of the largest framework of the bank that an answer of at most 16 MiB holds. */
function largestFramework(): { readonly text: string; readonly items: number } {
  for (let items = 15_000; ; items -= 100) {
    const text = JSON.stringify(framework(items));
    if (new TextEncoder().encode(text).byteLength <= MAX_BYTES) return { text, items };
  }
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of a client that reads the largest package its limits take", () => {
  it("stays within the budget, and reads every item", async ({ annotate }) => {
    const { text, items } = largestFramework();
    const provider = fakeProvider(() => ({ body: text }));
    const client = createCaseClient({ baseUrl: "https://case.example.org", fetch: provider.fetch });
    const before = peak();
    const pkg = await client.package("00000000-0000-4000-8000-000000000001");
    const rise = peak() - before;
    expect(pkg?.CFItems).toHaveLength(items);
    await annotate(
      `The answer has ${items} items in ${text.length} bytes; the peak rose by ${(rise / MIB).toFixed(1)} MiB.`,
    );
    expect(rise).toBeLessThan(BUDGET);
  });
});
