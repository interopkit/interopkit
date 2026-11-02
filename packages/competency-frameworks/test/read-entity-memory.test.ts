import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { readEntity } from "../src/index.js";
import { id, uri } from "./full-package.js";

const MIB = 1024 * 1024;
/** The bytes that the reading may raise the peak of the process by. A reading that kept an issue for each wrong value would take about 1 GB. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading the associations of an item with a million wrong ones", () => {
  it("stays within the budget, and counts the errors of the limit", async ({ annotate }) => {
    const item = {
      identifier: id(2),
      uri: uri("CFItems", 2),
      fullStatement: "Explain how a quantity changes.",
      CFDocumentURI: { title: "A framework", identifier: id(1), uri: uri("CFDocuments", 1) },
      lastChangeDateTime: "2024-06-13T18:46:03+00:00",
    };
    const value = { CFItem: item, CFAssociations: new Array(1_000_000).fill(0) };
    const before = peak();
    expect(() => readEntity("CFAssociationSet", value)).toThrow(DataError);
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
