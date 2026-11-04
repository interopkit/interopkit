// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims are snake_case or URLs.

import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_ROLES,
  CONTEXT_SUB_ROLES,
  CONTEXT_TYPES,
  INSTITUTION_ROLES,
  type LtiMessage,
  SYSTEM_ROLES,
  type ToolMessage,
} from "../src/index.js";
import {
  type MessageToWrite,
  readMessage,
  readToolMessage,
  type ToolMessageToWrite,
  writeMessage,
  writeToolMessage,
} from "../src/protocol/internal.js";
import { FUZZ } from "./fuzz.js";
import { memberName } from "./services.js";

const CORE = "https://purl.imsglobal.org/spec/lti/claim/";
const ISSUER = "https://lms.example.edu";
const CLIENT = "client-1";
const options = { issuer: ISSUER, clientId: CLIENT, deploymentIds: ["dep-1"] };
const MENTOR = "http://purl.imsglobal.org/vocab/lis/v2/membership#Mentor";
const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
const LINK = { id: "link-1" };
const TARGET = "https://tool.example.com/launch";

/** What every message of the writer needs. */
const base = {
  issuer: ISSUER,
  clientId: CLIENT,
  deploymentId: "dep-1",
  version: "1.3.0",
  targetLinkUri: TARGET,
  user: { subject: "user-1" },
  roles: [LEARNER],
} as const;

/** A resource link message with the given changes. */
function link(change: Record<string, unknown> = {}): MessageToWrite {
  return { ...base, messageType: "LtiResourceLinkRequest", resourceLink: LINK, ...change } as MessageToWrite;
}

/** Reads what a writer wrote as a tool reads a token: with the claims of a token round-tripped through JSON. */
function readBack(claims: Record<string, unknown>): LtiMessage {
  return readMessage(JSON.parse(JSON.stringify({ iss: ISSUER, aud: CLIENT, ...claims })), options);
}

