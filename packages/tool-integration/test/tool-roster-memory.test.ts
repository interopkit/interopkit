import { describe, expect, it } from "vitest";
import { type LtiMessage, SCOPES } from "../src/index.js";
import { createServiceClient, ltiLaunch } from "../src/tool/index.js";
import { FakeRosterLms, MEMBERSHIPS_URL } from "./fake-roster.js";
import { cookieLogin, setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
/**
 * The bytes that the readings may raise the peak of the process by. A page of 1,000,000 tokens, the most that the limit lets in, is
 * parsed and its extension copied, and takes about 50 MiB; an answer of 1 MiB of members, which the limit of tokens refuses before
 * it is parsed, takes a few.
 */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one client.
describe("the peak memory of a page of members", () => {
  it("stays within the budget for a page just under the limit of tokens, and for 1 MiB of empty members, refused at it", async () => {
    const ctx = setup();
    const lms = new FakeRosterLms(ctx.platform);
    const { request } = await cookieLogin(ctx);
    const launch = (await ltiLaunch(request, ctx.options)) as LtiMessage;
    const client = createServiceClient(launch, {
      ...ctx.options,
      fetch: lms.fetch,
      scopes: [SCOPES.contextMembershipReadonly],
    });
    // One member with an extension of empty objects, three bytes and three tokens each: the most that the limit of 1,000,000
    // tokens lets in, which the reader copies.
    const extension = `[${"{},".repeat(329_999)}{}]`;
    const page = `{"id":"${MEMBERSHIPS_URL}","context":{"id":"c"},"members":[{"user_id":"u","roles":[],"https://x.example/e":${extension}}]}`;
    const objects = Math.floor((MIB - 200) / 3);
    const refused = `{"id":"${MEMBERSHIPS_URL}","context":{"id":"c"},"members":[${"{},".repeat(objects - 1)}{}]}`;
    let body = page;
    lms.answer = () => new Response(body, { headers: { "content-type": "application/json" } });
    const before = peak();
    expect((await client.members(MEMBERSHIPS_URL)).items).toHaveLength(1);
    body = refused;
    await expect(client.members(MEMBERSHIPS_URL)).rejects.toThrow("the limit of the option maxTokens");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
