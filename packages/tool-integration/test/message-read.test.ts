// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims are snake_case or URLs.

import { readFileSync } from "node:fs";
import { isRecord } from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import type { LtiMessage, OtherMessage } from "../src/index.js";
import { readMessage, readToolMessage } from "../src/protocol/internal.js";
import { deepLinkingClaims, ISSUER, resourceLinkClaims } from "./fake-platform.js";
import { fuzzJson } from "./fuzz.js";
import { SECONDS } from "./tool-setup.js";

const CORE = "https://purl.imsglobal.org/spec/lti/claim/";
const DL = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const AP = "https://purl.imsglobal.org/spec/lti-ap/claim/";
const AGS = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";
const CLIENT = "962fa4d8-bcbf-49a0-94b2-2de05ad274af";
const DEPLOYMENT = "07940580-b309-415e-a37c-914d387c1150";
const TARGET = "https://tool.example.com/lti/launch";
const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
const MENTOR = "http://purl.imsglobal.org/vocab/lis/v2/membership#Mentor";

/** The registration that the claims are read against. */
const options = { issuer: ISSUER, clientId: CLIENT, deploymentIds: [DEPLOYMENT] };

/** Returns claims as a token carries them: JSON, so that a member that is `undefined` is not there. */
function json(claims: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(claims));
}

/** The claims every message of a platform has (LTI 1.3 Core sections 5.3.1 to 5.3.7), for the given message type. */
function claimsOf(messageType: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return json({
    iss: ISSUER,
    sub: "user-1",
    aud: CLIENT,
    exp: SECONDS + 300,
    iat: SECONDS,
    nonce: "nonce-1",
    [`${CORE}message_type`]: messageType,
    [`${CORE}version`]: "1.3.0",
    [`${CORE}deployment_id`]: DEPLOYMENT,
    [`${CORE}target_link_uri`]: TARGET,
    [`${CORE}roles`]: [],
    ...extra,
  });
}

const RESOURCE_LINK = { [`${CORE}resource_link`]: { id: "link-1" } };
const GRADES = { [AGS]: { scope: [], lineitem: "https://lms.example.edu/lineitems/1" } };

/** Asserts that a message has the given type, which the compiler cannot see from a parameter. */
function isType<TType extends LtiMessage["messageType"]>(
  message: LtiMessage,
  type: TType,
): asserts message is Exclude<Extract<LtiMessage, { messageType: TType }>, OtherMessage> {
  expect(message.messageType).toBe(type);
}

/**
 * The claims of a launch from Canvas, as a Canvas engineer published them in September 2020 (gist 893d18f8a1bb36cb79d0a24324475fe6):
 * `title` and `description` are `null`, `canvas_user_uuid` is a number, `person_sourcedid` is `null`, `course_offering_sourcedid`
 * is a variable that was not substituted, and the context type `Account` is in no vocabulary. Names, e-mail address and host
 * names are replaced.
 */
const canvas: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./fixtures/canvas-launch.json", import.meta.url), "utf8"),
);
const canvasOptions = {
  issuer: "https://canvas.instructure.com",
  clientId: "170000000000559",
  deploymentIds: [String(canvas[`${CORE}deployment_id`])],
};