describe("writeMessage", () => {
  it("writes the claims of a resource link launch under the names the specification gives them", () => {
    const claims = writeMessage(
      link({
        user: {
          subject: "u1",
          name: "Jane",
          givenName: "J",
          familyName: "D",
          middleName: "M",
          email: "j@example.org",
          emailVerified: true,
          picture: "https://example.org/j.jpg",
          locale: "en-US",
        },
        context: { id: "c1", label: "L", title: "T", type: [CONTEXT_TYPES[1] ?? ""] },
        platform: { guid: "g", contactEmail: "a@b.c", productFamilyCode: "p", version: "1" },
        presentation: {
          documentTarget: "iframe",
          height: 1,
          width: 2,
          returnUrl: "https://lms.example.edu/back",
          locale: "en",
        },
        lis: { person_sourcedid: "p1" },
        custom: { exam: "1" },
        extensions: { "http://www.ExamplePlatformVendor.com/session": { id: "x" } },
      }),
    );
    expect(claims).toEqual({
      sub: "u1",
      name: "Jane",
      given_name: "J",
      family_name: "D",
      middle_name: "M",
      email: "j@example.org",
      email_verified: true,
      picture: "https://example.org/j.jpg",
      locale: "en-US",
      [`${CORE}message_type`]: "LtiResourceLinkRequest",
      [`${CORE}version`]: "1.3.0",
      [`${CORE}deployment_id`]: "dep-1",
      [`${CORE}target_link_uri`]: TARGET,
      [`${CORE}roles`]: [LEARNER],
      [`${CORE}resource_link`]: LINK,
      [`${CORE}context`]: { id: "c1", label: "L", title: "T", type: [CONTEXT_TYPES[1]] },
      [`${CORE}tool_platform`]: { guid: "g", contact_email: "a@b.c", product_family_code: "p", version: "1" },
      [`${CORE}launch_presentation`]: {
        document_target: "iframe",
        height: 1,
        width: 2,
        return_url: "https://lms.example.edu/back",
        locale: "en",
      },
      [`${CORE}lis`]: { person_sourcedid: "p1" },
      [`${CORE}custom`]: { exam: "1" },
      "http://www.ExamplePlatformVendor.com/session": { id: "x" },
    });
  });

  it("writes no claim for what the message does not have, and no sub for an anonymous launch", () => {
    const claims = writeMessage(link({ user: {}, roles: [] }));
    expect(Object.keys(claims).sort()).toEqual(
      [
        `${CORE}message_type`,
        `${CORE}version`,
        `${CORE}deployment_id`,
        `${CORE}target_link_uri`,
        `${CORE}roles`,
        `${CORE}resource_link`,
      ].sort(),
    );
    expect(claims[`${CORE}roles`]).toEqual([]);
  });

  it("keeps a custom name such as __proto__ as data", () => {
    const claims = writeMessage(link({ custom: JSON.parse('{"__proto__":"x"}') }));
    const custom = claims[`${CORE}custom`];
    expect(Object.keys(custom as object)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(custom)).toBe(Object.prototype);
  });

  it("writes the actual user, the organization, the mentor scope, the services and the migration claim", () => {
    const claims = writeMessage(
      link({
        roles: [LEARNER, MENTOR],
        roleScopeMentor: ["m1"],
        actualUser: { id: "admin", name: "Admin", roles: [MENTOR] },
        organization: { id: "o1", type: "institution", name: "N", description: "D", url: "https://example.edu" },
        services: {
          grades: { scopes: ["s"], lineitems: "https://lms.example.edu/li", lineitem: "https://lms.example.edu/li/1" },
          roster: { contextMembershipsUrl: "https://lms.example.edu/m", serviceVersions: ["2.0"] },
          groups: {
            contextGroupsUrl: "https://lms.example.edu/g",
            contextGroupSetsUrl: "https://lms.example.edu/gs",
            scopes: ["g"],
            serviceVersions: ["1.0"],
          },
          preferences: { hostUrl: "https://lms.example.edu/pnp", activityIds: ["a"], scopes: ["p"] },
        },
        migration: {
          userId: "u",
          contextId: "c",
          toolConsumerInstanceGuid: "g",
          resourceLinkId: "r",
          oauthConsumerKey: "k",
          oauthConsumerKeySign: "s",
        },
      }),
    );
    expect(claims).toMatchObject({
      [`${CORE}role_scope_mentor`]: ["m1"],
      [`${CORE}actual_user`]: { id: "admin", name: "Admin", roles: [MENTOR] },
      [`${CORE}organization`]: {
        id: "o1",
        type: "institution",
        name: "N",
        description: "D",
        url: "https://example.edu",
      },
      "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
        scope: ["s"],
        lineitems: "https://lms.example.edu/li",
        lineitem: "https://lms.example.edu/li/1",
      },
      "https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice": {
        context_memberships_url: "https://lms.example.edu/m",
        service_versions: ["2.0"],
      },
      "https://purl.imsglobal.org/spec/lti-gs/claim/groupsservice": {
        context_groups_url: "https://lms.example.edu/g",
        context_group_sets_url: "https://lms.example.edu/gs",
        scope: ["g"],
        service_versions: ["1.0"],
      },
      "https://purl.imsglobal.org/spec/lti-afapnp/claim/afapnp-endpoint-service": {
        afapnp_endpoint_hosturl: "https://lms.example.edu/pnp",
        afapnp_activity_ids: ["a"],
        scopes: ["p"],
      },
      [`${CORE}lti1p1`]: {
        user_id: "u",
        context_id: "c",
        tool_consumer_instance_guid: "g",
        resource_link_id: "r",
        oauth_consumer_key: "k",
        oauth_consumer_key_sign: "s",
      },
    });
  });

  it("holds the sender to the rules a receiver does not enforce", () => {
    const refusals: readonly (readonly [string, Record<string, unknown>])[] = [
      ["a version other than 1.3.0", { version: "1.3.1" }],
      ["a deployment of 256 characters", { deploymentId: "d".repeat(256) }],
      ["an empty subject", { user: { subject: "" } }],
      ["a context of 256 characters", { context: { id: "c".repeat(256) } }],
      ["an organization of 256 characters", { organization: { id: "c".repeat(256) } }],
      ["a platform instance of 256 characters", { platform: { guid: "c".repeat(256) } }],
      ["an actual user of 256 characters", { actualUser: { id: "c".repeat(256) } }],
      ["a target link URI that is not https", { targetLinkUri: "http://tool.example.com/" }],
      ["roles of no vocabulary", { roles: ["Account"] }],
      ["actual user roles of no vocabulary", { actualUser: { id: "a", roles: ["Account"] } }],
      ["a mentor scope without the Mentor role", { roleScopeMentor: ["x"] }],
      ["context types of no vocabulary", { context: { id: "c", type: ["Account"] } }],
      ["an extension claim that is not a URL", { extensions: { vendor: 1 } }],
      ["an extension claim that is a URN", { extensions: { "urn:example:x": 1 } }],
    ];
    for (const [name, change] of refusals) expect(() => writeMessage(link(change)), name).toThrow(DataError);
  });

  it("accepts the roles of every vocabulary and the deprecated simple names of context roles and context types", () => {
    const roles = [SYSTEM_ROLES, INSTITUTION_ROLES, CONTEXT_ROLES, CONTEXT_SUB_ROLES].flatMap((list) =>
      list.slice(0, 1),
    );
    expect(() => writeMessage(link({ roles }))).not.toThrow();
    expect(() =>
      writeMessage(link({ roles: ["Instructor"], context: { id: "c", type: ["CourseOffering"] } })),
    ).not.toThrow();
    expect(() =>
      writeMessage(link({ roles: ["http://purl.imsglobal.org/vocab/lti/system/person#TestUser"] })),
    ).not.toThrow();
    expect(() => writeMessage(link({ roles: ["Mentor"], roleScopeMentor: ["x"] }))).not.toThrow();
  });

  it("writes a Deep Linking request with its ten settings", () => {
    const claims = writeMessage({
      ...base,
      messageType: "LtiDeepLinkingRequest",
      settings: {
        returnUrl: "https://lms.example.edu/back",
        acceptTypes: ["link"],
        acceptPresentationDocumentTargets: ["iframe"],
        acceptMediaTypes: ["image/*", "text/html"],
        acceptMultiple: true,
        acceptLineItem: false,
        autoCreate: true,
        title: "t",
        text: "x",
        data: "d",
      },
    });
    expect(claims["https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings"]).toEqual({
      deep_link_return_url: "https://lms.example.edu/back",
      accept_types: ["link"],
      accept_presentation_document_targets: ["iframe"],
      accept_media_types: "image/*,text/html",
      accept_multiple: true,
      accept_lineitem: false,
      auto_create: true,
      title: "t",
      text: "x",
      data: "d",
    });
    const plain = { returnUrl: "http://lms.example.edu/back", acceptTypes: [], acceptPresentationDocumentTargets: [] };
    expect(() => writeMessage({ ...base, messageType: "LtiDeepLinkingRequest", settings: plain })).toThrow(DataError);
  });

  it("writes a submission review request only with its line item, and a Start Proctoring message only with an https start address", () => {
    const review = {
      ...base,
      messageType: "LtiSubmissionReviewRequest",
      forUser: { userId: "u", roles: [LEARNER] },
    } as const;
    expect(() => writeMessage(review)).toThrow(DataError);
    const grades = { grades: { scopes: [], lineitem: "https://lms.example.edu/li/1" } };
    const claims = writeMessage({ ...review, services: grades, resourceLink: LINK });
    expect(claims[`${CORE}for_user`]).toEqual({ user_id: "u", roles: [LEARNER] });
    const start = {
      ...base,
      messageType: "LtiStartProctoring",
      resourceLink: LINK,
      attemptNumber: 1,
      sessionData: "s",
    } as const;
    expect(() => writeMessage({ ...start, startAssessmentUrl: "http://a.example/go" })).toThrow(DataError);
    const written = writeMessage({
      ...start,
      startAssessmentUrl: "https://a.example/go",
      assessmentControl: { url: "https://a.example/acs", actions: ["flag"] },
      proctoringSettings: { data: "video=on" },
    });
    expect(written).toMatchObject({
      "https://purl.imsglobal.org/spec/lti-ap/claim/acs": {
        assessment_control_url: "https://a.example/acs",
        actions: ["flag"],
      },
      "https://purl.imsglobal.org/spec/lti-ap/claim/proctoring_settings": { data: "video=on" },
    });
  });

  it("writes an End Assessment message and a message of a type the host named", () => {
    const end = writeMessage({
      ...base,
      messageType: "LtiEndAssessment",
      attemptNumber: 2,
      errorMessage: "closed",
      errorLog: "log",
    });
    expect(end).toMatchObject({
      "https://purl.imsglobal.org/spec/lti-ap/claim/attempt_number": 2,
      "https://purl.imsglobal.org/spec/lti-ap/claim/errormsg": "closed",
      "https://purl.imsglobal.org/spec/lti-ap/claim/errorlog": "log",
    });
    const other = writeMessage({ ...base, messageType: "LtiAssetProcessorSettingsRequest" });
    expect(other[`${CORE}message_type`]).toBe("LtiAssetProcessorSettingsRequest");
  });
});

