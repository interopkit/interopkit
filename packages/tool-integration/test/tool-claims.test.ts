import { readFileSync } from "node:fs";
import { isRecord } from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import { readLaunch } from "../src/tool/internal.js";
import { deepLinkingClaims, registrationOf, resourceLinkClaims } from "./fake-platform.js";
import { fuzzJson } from "./fuzz.js";
import { SECONDS, toolKey } from "./tool-setup.js";

const registration = registrationOf(toolKey);
const RESOURCE_LINK = "https://purl.imsglobal.org/spec/lti/claim/resource_link";
const CUSTOM = "https://purl.imsglobal.org/spec/lti/claim/custom";
/**
 * The claims of a launch from Canvas, as a Canvas engineer published them in September 2020 (gist 893d18f8a1bb36cb79d0a24324475fe6):
 * `title` and `description` are `null`, and `canvas_user_uuid` is a number. Names, e-mail address and host names are replaced.
 */
const canvas: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./fixtures/canvas-launch.json", import.meta.url), "utf8"),
);
const canvasRegistration = {
  ...registration,
  deploymentIds: [String(canvas["https://purl.imsglobal.org/spec/lti/claim/deployment_id"])],
};
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

  it("reads the launch of Canvas as it sends it: a null title and description, and a number in the custom properties", () => {
    const launch = readLaunch(canvas, canvasRegistration);
    expect(launch).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      resourceLink: { id: "7f956bcc8f67cd076ae464862ce83596a1bb3293" },
      custom: new Map([
        ["canvas_user_uuid", "170000004597788"],
        ["canvas_api_domain", "school.instructure.com"],
        ["canvas_account_uuid", "LC6nuzxUST0u7aNHCm0yCjEww5wAtjO5GiSlrHMu"],
      ]),
    });
    expect(launch.messageType === "LtiResourceLinkRequest" && launch.resourceLink).toStrictEqual({
      id: "7f956bcc8f67cd076ae464862ce83596a1bb3293",
      title: undefined,
      description: undefined,
    });
  });

  it("reads a null title or description of a resource link as absent, and keeps a string", () => {
    const base = resourceLinkClaims("nonce-1", SECONDS);
    const link = base[RESOURCE_LINK] as Record<string, unknown>;
    for (const change of [{ title: null }, { description: null }, { title: null, description: null }]) {
      const launch = readLaunch({ ...base, [RESOURCE_LINK]: { ...link, ...change } }, registration);
      const read = launch.messageType === "LtiResourceLinkRequest" ? launch.resourceLink : undefined;
      for (const name of ["title", "description"] as const) {
        if (name in change) expect(read?.[name], name).toBeUndefined();
      }
    }
    const kept = readLaunch({ ...base, [RESOURCE_LINK]: { ...link, description: "About it" } }, registration);
    expect(kept.messageType === "LtiResourceLinkRequest" && kept.resourceLink.description).toBe("About it");
  });

  it("reads the number and the boolean of a custom property as their text, and refuses any other value", () => {
    const base = resourceLinkClaims("nonce-1", SECONDS);
    const launch = readLaunch(
      { ...base, [CUSTOM]: { id: 170000004597788, on: true, off: false, name: "x" } },
      registration,
    );
    expect(launch.custom).toStrictEqual(
      new Map([
        ["id", "170000004597788"],
        ["on", "true"],
        ["off", "false"],
        ["name", "x"],
      ]),
    );
    for (const value of [null, [], {}]) {
      expect(() => readLaunch({ ...base, [CUSTOM]: { a: value } }, registration), JSON.stringify(value)).toThrow(
        expect.objectContaining({ reason: "claim-invalid" }),
      );
    }
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