describe("readMessage of the claims every message has", () => {
  it("reads the claims of LTI Core Appendix E as the specification names them", () => {
    const message = readMessage(resourceLinkClaims("nonce-1", SECONDS), options);
    isType(message, "LtiResourceLinkRequest");
    expect(message).toMatchObject({
      issuer: ISSUER,
      clientId: CLIENT,
      deploymentId: DEPLOYMENT,
      version: "1.3.0",
      targetLinkUri: "https://tool.example.com/lti/48320/tryout",
      user: {
        subject: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a",
        name: "Ms Jane Marie Doe",
        email: "jane@platform.example.edu",
      },
      context: { id: "c1d887f0-a1a3-4bca-ae25-c375edcc131a", label: "ECON 1010" },
      platform: { guid: "ex/48bbb541-ce55-456e-8b7d-ebc59a38d435", name: "Example Tool Platform" },
      presentation: { documentTarget: "iframe", height: 320, width: 240 },
      resourceLink: { id: "200d101f-2c14-434a-a0f3-57c2a42369fd", title: "Introduction Assignment" },
      custom: { exam: "tryout-1", attempt: "2" },
      services: { grades: { lineitem: "https://lms.example.edu/2344/lineitems/1234/lineitem" } },
    });
  });

  it("keeps every claim of the token, vendor claims among them, in claims", () => {
    const vendor = "http://www.ExamplePlatformVendor.com/session";
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [vendor]: { id: "89023sj890dju080" } }),
      options,
    );
    expect(message.claims[vendor]).toEqual({ id: "89023sj890dju080" });
    expect(message.claims.iss).toBe(ISSUER);
    expect(message.claims[`${CORE}deployment_id`]).toBe(DEPLOYMENT);
  });

  it("reads a user without a subject as an anonymous launch, and the roles claim as it was sent", () => {
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, sub: undefined, [`${CORE}roles`]: ["Instructor", "x:y"] }),
      options,
    );
    expect(message.user.subject).toBeUndefined();
    expect(message.roles).toEqual(["Instructor", "x:y"]);
  });

  it("reads the identity claims of the user", () => {
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", {
        ...RESOURCE_LINK,
        name: "Ms Jane Marie Doe",
        given_name: "Jane",
        family_name: "Doe",
        middle_name: "Marie",
        email: "jane@example.org",
        email_verified: true,
        picture: "https://example.org/jane.jpg",
        locale: "en-US",
      }),
      options,
    );
    expect(message.user).toEqual({
      subject: "user-1",
      name: "Ms Jane Marie Doe",
      givenName: "Jane",
      familyName: "Doe",
      middleName: "Marie",
      email: "jane@example.org",
      emailVerified: true,
      picture: "https://example.org/jane.jpg",
      locale: "en-US",
    });
  });

  it("reads the actual user who impersonates another, with the roles of the actual user", () => {
    const claim = { id: "admin-1", name: "Admin", roles: [MENTOR] };
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [`${CORE}actual_user`]: claim }),
      options,
    );
    expect(message.actualUser).toEqual({ id: "admin-1", name: "Admin", roles: [MENTOR] });
  });

  it("reads the optional claims of Core 5.4: context, organization, platform instance, presentation, LIS and mentor scope", () => {
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", {
        ...RESOURCE_LINK,
        [`${CORE}roles`]: [MENTOR],
        [`${CORE}role_scope_mentor`]: ["a", "b"],
        [`${CORE}context`]: {
          id: "c1",
          label: "CPS 435",
          title: "CPS 435 Learning Analytics",
          type: ["http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering"],
        },
        [`${CORE}organization`]: {
          id: "example.edu:d015f284",
          type: "institution",
          name: "Example University",
          description: "A university",
          url: "https://example.edu",
        },
        [`${CORE}tool_platform`]: {
          guid: "ex/48bbb541",
          contact_email: "support@example.edu",
          description: "An Example Tool Platform",
          name: "Example",
          url: "https://platform.example.edu",
          product_family_code: "ExamplePlatformVendor-Product",
          version: "1.0",
        },
        [`${CORE}launch_presentation`]: {
          document_target: "window",
          height: 320,
          width: 240,
          return_url: "https://platform.example.edu/back",
          locale: "en-US",
        },
        [`${CORE}lis`]: { person_sourcedid: "p1", course_offering_sourcedid: "o1", course_section_sourcedid: "s1" },
      }),
      options,
    );
    expect(message).toMatchObject({
      roleScopeMentor: ["a", "b"],
      context: {
        id: "c1",
        label: "CPS 435",
        title: "CPS 435 Learning Analytics",
        type: ["http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering"],
      },
      organization: {
        id: "example.edu:d015f284",
        type: "institution",
        name: "Example University",
        description: "A university",
        url: "https://example.edu",
      },
      platform: {
        guid: "ex/48bbb541",
        contactEmail: "support@example.edu",
        description: "An Example Tool Platform",
        name: "Example",
        url: "https://platform.example.edu",
        productFamilyCode: "ExamplePlatformVendor-Product",
        version: "1.0",
      },
      presentation: {
        documentTarget: "window",
        height: 320,
        width: 240,
        returnUrl: "https://platform.example.edu/back",
        locale: "en-US",
      },
      lis: { person_sourcedid: "p1", course_offering_sourcedid: "o1", course_section_sourcedid: "s1" },
    });
  });

  it("reads the launch of Canvas as it sends it: null strings, a number in the custom properties, a context type of no vocabulary", () => {
    const message = readMessage(canvas, canvasOptions);
    isType(message, "LtiResourceLinkRequest");
    expect(message.resourceLink).toStrictEqual({
      id: "7f956bcc8f67cd076ae464862ce83596a1bb3293",
      title: undefined,
      description: undefined,
    });
    expect(message.custom).toStrictEqual({
      canvas_user_uuid: "170000004597788",
      canvas_api_domain: "school.instructure.com",
      canvas_account_uuid: "LC6nuzxUST0u7aNHCm0yCjEww5wAtjO5GiSlrHMu",
    });
    expect(message.lis).toEqual({ course_offering_sourcedid: "$CourseSection.sourcedId" });
    expect(message.context).toMatchObject({ id: "7f956bcc8f67cd076ae464862ce83596a1bb3293", type: ["Account"] });
    expect(message.user).toMatchObject({ locale: "en", email: "user@school.example" });
  });

  it("reads a null string of any claim as absent, and keeps a string", () => {
    const link = { ...RESOURCE_LINK[`${CORE}resource_link`], title: null, description: "About it" };
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", {
        [`${CORE}resource_link`]: link,
        name: null,
        [`${CORE}context`]: { id: "c", label: null },
      }),
      options,
    );
    isType(message, "LtiResourceLinkRequest");
    expect(message.resourceLink).toEqual({ id: "link-1", description: "About it" });
    expect(message.user.name).toBeUndefined();
    expect(message.context?.label).toBeUndefined();
  });

  it("reads the number and the boolean of a custom property as their text, and refuses any other value", () => {
    const custom = { id: 170000004597788, on: true, off: false, name: "x" };
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [`${CORE}custom`]: custom }),
      options,
    );
    expect(message.custom).toStrictEqual({ id: "170000004597788", on: "true", off: "false", name: "x" });
    for (const value of [null, [], {}]) {
      const claims = claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [`${CORE}custom`]: { a: value } });
      expect(() => readMessage(claims, options), JSON.stringify(value)).toThrow(
        expect.objectContaining({ reason: "claim-invalid" }),
      );
    }
  });

  it("reads a number of the custom properties only when its text is its value", () => {
    const custom = (json: string) =>
      readMessage(
        claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [`${CORE}custom`]: JSON.parse(json) }),
        options,
      ).custom;
    expect(custom('{"a":9007199254740991,"b":-9007199254740991,"c":1.5,"d":0,"e":-3}')).toStrictEqual({
      a: "9007199254740991",
      b: "-9007199254740991",
      c: "1.5",
      d: "0",
      e: "-3",
    });
    // JSON parsing has already changed these: 2^53 + 1 reads as 2^53, and 1e400 as Infinity.
    for (const json of ["9007199254740993", "9007199254740992", "-9007199254740993", "1e400", "-1e400", "1e300"]) {
      expect(() => custom(`{"a":${json}}`), json).toThrow(expect.objectContaining({ reason: "claim-invalid" }));
    }
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses %s as the name of a custom property, of a member of the LIS claim and of a claim",
    (name) => {
      const refused = expect.objectContaining({
        reason: "claim-invalid",
        message: expect.stringContaining(`the property "${name}" is refused`),
      });
      for (const claim of [`${CORE}custom`, `${CORE}lis`, `${CORE}context`]) {
        const claims = claimsOf("LtiResourceLinkRequest", {
          ...RESOURCE_LINK,
          [claim]: JSON.parse(`{"id":"c1","a":"1","${name}":"x"}`),
        });
        expect(() => readMessage(claims, options), claim).toThrow(refused);
      }
    },
  );

  it("refuses a message type that it does not model, and reads one the host names as the type the host named", () => {
    const claims = claimsOf("LtiAssetProcessorSettingsRequest", RESOURCE_LINK);
    expect(() => readMessage(claims, options)).toThrow(expect.objectContaining({ reason: "message-type-unsupported" }));
    const other = readMessage(claims, { ...options, otherMessageTypes: ["LtiAssetProcessorSettingsRequest"] });
    expect(other.messageType).toBe("LtiAssetProcessorSettingsRequest");
    expect(other.claims[`${CORE}resource_link`]).toEqual({ id: "link-1" });
    for (const type of ["LtiDeepLinkingResponse", "LtiStartAssessment"]) {
      expect(() => readMessage(claimsOf(type), options), type).toThrow(
        expect.objectContaining({ reason: "message-type-unsupported" }),
      );
    }
  });

  it("accepts the versions the host names, and refuses any other", () => {
    const claims = claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [`${CORE}version`]: "1.3.1" });
    expect(() => readMessage(claims, options)).toThrow(expect.objectContaining({ reason: "version-unsupported" }));
    expect(readMessage(claims, { ...options, versions: ["1.3.0", "1.3.1"] }).version).toBe("1.3.1");
  });

  it("refuses a deployment that the registration does not list, and claims that are missing or of the wrong shape", () => {
    const refusals: readonly (readonly [string, Record<string, unknown>, string])[] = [
      ["a deployment of no registration", { [`${CORE}deployment_id`]: "other" }, "deployment-unknown"],
      ["a deployment longer than 255 characters", { [`${CORE}deployment_id`]: "d".repeat(256) }, "claim-invalid"],
      ["no deployment", { [`${CORE}deployment_id`]: undefined }, "claim-missing"],
      ["no target link URI", { [`${CORE}target_link_uri`]: undefined }, "claim-missing"],
      [
        "a target link URI that is not https",
        { [`${CORE}target_link_uri`]: "http://tool.example.com/" },
        "claim-invalid",
      ],
      ["no roles", { [`${CORE}roles`]: undefined }, "claim-missing"],
      ["roles that are not strings", { [`${CORE}roles`]: [1] }, "claim-invalid"],
      ["no message type", { [`${CORE}message_type`]: undefined }, "claim-missing"],
      ["a subject longer than 255 characters", { sub: "s".repeat(256) }, "claim-invalid"],
      ["an email that is a number", { email: 5 }, "claim-invalid"],
      ["a context without an id", { [`${CORE}context`]: { label: "x" } }, "claim-missing"],
      ["a platform instance without a guid", { [`${CORE}tool_platform`]: { name: "x" } }, "claim-missing"],
      ["a document target of no kind", { [`${CORE}launch_presentation`]: { document_target: "tab" } }, "claim-invalid"],
      [
        "a return URL that is not https",
        { [`${CORE}launch_presentation`]: { return_url: "http://x.example/" } },
        "claim-invalid",
      ],
      ["an actual user without an id", { [`${CORE}actual_user`]: { name: "x" } }, "claim-missing"],
      ["an organization without an id", { [`${CORE}organization`]: { name: "x" } }, "claim-missing"],
      ["a migration claim without a consumer key", { [`${CORE}lti1p1`]: { user_id: "u" } }, "claim-missing"],
      ["an LIS claim that holds a number", { [`${CORE}lis`]: { a: 1 } }, "claim-invalid"],
    ];
    for (const [name, change, reason] of refusals) {
      const claims = claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, ...change });
      expect(() => readMessage(claims, options), name).toThrow(expect.objectContaining({ reason }));
    }
  });

  it("reads the service claims of the grade, roster, groups and preferences services", () => {
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", {
        ...RESOURCE_LINK,
        [AGS]: { scope: ["s1"], lineitems: "https://lms.example.edu/items", lineitem: null },
        "https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice": {
          context_memberships_url: "https://lms.example.edu/members",
          service_versions: ["2.0"],
        },
        "https://purl.imsglobal.org/spec/lti-gs/claim/groupsservice": {
          scope: ["g"],
          context_groups_url: "https://lms.example.edu/groups",
          context_group_sets_url: "https://lms.example.edu/groups/sets",
          service_versions: ["1.0"],
        },
        "https://purl.imsglobal.org/spec/lti-afapnp/claim/afapnp-endpoint-service": {
          afapnp_endpoint_hosturl: "https://lms.example.edu/pnp",
          afapnp_activity_ids: ["a1"],
          scopes: ["p"],
        },
      }),
      options,
    );
    expect(message.services).toEqual({
      grades: { scopes: ["s1"], lineitems: "https://lms.example.edu/items" },
      roster: { contextMembershipsUrl: "https://lms.example.edu/members", serviceVersions: ["2.0"] },
      groups: {
        contextGroupsUrl: "https://lms.example.edu/groups",
        contextGroupSetsUrl: "https://lms.example.edu/groups/sets",
        scopes: ["g"],
        serviceVersions: ["1.0"],
      },
      preferences: { hostUrl: "https://lms.example.edu/pnp", activityIds: ["a1"], scopes: ["p"] },
    });
  });

  it("refuses a service address that is not an https address, in each of the four service claims", () => {
    const http = "http://lms.example.edu/service";
    const claims: readonly (readonly [string, Record<string, unknown>])[] = [
      [AGS, { scope: [], lineitems: http }],
      [AGS, { scope: [], lineitem: http }],
      ["https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice", { context_memberships_url: http }],
      [
        "https://purl.imsglobal.org/spec/lti-gs/claim/groupsservice",
        {
          scope: [],
          service_versions: [],
          context_groups_url: "https://lms.example.edu/g",
          context_group_sets_url: http,
        },
      ],
      [
        "https://purl.imsglobal.org/spec/lti-afapnp/claim/afapnp-endpoint-service",
        { afapnp_endpoint_hosturl: http, afapnp_activity_ids: ["a"], scopes: ["s"] },
      ],
    ];
    for (const [name, value] of claims) {
      const message = claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [name]: value });
      expect(() => readMessage(message, options), name).toThrow(expect.objectContaining({ reason: "claim-invalid" }));
    }
  });

  it("reads a blank or null line item of the grade services as absent", () => {
    for (const lineitem of [null, ""]) {
      const claims = claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [AGS]: { scope: [], lineitem } });
      expect(readMessage(claims, options).services.grades?.lineitem).toBeUndefined();
    }
  });

  it("reads the lti1p1 claim and leaves it unverified", () => {
    const migration = { user_id: "34212", oauth_consumer_key: "179248902", oauth_consumer_key_sign: "lWd54k=" };
    const message = readMessage(
      claimsOf("LtiResourceLinkRequest", { ...RESOURCE_LINK, [`${CORE}lti1p1`]: migration }),
      options,
    );
    expect(message.migration).toEqual({
      userId: "34212",
      oauthConsumerKey: "179248902",
      oauthConsumerKeySign: "lWd54k=",
      verified: false,
    });
  });
});

