import { describe, expect, it } from "vitest";
import { type LtiMessage, SCOPES } from "../src/index.js";
import { createServiceClient, ltiLaunch } from "../src/tool/index.js";
import { CONTAINER_URL, FakeLms, SUBJECT } from "./fake-lms.js";
import { cookieLogin, setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
/** The bytes that the reading may raise the peak of the process by: a parse of the answers below would take more. */
const BUDGET = 32 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one client.
describe("the peak memory of a page of a service", () => {
  it("stays within the budget for an answer of 1 MiB of empty objects, refused at the limit of tokens", async () => {
    const ctx = setup();
    const lms = new FakeLms(ctx.platform);
    const { request } = await cookieLogin(ctx, { claims: { sub: SUBJECT } });
    const launch = (await ltiLaunch(request, ctx.options)) as LtiMessage;
    const client = createServiceClient(launch, { ...ctx.options, fetch: lms.fetch, scopes: [SCOPES.lineitem] });
    const objects = Math.floor((MIB - 2) / 3);
    const body = `[${"{},".repeat(objects - 1)}{}]`;
    lms.answer = () => new Response(body, { headers: { "content-type": "application/json" } });
    const before = peak();
    await expect(client.lineItems(CONTAINER_URL)).rejects.toThrow("the limit of the option maxTokens");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
