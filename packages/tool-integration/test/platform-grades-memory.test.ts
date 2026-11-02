import { afterEach, describe, expect, it, vi } from "vitest";
import { SCOPES } from "../src/index.js";
import { clientAssertion, TOOL_CLIENT_ID, tokenRequest, toolRegistration } from "./fake-tool.js";
import { request } from "./fixture.js";
import { MemoryGradebook } from "./gradebook.js";
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
describe("the peak memory of the bodies of the grade services", () => {
  it("stays within the budget for line items and scores of 64 KiB of nesting and of arrays", async () => {
    const ctx = setup({ tools: [toolRegistration({ scopes: [SCOPES.lineitem, SCOPES.score] })] });
    const gradebook = new MemoryGradebook(TOOL_CLIENT_ID).add("course-1", {
      id: "quiz",
      label: "Quiz",
      scoreMaximum: 1,
    });
    const services = { gradebook };
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const granted = await handle(ctx, tokenRequest(endpoints.token, assertion, `${SCOPES.lineitem} ${SCOPES.score}`), {
      services,
    });
    const token = JSON.parse(textOf(granted.body)).access_token;
    const nesting = `${"[".repeat(MAX_BODY_BYTES / 2)}${"]".repeat(MAX_BODY_BYTES / 2)}`;
    const array = `[${"0,".repeat(MAX_BODY_BYTES / 2 - 2)}0]`;
    const container = `${PLATFORM_ORIGIN}/contexts/course-1/line-items`;
    const posts = [
      [container, "application/vnd.ims.lis.v2.lineitem+json"],
      [`${container}/quiz/scores`, "application/vnd.ims.lis.v1.score+json"],
    ].flatMap(([url = "", type = ""]) =>
      [nesting, array].map((body) =>
        request({ url, method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": type }, body }),
      ),
    );
    const before = peak();
    for (const post of posts) expect((await handle(ctx, post, { services })).status).toBe(400);
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
