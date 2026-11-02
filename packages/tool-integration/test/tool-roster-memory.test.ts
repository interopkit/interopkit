import { describe, expect, it } from "vitest";
import { type LtiMessage, SCOPES } from "../src/index.js";
import { createServiceClient, ltiLaunch } from "../src/tool/index.js";
import { FakeRosterLms, MEMBERSHIPS_URL } from "./fake-roster.js";
import { cookieLogin, setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
/** The bytes that the reading may raise the peak of the process by: a parse of the answer below would take more. */
const BUDGET = 32 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one client.
describe("the peak memory of a page of members", () => {
  it("stays within the budget for an answer of 1 MiB of empty members, refused at the limit of tokens", async () => {
    const ctx = setup();
    const lms = new FakeRosterLms(ctx.platform);
    const { request } = await cookieLogin(ctx);
    const launch = (await ltiLaunch(request, ctx.options)) as LtiMessage;
    const client = createServiceClient(launch, {
      ...ctx.options,
      fetch: lms.fetch,
      scopes: [SCOPES.contextMembershipReadonly],
    });
    const objects = Math.floor((MIB - 200) / 3);
    const body = `{"id":"${MEMBERSHIPS_URL}","context":{"id":"c"},"members":[${"{},".repeat(objects - 1)}{}]}`;
    lms.answer = () => new Response(body, { headers: { "content-type": "application/json" } });
    const before = peak();
    await expect(client.members(MEMBERSHIPS_URL)).rejects.toThrow("the limit of the option maxTokens");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