describe("writeToolMessage", () => {
  it("writes a Deep Linking response and a Start Assessment message", () => {
    const response = writeToolMessage({
      issuer: ISSUER,
      clientId: CLIENT,
      deploymentId: "dep-1",
      version: "1.3.0",
      messageType: "LtiDeepLinkingResponse",
      data: "d",
      items: [{ type: "link", url: "https://x.example/" }],
      message: "m",
      log: "l",
      errorMessage: "e",
      errorLog: "g",
      extensions: { "http://vendor.example/x": 1 },
    });
    expect(response).toEqual({
      [`${CORE}message_type`]: "LtiDeepLinkingResponse",
      [`${CORE}version`]: "1.3.0",
      [`${CORE}deployment_id`]: "dep-1",
      "https://purl.imsglobal.org/spec/lti-dl/claim/data": "d",
      "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": [{ type: "link", url: "https://x.example/" }],
      "https://purl.imsglobal.org/spec/lti-dl/claim/msg": "m",
      "https://purl.imsglobal.org/spec/lti-dl/claim/log": "l",
      "https://purl.imsglobal.org/spec/lti-dl/claim/errormsg": "e",
      "https://purl.imsglobal.org/spec/lti-dl/claim/errorlog": "g",
      "http://vendor.example/x": 1,
    });
    const start = writeToolMessage({
      issuer: ISSUER,
      clientId: CLIENT,
      deploymentId: "dep-1",
      version: "1.3.0",
      messageType: "LtiStartAssessment",
      sessionData: "s",
      resourceLink: LINK,
      attemptNumber: 1,
      endAssessmentReturn: true,
      verifiedUser: { givenName: "Jane", picture: "https://p.example/j.jpg" },
    });
    expect(start).toMatchObject({
      "https://purl.imsglobal.org/spec/lti-ap/claim/end_assessment_return": true,
      "https://purl.imsglobal.org/spec/lti-ap/claim/verified_user": {
        given_name: "Jane",
        picture: "https://p.example/j.jpg",
      },
    });
  });

  it("writes no end_assessment_return claim when the platform need not send the End Assessment message", () => {
    const claims = writeToolMessage({
      issuer: ISSUER,
      clientId: CLIENT,
      deploymentId: "dep-1",
      version: "1.3.0",
      messageType: "LtiStartAssessment",
      sessionData: "s",
      resourceLink: LINK,
      attemptNumber: 1,
      endAssessmentReturn: false,
    });
    expect(Object.keys(claims).some((name) => name.endsWith("end_assessment_return"))).toBe(false);
  });

  it("refuses a version that is not the one LTI defines and a deployment of 256 characters", () => {
    const message = {
      issuer: ISSUER,
      clientId: CLIENT,
      deploymentId: "dep-1",
      version: "1.3.0",
      messageType: "LtiDeepLinkingResponse",
      items: [],
    } as const;
    expect(() => writeToolMessage({ ...message, version: "2" })).toThrow(DataError);
    expect(() => writeToolMessage({ ...message, deploymentId: "d".repeat(256) })).toThrow(DataError);
  });
});

