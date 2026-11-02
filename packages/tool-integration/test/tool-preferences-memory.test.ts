import { describe, expect, it } from "vitest";
import { type LtiMessage, SCOPES } from "../src/index.js";
import { createServiceClient, ltiLaunch } from "../src/tool/index.js";
import { FakeRosterLms, PNP_HOST } from "./fake-roster.js";
import { cookieLogin, setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
/**
 * The bytes that the readings may raise the peak of the process by. A record of 1,000,000 tokens, the most that the limit lets in,
 * is parsed and copied and takes about 130 MiB; an answer of 24 MiB that the limit of bytes refuses would take hundreds of megabytes more.
 */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one client.
describe("the peak memory of a preferences record", () => {
  it("stays within the budget for a record just under the limits of bytes and tokens, and for an answer far above them", async () => {
    const ctx = setup();
    const lms = new FakeRosterLms(ctx.platform);
    const { request } = await cookieLogin(ctx);
    const launch = (await ltiLaunch(request, ctx.options)) as LtiMessage;
    const client = createServiceClient(launch, {
      ...ctx.options,
      fetch: lms.fetch,
      scopes: [SCOPES.preferencesRecordReadonly],
    });
    // Each `{},` is three bytes and three tokens of JSON, so the record is the most that the limit of 1,000,000 tokens lets in.
    const objects = 330_000;
    const body = `{"list":[${"{},".repeat(objects - 1)}{}]}`;
    lms.answer = () => new Response(body, { headers: { "content-type": "application/json" } });
    const claim = { hostUrl: PNP_HOST, activityIds: ["a"], scopes: [SCOPES.preferencesRecordReadonly] };
    const huge = `{"list":[${"{},".repeat(8 * MIB)}{}]}`;
    const before = peak();
    const record = await client.preferences(claim, "ana-1", "a");
    expect(record?.list).toHaveLength(objects);
    lms.answer = () => new Response(huge, { headers: { "content-type": "application/json" } });
    await expect(client.preferences(claim, "ana-1", "a")).rejects.toThrow("maxBytes");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
