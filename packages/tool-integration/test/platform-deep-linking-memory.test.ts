// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims are those of the specifications.

import { describe, expect, it } from "vitest";
import { readDeepLinkingResponse } from "../src/platform/index.js";
import { messageForm, TOOL_DEPLOYMENT_ID, toolMessage } from "./fake-tool.js";
import { baseFields, ISSUER, launch, setup, toolKeys, toolMessageOptions } from "./platform-setup.js";

const MIB = 1024 * 1024;
/** The bytes that the readings may raise the peak of the process by: building a tree of the whole form would take more. */
const BUDGET = 64 * MIB;
const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const DL = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const RETURN_URL = "https://lms.platform.example/deep-linking";

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one reader.
describe("the peak memory of readDeepLinkingResponse", () => {
  it("stays within the budget for a form of under 1 MiB that lists 10,000 items, which it refuses by their number", async ({
    annotate,
  }) => {
    const ctx = setup();
    const { claims } = await launch(ctx, {
      ...baseFields,
      messageType: "LtiDeepLinkingRequest",
      settings: { returnUrl: RETURN_URL, acceptTypes: ["html"], acceptPresentationDocumentTargets: ["iframe"] },
    });
    const common = {
      [`${CLAIM}message_type`]: "LtiDeepLinkingResponse",
      [`${CLAIM}version`]: "1.3.0",
      [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
      [`${DL}data`]: (claims[`${DL}deep_linking_settings`] as { data: string }).data,
    };
    const items = Array.from({ length: 10_000 }, (_, index) => ({ type: "html", html: "", title: `item ${index}` }));
    const listing = messageForm(
      ISSUER,
      await toolMessage(toolKeys, ISSUER, ctx.clock, { ...common, [`${DL}content_items`]: items }),
    );
    expect(listing.body.byteLength).toBeGreaterThan(MIB / 2);
    expect(listing.body.byteLength).toBeLessThan(MIB);
    const before = peak();
    await expect(readDeepLinkingResponse(listing, toolMessageOptions(ctx))).rejects.toMatchObject({
      reason: "content-items-limit",
    });
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
