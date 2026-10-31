import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { deepLinkResponse, ltiLaunch } from "../src/tool/index.js";
import { readToken } from "./fixture.js";
import { cookieLogin, deepLinkingOf, setup } from "./tool-setup.js";

describe("a line item of a Deep Linking item", () => {
  async function launchOf() {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
    return { ctx, launch: deepLinkingOf(await ltiLaunch(post, ctx.options)) };
  }

  it("carries its label, resource identifier and tag into the signed content item", async () => {
    const { ctx, launch } = await launchOf();
    const lineItem = { scoreMaximum: 100, label: "Exam", resourceId: "exam-1", tag: "final" };
    const jwt = await deepLinkResponse(launch, [{ title: "Exam", lineItem }], ctx.options);
    expect(readToken(jwt).payload["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"]).toEqual([
      { type: "ltiResourceLink", title: "Exam", lineItem },
    ]);
  });

  it("is refused when its label is not text", async () => {
    const { ctx, launch } = await launchOf();
    const lineItem = JSON.parse('{"scoreMaximum": 100, "label": 5}');
    await expect(deepLinkResponse(launch, [{ lineItem }], ctx.options)).rejects.toStrictEqual(
      new DataError("The label of a line item must be a string, found 5."),
    );
  });
});