describe("readMessage of the other platform messages", () => {
  it("reads the settings of a Deep Linking request as Deep Linking Appendix A gives them", () => {
    const message = readMessage(deepLinkingClaims("nonce-1", SECONDS), options);
    isType(message, "LtiDeepLinkingRequest");
    expect(message.settings).toMatchObject({
      returnUrl: "https://lms.example.edu/deep_links",
      acceptTypes: ["link", "file", "html", "ltiResourceLink", "image"],
      acceptPresentationDocumentTargets: ["iframe", "window", "embed"],
      acceptMultiple: true,
      autoCreate: true,
      data: "deep-link-data-1",
    });
  });

  it("reads all ten settings of a Deep Linking request, and the media types as a list from a text or an array", () => {
    const settings = {
      deep_link_return_url: "https://lms.example.edu/back",
      accept_types: ["file"],
      accept_presentation_document_targets: ["window"],
      accept_multiple: false,
      accept_lineitem: true,
      auto_create: false,
      title: "Default title",
      text: "Default text",
      data: "d",
    };
    const read = (mediaTypes: unknown) => {
      const message = readMessage(
        claimsOf("LtiDeepLinkingRequest", {
          [`${DL}deep_linking_settings`]: { ...settings, accept_media_types: mediaTypes },
        }),
        options,
      );
      isType(message, "LtiDeepLinkingRequest");
      return message.settings;
    };
    expect(read("image/*, text/html")).toEqual({
      returnUrl: "https://lms.example.edu/back",
      acceptTypes: ["file"],
      acceptPresentationDocumentTargets: ["window"],
      acceptMediaTypes: ["image/*", "text/html"],
      acceptMultiple: false,
      acceptLineItem: true,
      autoCreate: false,
      title: "Default title",
      text: "Default text",
      data: "d",
    });
    expect(read(["image/*"]).acceptMediaTypes).toEqual(["image/*"]);
    expect(read(undefined).acceptMediaTypes).toBeUndefined();
  });

  it("refuses a Deep Linking request without its settings or with a settings claim missing a required property", () => {
    expect(() => readMessage(claimsOf("LtiDeepLinkingRequest"), options)).toThrow(
      expect.objectContaining({ reason: "claim-missing" }),
    );
    const missing = { accept_types: ["link"], accept_presentation_document_targets: ["iframe"] };
    expect(() =>
      readMessage(claimsOf("LtiDeepLinkingRequest", { [`${DL}deep_linking_settings`]: missing }), options),
    ).toThrow(expect.objectContaining({ reason: "claim-missing" }));
  });

  it("refuses a Deep Linking request whose return URL is not an https address", () => {
    const settings = {
      deep_link_return_url: "http://lms.example.edu/back",
      accept_types: [],
      accept_presentation_document_targets: [],
    };
    expect(() =>
      readMessage(claimsOf("LtiDeepLinkingRequest", { [`${DL}deep_linking_settings`]: settings }), options),
    ).toThrow(expect.objectContaining({ reason: "claim-invalid" }));
  });

  it("reads a submission review request: the line item, the user whose work is shown, and a resource link that may be absent", () => {
    const forUser = {
      user_id: "1239a-ilt",
      person_sourcedid: "example.edu:71ee7e42",
      given_name: "Jude",
      family_name: "Wilbert",
      name: "Jude Wilbert",
      email: "jwilbert@example.org",
      roles: [LEARNER],
    };
    const claims = claimsOf("LtiSubmissionReviewRequest", { ...GRADES, [`${CORE}for_user`]: forUser });
    const message = readMessage(claims, options);
    isType(message, "LtiSubmissionReviewRequest");
    expect(message.forUser).toEqual({
      userId: "1239a-ilt",
      personSourcedId: "example.edu:71ee7e42",
      givenName: "Jude",
      familyName: "Wilbert",
      name: "Jude Wilbert",
      email: "jwilbert@example.org",
      roles: [LEARNER],
    });
    expect(message.resourceLink).toBeUndefined();
    const coupled = readMessage({ ...claims, ...RESOURCE_LINK }, options);
    isType(coupled, "LtiSubmissionReviewRequest");
    expect(coupled.resourceLink).toEqual({ id: "link-1" });
  });

  it("refuses a submission review request without its line item or its for_user claim", () => {
    const forUser = { [`${CORE}for_user`]: { user_id: "u" } };
    for (const claims of [
      claimsOf("LtiSubmissionReviewRequest", forUser),
      claimsOf("LtiSubmissionReviewRequest", GRADES),
    ]) {
      expect(() => readMessage(claims, options)).toThrow(expect.objectContaining({ reason: "claim-missing" }));
    }
  });

  it("reads a Start Proctoring message with its attempt, the address to start the assessment, the session data and the control service", () => {
    const message = readMessage(
      claimsOf("LtiStartProctoring", {
        ...RESOURCE_LINK,
        [`${AP}attempt_number`]: 1,
        [`${AP}start_assessment_url`]: "https://assessment.example/examgo",
        [`${AP}session_data`]: "session-data-1",
        [`${AP}acs`]: {
          actions: ["terminate", "flag", "update"],
          assessment_control_url: "https://assessment.example/acs",
        },
        [`${AP}proctoring_settings`]: { data: "video=on" },
      }),
      options,
    );
    isType(message, "LtiStartProctoring");
    expect(message).toMatchObject({
      resourceLink: { id: "link-1" },
      attemptNumber: 1,
      startAssessmentUrl: "https://assessment.example/examgo",
      sessionData: "session-data-1",
      assessmentControl: { url: "https://assessment.example/acs", actions: ["terminate", "flag", "update"] },
      proctoringSettings: { data: "video=on" },
    });
  });

  it("refuses a Start Proctoring message that lacks a required claim or has an attempt that is not a whole number", () => {
    const full = {
      ...RESOURCE_LINK,
      [`${AP}attempt_number`]: 1,
      [`${AP}start_assessment_url`]: "https://assessment.example/examgo",
      [`${AP}session_data`]: "s",
    };
    expect(readMessage(claimsOf("LtiStartProctoring", full), options).messageType).toBe("LtiStartProctoring");
    for (const name of [
      `${CORE}resource_link`,
      `${AP}attempt_number`,
      `${AP}start_assessment_url`,
      `${AP}session_data`,
    ]) {
      const claims = claimsOf("LtiStartProctoring", { ...full, [name]: undefined });
      expect(() => readMessage(claims, options), name).toThrow(expect.objectContaining({ reason: "claim-missing" }));
    }
    for (const attempt of ["1", 1.5, -1]) {
      const claims = claimsOf("LtiStartProctoring", { ...full, [`${AP}attempt_number`]: attempt });
      expect(() => readMessage(claims, options), String(attempt)).toThrow(
        expect.objectContaining({ reason: "claim-invalid" }),
      );
    }
  });

  it("reads an End Assessment message with its attempt, its settings and the error it closed on", () => {
    const message = readMessage(
      claimsOf("LtiEndAssessment", {
        ...RESOURCE_LINK,
        [`${AP}attempt_number`]: 2,
        [`${AP}proctoring_settings`]: { data: "x" },
        [`${AP}errormsg`]: "The exam closed.",
        [`${AP}errorlog`]: "closed: 500",
      }),
      options,
    );
    isType(message, "LtiEndAssessment");
    expect(message).toMatchObject({
      attemptNumber: 2,
      resourceLink: { id: "link-1" },
      proctoringSettings: { data: "x" },
      errorMessage: "The exam closed.",
      errorLog: "closed: 500",
    });
    expect(() => readMessage(claimsOf("LtiEndAssessment"), options)).toThrow(
      expect.objectContaining({ reason: "claim-missing" }),
    );
  });
});

