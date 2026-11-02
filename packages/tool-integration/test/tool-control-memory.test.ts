import { afterEach, describe, expect, it, vi } from "vitest";
import { type LtiMessage, SCOPES } from "../src/index.js";
import { createServiceClient, ltiLaunch } from "../src/tool/index.js";
import { ISSUER } from "./fake-platform.js";
import { cookieLogin, setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
/**
 * The bytes that the readings may raise the peak of the process by. An answer of 1,000,000 tokens, the most that the limit lets in,
 * is parsed and takes about 130 MiB; an answer of 24 MiB that the limit of bytes refuses would take hundreds of megabytes more.
 */
const BUDGET = 256 * MIB;
const ACS_URL = `${ISSUER}/proctoring/acs`;
const CONTROL_TYPE = "application/vnd.ims.lti-ap.v1.control+json";

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

afterEach(() => vi.useRealTimers());

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one client.
describe("the peak memory of a control status", () => {
  it("stays within the budget for an answer just under the limits of bytes and tokens, and for an answer far above them", async () => {
    const ctx = setup();
    const { request } = await cookieLogin(ctx);
    const launch = (await ltiLaunch(request, ctx.options)) as LtiMessage;
    let body = "";
    const client = createServiceClient(launch, {
      ...ctx.options,
      fetch: async (url, init) =>
        url === ACS_URL
          ? new Response(body, { headers: { "content-type": CONTROL_TYPE } })
          : ctx.platform.fetch(url, init),
      scopes: [SCOPES.assessmentControl],
    });
    const control = {
      user: { issuer: ISSUER, subject: "a6d5c443" },
      resourceLink: { id: "exam-1" },
      attemptNumber: 1,
      action: "update" as const,
    };
    // Each `{},` is three bytes and three tokens of JSON, so the answer is the most that the limit of 1,000,000 tokens lets in.
    const objects = 330_000;
    body = `{"status":"running","list":[${"{},".repeat(objects - 1)}{}]}`;
    const huge = `{"status":"running","list":[${"{},".repeat(8 * MIB)}{}]}`;
    const before = peak();
    await expect(client.control(ACS_URL, control)).resolves.toEqual({ status: "running" });
    body = huge;
    await expect(client.control(ACS_URL, control)).rejects.toThrow("maxBytes");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
