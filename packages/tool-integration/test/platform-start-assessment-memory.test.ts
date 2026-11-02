// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims are those of the specifications.

import { describe, expect, it } from "vitest";
import { readStartAssessment } from "../src/platform/index.js";
import { messageForm, TOOL_DEPLOYMENT_ID, toolMessage } from "./fake-tool.js";
import { baseFields, ISSUER, launch, setup, toolKeys, toolMessageOptions } from "./platform-setup.js";

const MIB = 1024 * 1024;
/** The bytes that the reading may raise the peak of the process by: a form of 64 KiB is far less. */
const BUDGET = 32 * MIB;
/** The most bytes of the form of a Start Assessment message by default. */
const FORM_LIMIT = 65_536;
const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const AP = "https://purl.imsglobal.org/spec/lti-ap/claim/";
const START_URL = "https://lms.platform.example/proctoring/start";

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one reader.
describe("the peak memory of readStartAssessment", () => {
  it("stays within the budget for a form at the limit whose token is one array of small objects", async ({
    annotate,
  }) => {
    const ctx = setup();
    const { claims } = await launch(ctx, {
      ...baseFields,
      messageType: "LtiStartProctoring",
      resourceLink: { id: "exam-1" },
      attemptNumber: 1,
      startAssessmentUrl: START_URL,
    });
    // A base64url payload is 4/3 of its JSON, so 46,000 bytes of `{},` fill a form of 64 KiB with the rest of the token.
    const objects = Array.from({ length: 15_400 }, () => ({}));
    const jwt = await toolMessage(toolKeys, ISSUER, ctx.clock, {
      [`${CLAIM}message_type`]: "LtiStartAssessment",
      [`${CLAIM}version`]: "1.3.0",
      [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
      [`${AP}session_data`]: claims[`${AP}session_data`],
      [`${CLAIM}resource_link`]: { id: "exam-1" },
      [`${AP}attempt_number`]: 1,
      "https://tool.example.com/padding": objects,
    });
    const form = messageForm(START_URL, jwt);
    expect(form.body.byteLength).toBeGreaterThan(FORM_LIMIT - 4096);
    expect(form.body.byteLength).toBeLessThanOrEqual(FORM_LIMIT);
    const before = peak();
    await expect(readStartAssessment(form, toolMessageOptions(ctx))).resolves.toMatchObject({ attemptNumber: 1 });
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
