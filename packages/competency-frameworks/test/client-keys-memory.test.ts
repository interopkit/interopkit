import { describe, expect, it } from "vitest";
import { createCaseClient } from "../src/client/index.js";
import { fakeProvider } from "./fake-provider.js";
import { id, uri } from "./full-package.js";

const MIB = 1024 * 1024;
/**
 * The bytes that the reading may raise the peak of the process by. An object of distinct keys costs the most memory for its
 * tokens: the parse, the copy of the extensions and the package. A client that read an answer without its limits would take
 * far more, since the cost grows with the answer.
 */
const BUDGET = 512 * MIB;

/** The most members of an object that the default limit of 2,000,000 tokens takes: four tokens each, a key, a colon, a value and a comma. */
const MEMBERS = 499_000;

/** The characters of each key, so that the answer is as close to the default limit of 16 MiB as the members allow. */
const KEY_LENGTH = 28;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** The text of a package whose document has extensions of as many distinct keys as the default limits take. */
function widestAnswer(): string {
  let members = "";
  for (let index = 0; index < MEMBERS; index += 1) {
    members += `${index === 0 ? "" : ","}"${String(index).padStart(KEY_LENGTH, "k")}":0`;
  }
  const document = JSON.stringify({
    identifier: id(1),
    uri: uri("CFDocuments", 1),
    creator: "Ministry of Education",
    title: "A framework",
    lastChangeDateTime: "2024-06-13T18:46:03+00:00",
  });
  return `{"CFDocument":${document.slice(0, -1)},"extensions":{${members}}}}`;
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of a client that reads extensions of as many distinct keys as its limits take", () => {
  it("stays within the budget, and reads every key", async ({ annotate }) => {
    const text = widestAnswer();
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(16 * MIB);
    const provider = fakeProvider(() => ({ body: text }));
    const client = createCaseClient({ baseUrl: "https://case.example.org", fetch: provider.fetch });
    const before = peak();
    const pkg = await client.package(id(1));
    const rise = peak() - before;
    expect(Object.keys(pkg?.CFDocument.extensions ?? {})).toHaveLength(MEMBERS);
    await annotate(
      `The answer has ${MEMBERS} keys in ${text.length} bytes; the peak rose by ${(rise / MIB).toFixed(1)} MiB.`,
    );
    expect(rise).toBeLessThan(BUDGET);
  });
});
