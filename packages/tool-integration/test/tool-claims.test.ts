import { isRecord } from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import { readLaunch } from "../src/tool/internal.js";
import { deepLinkingClaims, registrationOf, resourceLinkClaims } from "./fake-platform.js";
import { fuzzJson } from "./fuzz.js";
import { SECONDS, toolKey } from "./tool-setup.js";

const registration = registrationOf(toolKey);
const examples: readonly Record<string, unknown>[] = [
  resourceLinkClaims("nonce-1", SECONDS),
  deepLinkingClaims("nonce-1", SECONDS),
];

describe("readLaunch", () => {
  it("reads the claims of a resource link launch as LTI Core Appendix E gives them", () => {
    expect(readLaunch(resourceLinkClaims("nonce-1", SECONDS), registration)).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      deploymentId: registration.deploymentIds[0],
      resourceLink: { id: "200d101f-2c14-434a-a0f3-57c2a42369fd", title: "Introduction Assignment" },
      roles: expect.arrayContaining(["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"]),
      ags: { lineitem: "https://lms.example.edu/2344/lineitems/1234/lineitem" },
    });
  });

  it("reads the settings of a Deep Linking request as Deep Linking Appendix A gives them", () => {
    expect(readLaunch(deepLinkingClaims("nonce-1", SECONDS), registration)).toMatchObject({
      messageType: "LtiDeepLinkingRequest",
      settings: { acceptMultiple: true, data: "deep-link-data-1" },
    });
  });

  it("reads a blank or null line item of the grade services as absent", () => {
    const endpoint = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";
    for (const lineitem of [null, ""]) {
      const claims = { ...resourceLinkClaims("nonce-1", SECONDS), [endpoint]: { scope: [], lineitem } };
      const launch = readLaunch(claims, registration);
      expect(launch.messageType === "LtiResourceLinkRequest" && launch.ags?.lineitem).toBeUndefined();
    }
  });

  it("returns a value or throws a DataError or an LtiError for any claims, and for the examples with any value replaced", () => {
    fuzzJson((json) => (isRecord(json) ? readLaunch(json, registration) : undefined), examples);
  });
});