/** Text that is not empty and short, so that a generated message stays small. */
const text = fc.string({ minLength: 1, maxLength: 12 });
const url = text.map((path) => `https://example.edu/${encodeURIComponent(path)}`);
const some = <TValue>(value: fc.Arbitrary<TValue>) => fc.option(value, { nil: undefined });
const roles = fc
  .subarray([...CONTEXT_ROLES, ...INSTITUTION_ROLES, ...SYSTEM_ROLES], { minLength: 1 })
  .map((list) => (list.length > 0 ? [...list, LEARNER] : [LEARNER]));
const identity = fc.record({
  subject: some(text),
  name: some(text),
  givenName: some(text),
  familyName: some(text),
  middleName: some(text),
  email: some(text),
  emailVerified: some(fc.boolean()),
  picture: some(url),
  locale: some(text),
});
const resourceLink = fc.record({ id: text, title: some(text), description: some(text) });
const common = fc.record({
  user: identity,
  roles,
  context: some(
    fc.record({ id: text, label: some(text), title: some(text), type: some(fc.constant([CONTEXT_TYPES[0] ?? ""])) }),
  ),
  organization: some(
    fc.record({ id: text, type: some(text), name: some(text), description: some(text), url: some(url) }),
  ),
  platform: some(
    fc.record({
      guid: text,
      contactEmail: some(text),
      description: some(text),
      name: some(text),
      url: some(url),
      productFamilyCode: some(text),
      version: some(text),
    }),
  ),
  presentation: some(
    fc.record({
      documentTarget: some(fc.constantFrom("frame", "iframe", "window")),
      height: some(fc.nat()),
      width: some(fc.nat()),
      returnUrl: some(url),
      locale: some(text),
    }),
  ),
  lis: some(fc.dictionary(memberName(text), text, { maxKeys: 3 })),
  custom: fc.dictionary(memberName(text), text, { maxKeys: 3 }),
  services: fc.record({
    grades: some(fc.record({ scopes: fc.array(text, { maxLength: 3 }), lineitems: some(url), lineitem: some(url) })),
    roster: some(fc.record({ contextMembershipsUrl: url, serviceVersions: some(fc.array(text, { maxLength: 2 })) })),
    groups: some(
      fc.record({
        contextGroupsUrl: url,
        contextGroupSetsUrl: some(url),
        scopes: fc.array(text, { maxLength: 2 }),
        serviceVersions: fc.array(text, { maxLength: 2 }),
      }),
    ),
    preferences: some(
      fc.record({
        hostUrl: url,
        activityIds: fc.array(text, { minLength: 1, maxLength: 2 }),
        scopes: fc.array(text, { minLength: 1, maxLength: 2 }),
      }),
    ),
  }),
  migration: some(
    fc.record({
      userId: some(text),
      contextId: some(text),
      toolConsumerInstanceGuid: some(text),
      resourceLinkId: some(text),
      oauthConsumerKey: text,
      oauthConsumerKeySign: some(text),
    }),
  ),
  extensions: some(fc.dictionary(url, fc.jsonValue(), { maxKeys: 2 })),
});
const settings = fc.record({
  returnUrl: url,
  acceptTypes: fc.array(text, { maxLength: 3 }),
  acceptPresentationDocumentTargets: fc.array(text, { maxLength: 3 }),
  acceptMediaTypes: some(
    fc.array(
      text.filter((item) => !item.includes(",") && item.trim() === item),
      { minLength: 1, maxLength: 3 },
    ),
  ),
  acceptMultiple: some(fc.boolean()),
  acceptLineItem: some(fc.boolean()),
  autoCreate: some(fc.boolean()),
  title: some(text),
  text: some(text),
  data: some(text),
});
const specific = fc.oneof(
  fc.record({ messageType: fc.constant("LtiResourceLinkRequest" as const), resourceLink }),
  fc.record({ messageType: fc.constant("LtiDeepLinkingRequest" as const), settings }),
  fc.record({
    messageType: fc.constant("LtiSubmissionReviewRequest" as const),
    resourceLink: some(resourceLink),
    forUser: fc.record({
      userId: text,
      personSourcedId: some(text),
      givenName: some(text),
      familyName: some(text),
      name: some(text),
      email: some(text),
      roles: some(fc.array(text, { maxLength: 2 })),
    }),
  }),
  fc.record({
    messageType: fc.constant("LtiStartProctoring" as const),
    resourceLink,
    attemptNumber: fc.nat(),
    startAssessmentUrl: url,
    sessionData: text,
    assessmentControl: some(fc.record({ url, actions: fc.array(text, { maxLength: 3 }) })),
    proctoringSettings: some(fc.record({ data: some(text) })),
  }),
  fc.record({
    messageType: fc.constant("LtiEndAssessment" as const),
    attemptNumber: fc.nat(),
    resourceLink: some(resourceLink),
    proctoringSettings: some(fc.record({ data: some(text) })),
    errorMessage: some(text),
    errorLog: some(text),
  }),
);