describe("readToolMessage", () => {
  const toolOptions = options;
  const tool = (messageType: string, extra: Record<string, unknown> = {}) => ({
    iss: CLIENT,
    aud: ISSUER,
    exp: SECONDS + 300,
    iat: SECONDS,
    nonce: "n",
    [`${CORE}message_type`]: messageType,
    [`${CORE}version`]: "1.3.0",
    [`${CORE}deployment_id`]: DEPLOYMENT,
    ...extra,
  });

  it("reads a Deep Linking response: the data it returns, its items, the messages and the error", () => {
    const items = [
      { type: "ltiResourceLink", url: "https://tool.example.com/x" },
      { type: "https://x.example/custom", data: 1 },
    ];
    const message = readToolMessage(
      tool("LtiDeepLinkingResponse", {
        [`${DL}data`]: "csrf",
        [`${DL}content_items`]: items,
        [`${DL}msg`]: "Added",
        [`${DL}log`]: "added 2",
        [`${DL}errormsg`]: "No",
        [`${DL}errorlog`]: "failed",
      }),
      toolOptions,
    );
    expect(message).toMatchObject({
      messageType: "LtiDeepLinkingResponse",
      issuer: ISSUER,
      clientId: CLIENT,
      deploymentId: DEPLOYMENT,
      data: "csrf",
      items,
      message: "Added",
      log: "added 2",
      errorMessage: "No",
      errorLog: "failed",
    });
  });

  it("reads a Deep Linking response with no items as one that places none, and refuses an item without a type", () => {
    const empty = readToolMessage(tool("LtiDeepLinkingResponse"), toolOptions);
    expect(empty).toMatchObject({ messageType: "LtiDeepLinkingResponse", items: [] });
    const claims = tool("LtiDeepLinkingResponse", { [`${DL}content_items`]: [{ url: "https://x.example/" }] });
    expect(() => readToolMessage(claims, toolOptions)).toThrow(expect.objectContaining({ reason: "claim-invalid" }));
  });

  it("reads a Start Assessment message with the session data, the resource link, the attempt and what was verified", () => {
    const message = readToolMessage(
      tool("LtiStartAssessment", {
        [`${AP}session_data`]: "s",
        [`${CORE}resource_link`]: { id: "398" },
        [`${AP}attempt_number`]: 1,
        [`${AP}end_assessment_return`]: true,
        [`${AP}verified_user`]: { given_name: "Jane", family_name: "Doe", picture: "https://proctor.example/jane.jpg" },
      }),
      toolOptions,
    );
    expect(message).toMatchObject({
      messageType: "LtiStartAssessment",
      sessionData: "s",
      resourceLink: { id: "398" },
      attemptNumber: 1,
      endAssessmentReturn: true,
      verifiedUser: { givenName: "Jane", familyName: "Doe", picture: "https://proctor.example/jane.jpg" },
    });
    const plain = readToolMessage(
      tool("LtiStartAssessment", {
        [`${AP}session_data`]: "s",
        [`${CORE}resource_link`]: { id: "398" },
        [`${AP}attempt_number`]: 1,
      }),
      toolOptions,
    );
    expect(plain).toMatchObject({ endAssessmentReturn: false, verifiedUser: undefined });
  });

  it("refuses a message type that a tool does not send, a version and a deployment that the registration does not accept", () => {
    expect(() => readToolMessage(tool("LtiResourceLinkRequest"), toolOptions)).toThrow(
      expect.objectContaining({ reason: "message-type-unsupported" }),
    );
    expect(() => readToolMessage(tool("LtiDeepLinkingResponse", { [`${CORE}version`]: "2" }), toolOptions)).toThrow(
      expect.objectContaining({ reason: "version-unsupported" }),
    );
    expect(() =>
      readToolMessage(tool("LtiDeepLinkingResponse", { [`${CORE}deployment_id`]: "x" }), toolOptions),
    ).toThrow(expect.objectContaining({ reason: "deployment-unknown" }));
    expect(
      readToolMessage(tool("LtiDeepLinkingResponse", { [`${CORE}version`]: "1.3.1" }), {
        ...toolOptions,
        versions: ["1.3.1"],
      }).version,
    ).toBe("1.3.1");
    expect(() => readToolMessage(tool("LtiStartAssessment"), toolOptions)).toThrow(
      expect.objectContaining({ reason: "claim-missing" }),
    );
  });
});

describe("the readers of messages", () => {
  const examples: readonly Record<string, unknown>[] = [
    resourceLinkClaims("nonce-1", SECONDS),
    deepLinkingClaims("nonce-1", SECONDS),
    claimsOf("LtiStartProctoring", {
      ...RESOURCE_LINK,
      [`${AP}attempt_number`]: 1,
      [`${AP}start_assessment_url`]: "https://assessment.example/examgo",
      [`${AP}session_data`]: "s",
    }),
  ];

  it("return a message or throw a DataError or an LtiError for any claims, and for the examples with any value replaced", () => {
    fuzzJson((json) => (isRecord(json) ? readMessage(json, options) : undefined), examples);
  });

  it("return a message or throw a DataError or an LtiError for the claims of a tool, with any value replaced", () => {
    const tool = {
      iss: CLIENT,
      aud: ISSUER,
      [`${CORE}message_type`]: "LtiDeepLinkingResponse",
      [`${CORE}version`]: "1.3.0",
      [`${CORE}deployment_id`]: DEPLOYMENT,
      [`${DL}content_items`]: [{ type: "link", url: "https://x.example/" }],
    };
    fuzzJson((json) => (isRecord(json) ? readToolMessage(json, options) : undefined), [tool]);
  });
});
