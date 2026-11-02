import { describe, expect, it } from "vitest";
import { type LtiMessage, SCOPES } from "../src/index.js";
import { createServiceClient, ltiLaunch } from "../src/tool/index.js";
import { CONTAINER_URL, FakeLms, SUBJECT } from "./fake-lms.js";
import { cookieLogin, setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
/**
 * The bytes that the readings may raise the peak of the process by. A page of 1,000,000 tokens, the most that the limit lets in, is
 * parsed and its extension copied, and takes about 130 MiB; an answer of 1 MiB of empty objects, which the limit of tokens refuses
 * before it is parsed, takes a few.
 */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one client.
describe("the peak memory of a page of a service", () => {
  it("stays within the budget for a page just under the limit of tokens, and for 1 MiB of empty objects, refused at it", async ({
    annotate,
  }) => {
    const ctx = setup();
    const lms = new FakeLms(ctx.platform);
    const { request } = await cookieLogin(ctx, { claims: { sub: SUBJECT } });
    const launch = (await ltiLaunch(request, ctx.options)) as LtiMessage;
    const client = createServiceClient(launch, { ...ctx.options, fetch: lms.fetch, scopes: [SCOPES.lineitem] });
    // One line item with an extension of empty objects, three bytes and three tokens each: the most that the limit of 1,000,000
    // tokens lets in, which the reader copies.
    const extension = `[${"{},".repeat(329_999)}{}]`;
    const page = `[{"id":"${CONTAINER_URL}/1","label":"a","scoreMaximum":1,"https://x.example/e":${extension}}]`;
    const objects = Math.floor((MIB - 2) / 3);
    let body = page;
    lms.answer = () => new Response(body, { headers: { "content-type": "application/json" } });
    const before = peak();
    expect((await client.lineItems(CONTAINER_URL)).items).toHaveLength(1);
    body = `[${"{},".repeat(objects - 1)}{}]`;
    await expect(client.lineItems(CONTAINER_URL)).rejects.toThrow("the limit of the option maxTokens");
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