describe("the writer and the reader of messages", () => {
  it("read back what was written, for any message of the five types a platform sends", () => {
    fc.assert(
      fc.property(common, specific, (shared, own) => {
        // The grade services claim of a submission review request carries the line item.
        const services =
          own.messageType === "LtiSubmissionReviewRequest"
            ? {
                ...shared.services,
                grades: {
                  scopes: [],
                  ...shared.services.grades,
                  lineitem: shared.services.grades?.lineitem ?? "https://example.edu/li",
                },
              }
            : shared.services;
        const message = { ...base, ...shared, ...own, services } as MessageToWrite;
        const { extensions, ...expected } = message;
        const read = readBack(writeMessage(message));
        const { claims, ...rest } = read;
        expect(rest).toEqual({
          ...expected,
          migration: expected.migration && { ...expected.migration, verified: false },
        });
        for (const name of Object.keys(extensions ?? {})) expect(claims).toHaveProperty([name]);
      }),
      FUZZ,
    );
  });

  it("read back what was written, for the two messages a tool sends", () => {
    const toolBase = { issuer: ISSUER, clientId: CLIENT, deploymentId: "dep-1", version: "1.3.0" } as const;
    const items = fc.array(fc.record({ type: text, url: some(url) }), { maxLength: 3 });
    const response = fc.record({
      messageType: fc.constant("LtiDeepLinkingResponse" as const),
      data: some(text),
      items,
      message: some(text),
      log: some(text),
      errorMessage: some(text),
      errorLog: some(text),
    });
    const start = fc.record({
      messageType: fc.constant("LtiStartAssessment" as const),
      sessionData: text,
      resourceLink,
      attemptNumber: fc.nat(),
      endAssessmentReturn: fc.boolean(),
      verifiedUser: some(identity.map(({ subject: _subject, ...verified }) => verified)),
    });
    fc.assert(
      fc.property(fc.oneof(response, start), (own) => {
        const message = { ...toolBase, ...own } as ToolMessageToWrite;
        const claims = writeToolMessage(message);
        const read: ToolMessage = readToolMessage(
          JSON.parse(JSON.stringify({ iss: CLIENT, aud: ISSUER, ...claims })),
          options,
        );
        const { claims: _claims, ...rest } = read;
        expect(rest).toEqual(message);
      }),
      FUZZ,
    );
  });
});
