import { describe, expect, it } from "vitest";
import { handleCaseRequest } from "../src/provider/index.js";
import { DISCOVERY, memoryStore } from "./provider-fixture.js";

const MIB = 1024 * 1024;
/** The bytes that the request may raise the peak of the process by. With no limit on the fields list, it took 629 MiB. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one request.
describe("the peak memory of a request with a fields list of 10 MiB", () => {
  it("is refused within the budget, before the list is split", async ({ annotate }) => {
    const url = `https://case.example.org/ims/case/v1p1/CFDocuments?fields=${"title,".repeat(1_747_626)}title`;
    const request = { method: "GET", url, headers: {}, body: new Uint8Array() };
    const before = peak();
    const response = await handleCaseRequest(request, { store: memoryStore(), discovery: DISCOVERY });
    const rise = peak() - before;
    expect(response.status).toBe(400);
    await annotate(`The URL has ${url.length} characters; the peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
