import { afterEach, describe, expect, it, vi } from "vitest";
import { SCOPES } from "../src/index.js";
import { clientAssertion, tokenRequest, toolRegistration } from "./fake-tool.js";
import { request } from "./fixture.js";
import { endpoints, handle, PLATFORM_ORIGIN, setup, toolKeys } from "./platform-setup.js";
import { textOf } from "./text-of.js";

const MIB = 1024 * 1024;
/** The bytes that the requests may raise the peak of the process by. */
const BUDGET = 32 * MIB;
/** The most bytes of the body of a request to the platform by default. */
const MAX_BODY_BYTES = 65_536;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

afterEach(() => vi.useRealTimers());

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one handler.
describe("the peak memory of the bodies of the Assessment Control Service", () => {
  it("stays within the budget for control requests of 64 KiB of nesting and of arrays", async () => {
    const ctx = setup({ tools: [toolRegistration({ scopes: [SCOPES.assessmentControl] })] });
    const services = { control: { control: async () => ({ status: "running" as const }) } };
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const granted = await handle(ctx, tokenRequest(endpoints.token, assertion, SCOPES.assessmentControl), { services });
    const token = JSON.parse(textOf(granted.body)).access_token;
    const nesting = `${"[".repeat(MAX_BODY_BYTES / 2)}${"]".repeat(MAX_BODY_BYTES / 2)}`;
    const array = `[${"0,".repeat(MAX_BODY_BYTES / 2 - 2)}0]`;
    const posts = [nesting, array].map((body) =>
      request({
        url: `${PLATFORM_ORIGIN}/assessment-control`,
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/vnd.ims.lti-ap.v1.control+json" },
        body,
      }),
    );
    const before = peak();
    for (const post of posts) expect((await handle(ctx, post, { services })).status).toBe(400);
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
