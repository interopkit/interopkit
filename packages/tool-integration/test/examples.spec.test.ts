// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims and of AGS scores are those of the specifications.

import { resolve } from "node:path";
import { DataError } from "@interopkit/core";
import { createLocalJWKSet, exportJWK } from "jose";
import { describe, expect, it } from "vitest";
import { readSpecExamples, readSpecPage } from "../../../scripts/spec-examples.js";
import type { DeepLinkingRequestMessage, LtiMessage } from "../src/index.js";
import type { ResourceLinkInput } from "../src/platform/index.js";
import { readMessage, readToolMessage, verifyJwt, writeMessage, writeToolMessage } from "../src/protocol/internal.js";
import { deepLinkResponse, ltiLaunch, type PlatformRegistration, publishAgsScore } from "../src/tool/index.js";
import { FakeLms, LINE_ITEM_URL } from "./fake-lms.js";
import { registrationOf } from "./fake-platform.js";
import { authenticationRequest, toolRegistration } from "./fake-tool.js";
import { generateKeyPair, readToken, signToken } from "./fixture.js";
import {
  begin as platformBegin,
  config as platformConfig,
  endpoints as platformEndpoints,
  handle as platformHandle,
  setup as platformSetup,
  readPost,
} from "./platform-setup.js";
import { textOf } from "./text-of.js";
import { cookieLogin, setup, toolKey } from "./tool-setup.js";

/**
 * The examples are those of the specifications: LTI Core 1.3 Appendix E and Deep Linking 2.0 Appendices A and B as the open
 * portal prints them, Submission Review 1.0 section 3.4, the claim of the AfA PNP Connector 1.0, and AGS 2.0 section 3.4.
 * `pnpm spec-examples` downloads them at the hashes that scripts/spec-examples.lock.json pins.
 */
const examples = readSpecExamples(resolve(import.meta.dirname, "../../.."));

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const DL = "https://purl.imsglobal.org/spec/lti-dl/claim/";

/** The registration that an example's claims imply: its issuer, its client and its deployment. */
function registrationFor(claims: Readonly<Record<string, unknown>>, client: string): PlatformRegistration {
  return registrationOf(toolKey, {
    issuer: String(claims.iss),
    clientId: client,
    deploymentIds: [String(claims[`${CLAIM}deployment_id`])],
  });
}

/** What a token adds to the claims of a message, which the model does not hold and the writer does not write. */
const ENVELOPE = ["iss", "aud", "exp", "iat", "azp", "nonce"];

/** The claims of an example without those of the token. */
function withoutEnvelope(claims: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(claims).filter(([name]) => !ENVELOPE.includes(name)));
}

/** Reads the claims of an example as the tool of its registration does. */
function readExample(claims: Readonly<Record<string, unknown>>, client: string): LtiMessage {
  const { issuer, clientId, deploymentIds } = registrationFor(claims, client);
  return readMessage(claims, { issuer, clientId, deploymentIds });
}

/** Writes a message read from an example back, with the vendor claims it carried, as the claims of the example. */
function writtenBack(message: LtiMessage): Record<string, unknown> {
  const extensions = Object.fromEntries(Object.entries(message.claims).filter(([name]) => name.startsWith("http://")));
  const { claims: _claims, migration, ...rest } = message;
  return writeMessage({ ...rest, migration: migration && { ...migration }, extensions } as Parameters<
    typeof writeMessage
  >[0]);
}

describe("the launch of LTI Core Appendix E", () => {
  const { launch } = examples;
  const client = String(launch.azp);

  it("reads into the message that its claims say", () => {
    const read = readExample(launch, client);
    expect(read).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      user: {
        subject: launch.sub,
        name: launch.name,
        givenName: launch.given_name,
        picture: launch.picture,
        locale: launch.locale,
      },
      deploymentId: launch[`${CLAIM}deployment_id`],
      roles: launch[`${CLAIM}roles`],
      roleScopeMentor: launch[`${CLAIM}role_scope_mentor`],
      targetLinkUri: launch[`${CLAIM}target_link_uri`],
      resourceLink: launch[`${CLAIM}resource_link`],
    });
    expect(Object.fromEntries(read.custom)).toEqual(launch[`${CLAIM}custom`]);
  });

  it("is written back as the claims of the example, vendor claims included", () => {
    expect(writtenBack(readExample(launch, client))).toEqual(withoutEnvelope(launch));
  });

  it("verifies as a token signed by the platform, at a time inside its lifetime", async () => {
    const key = await generateKeyPair("platform-1");
    const keys = createLocalJWKSet({
      keys: [{ ...(await exportJWK(key.publicKey)), kid: "platform-1", alg: "RS256" }],
    });
    const token = await signToken(launch, key);
    const now = (Number(launch.iat) + 10) * 1000;
    const claims = await verifyJwt(
      token,
      keys,
      { issuer: String(launch.iss), audience: client, authorizedParty: client, requiredClaims: ["exp", "iat"] },
      now,
    );
    expect(claims).toEqual(readToken(token).payload);
    expect(claims).toEqual(launch);
  });
});

/**
 * The request of Deep Linking Appendix A has no `target_link_uri`, which LTI Core section 5.3.4 requires of every message, and
 * its `tool_platform` has no `guid`, which section 5.4.3 requires (spec-gaps.md). The tool role keeps both rules, so the
 * examples are read with the two claims added.
 */
const COMPLETED = {
  [`${CLAIM}target_link_uri`]: "https://tool.example.com/lti/deep-linking",
  [`${CLAIM}tool_platform`]: {
    ...(examples.deepLinkingRequest[`${CLAIM}tool_platform`] as Record<string, unknown>),
    guid: "ex/48bbb541-ce55-456e-8b7d-ebc59a38d435",
  },
};
const deepLinkingRequest: Readonly<Record<string, unknown>> = { ...examples.deepLinkingRequest, ...COMPLETED };

describe("the Deep Linking request of Deep Linking Appendix A", () => {
  const request = deepLinkingRequest;
  const settings = request[`${DL}deep_linking_settings`] as Record<string, unknown>;

  it("is refused as it stands, because it lacks the target_link_uri and the guid that LTI Core requires", () => {
    const registration = registrationFor(request, String(request.aud));
    const read = (claims: Readonly<Record<string, unknown>>) => () =>
      readMessage(claims, {
        issuer: registration.issuer,
        clientId: registration.clientId,
        deploymentIds: registration.deploymentIds,
      });
    expect(read(examples.deepLinkingRequest)).toThrow(expect.objectContaining({ reason: "claim-missing" }));
    const withTarget = {
      ...examples.deepLinkingRequest,
      [`${CLAIM}target_link_uri`]: COMPLETED[`${CLAIM}target_link_uri`],
    };
    expect(read(withTarget)).toThrow(expect.objectContaining({ reason: "claim-missing" }));
  });

  it("reads into the ten settings that it says, and the deprecated context type as sent", () => {
    const read = readExample(request, String(request.aud));
    expect(read).toMatchObject({
      messageType: "LtiDeepLinkingRequest",
      context: { type: ["CourseOffering"] },
      settings: {
        returnUrl: settings.deep_link_return_url,
        acceptTypes: settings.accept_types,
        acceptPresentationDocumentTargets: settings.accept_presentation_document_targets,
        // The portal prints the asterisk of `image/*` as `:::asterisk:::` (spec-gaps.md); the reader keeps the text.
        acceptMediaTypes: ["image/:::asterisk:::", "text/html"],
        acceptMultiple: settings.accept_multiple,
        autoCreate: settings.auto_create,
        title: settings.title,
        text: settings.text,
        data: settings.data,
      },
    });
  });

  it("is written back as the claims of the example, with the two claims added", () => {
    expect(writtenBack(readExample(request, String(request.aud)))).toEqual(withoutEnvelope(request));
  });
});

describe("the Deep Linking response of Deep Linking Appendix B", () => {
  const response = examples.deepLinkingResponse;
  const items = response[`${DL}content_items`] as readonly Record<string, unknown>[];
  const options = {
    issuer: String(response.aud),
    clientId: String(response.iss),
    deploymentIds: [String(response[`${CLAIM}deployment_id`])],
  };

  it("reads into the data it returns and the seven items it places, whatever their type", () => {
    const read = readToolMessage(response, options);
    expect(read).toMatchObject({ messageType: "LtiDeepLinkingResponse", data: response[`${DL}data`], items });
    expect(items).toHaveLength(7);
  });

  it("is written back as the claims of the example", () => {
    const { claims: _claims, ...read } = readToolMessage(response, options);
    expect(writeToolMessage(read)).toEqual(withoutEnvelope(response));
  });

  it("places the resource link of the example as the example says, as far as the tool role supports it", async () => {
    const request = deepLinkingRequest;
    const registration = registrationFor(request, String(request.aud));
    const launch = readExample(request, String(request.aud)) as DeepLinkingRequestMessage;
    const example = items.find((item) => item.type === "ltiResourceLink") ?? {};
    const { type, title, text, url, custom } = example;
    // `gradesReleased` of a line item is not supported yet (supported.md).
    const { gradesReleased: _gradesReleased, ...lineItem } = example.lineItem as Record<string, unknown>;
    const item = {
      title,
      text,
      url,
      lineItem,
      custom: custom === undefined ? undefined : new Map(Object.entries(custom as Record<string, string>)),
    };
    const { clock } = setup();
    const jwt = await deepLinkResponse(launch, [item as never], { registration: async () => registration, clock });
    const [placed] = readToken(jwt).payload[`${DL}content_items`] as readonly Record<string, unknown>[];
    expect(placed).toEqual({ type, title, text, url, custom, lineItem });
    expect(readToken(jwt).payload[`${DL}data`]).toBe(
      (request[`${DL}deep_linking_settings`] as Record<string, unknown>).data,
    );
  });
});

describe("the submission review requests of Submission Review section 3.4", () => {
  const pages = readSpecPage(resolve(import.meta.dirname, "../../.."), "lti-submission-review-1p0.json") as Record<
    string,
    unknown
  >[];
  const requests = pages.filter((block) => block[`${CLAIM}message_type`] === "LtiSubmissionReviewRequest");
  const PRESENTATION = "https://purl.imsglobal.org/spec/lti/claim/launch_presentation";
  // Submission Review section 2.4 has the target link URI in the id_token, and the examples print none.
  const TARGET = { [`${CLAIM}target_link_uri`]: "https://tool.example.com/lti/review" };

  it("holds a coupled and a standalone line item", () => {
    expect(requests.map((request) => `${CLAIM}resource_link` in request)).toEqual([true, false]);
  });

  it("is refused as it stands: it has no target_link_uri, and its return_url is not an https address as LTI Core requires", () => {
    for (const request of requests) {
      expect(() => readExample(request, String(request.azp))).toThrow(
        expect.objectContaining({ reason: "claim-missing" }),
      );
      expect(() => readExample({ ...request, ...TARGET }, String(request.azp))).toThrow(
        expect.objectContaining({ reason: "claim-invalid" }),
      );
    }
  });

  it("reads into the user whose work is shown and the line item, with the target link URI added and the return_url on https", () => {
    for (const request of requests) {
      const secure = { ...request, ...TARGET, [PRESENTATION]: { return_url: "https://example.org/returnToGradebook" } };
      const read = readExample(secure, String(request.azp));
      expect(read).toMatchObject({
        messageType: "LtiSubmissionReviewRequest",
        forUser: {
          userId: "1239a-ilt",
          givenName: "Jude",
          roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
        },
        services: { grades: { lineitem: "https://www.myuniv.edu/2344/lineitems/1234/lineitem" } },
        context: { type: ["CourseOffering"] },
      });
      expect(writtenBack(read)).toEqual(withoutEnvelope(secure));
    }
  });
});

describe("the claim of the AfA PNP Connector", () => {
  const [block] = readSpecPage(resolve(import.meta.dirname, "../../.."), "lti-pnp-connector-1p0.json") as Record<
    string,
    unknown
  >[];
  const CLAIM_NAME = "https://purl.imsglobal.org/spec/lti-afapnp/claim/afapnp-endpoint-service";
  const custom = (block?.[`${CLAIM}custom`] ?? {}) as Record<string, unknown>;
  const message = { ...examples.launch, [CLAIM_NAME]: custom[CLAIM_NAME] };
  const client = String(examples.launch.azp);

  it("reads as a claim of the message, as the text says, with the host, the activities and the scopes", () => {
    expect(readExample(message, client).services.preferences).toEqual({
      hostUrl: "https://example.edu/lti/afapnp-hosturl",
      activityIds: ["1c519ff7-3dfa-4764-be48-d2fb35a2925a"],
      scopes: ["https://purl.imsglobal.org/spec/afapnp/v1p0/scope/afapnprecord.lti.readonly"],
    });
  });

  it("is refused where the example prints it, inside the custom claim, whose values are strings", () => {
    expect(() => readExample({ ...examples.launch, [`${CLAIM}custom`]: block?.[`${CLAIM}custom`] }, client)).toThrow(
      expect.objectContaining({ reason: "claim-invalid" }),
    );
  });
});

describe("the scores of AGS section 3.4", () => {
  /** A tool launched by a user, and what the score service received of a publish. */
  async function publish(score: Record<string, unknown>): Promise<unknown> {
    const { userId, ...input } = score;
    const ctx = setup();
    const lms = new FakeLms(ctx.platform);
    const { request: post } = await cookieLogin(ctx, { claims: { sub: String(userId) } });
    const launch = (await ltiLaunch(post, ctx.options)) as LtiMessage;
    const received: unknown[] = [];
    const fetch: typeof lms.fetch = async (url, init) => {
      if (url !== `${LINE_ITEM_URL}/scores`) return lms.fetch(url, init);
      received.push(JSON.parse(textOf(init.body ?? "")));
      return new Response(null, { status: 204 });
    };
    await publishAgsScore(input as never, launch, { ...ctx.options, fetch });
    return received[0];
  }

  it("posts the score of the example that waits for a person, as the example shows it", async () => {
    const plain = examples.scores.find((score) => Object.keys(score).length === 4) ?? {};
    expect(await publish(plain)).toEqual(plain);
  });

  it("refuses the score of the example that carries an extension, which the tool role does not support", async () => {
    const extended = examples.scores.find((score) => Object.keys(score).length > 4) ?? {};
    await expect(publish(extended)).rejects.toBeInstanceOf(DataError);
  });
});

describe("the platform role against the same examples", () => {
  it("issues the launch of LTI Core Appendix E from the message it says, claim for claim but the services", async () => {
    const client = String(examples.launch.azp);
    const read = readExample(examples.launch, client);
    if (read.messageType !== "LtiResourceLinkRequest") throw new Error("The example is not a resource link launch.");
    const message: ResourceLinkInput = {
      messageType: read.messageType,
      clientId: client,
      deploymentId: read.deploymentId,
      targetLinkUri: read.targetLinkUri,
      user: read.user,
      roles: read.roles,
      roleScopeMentor: read.roleScopeMentor,
      context: read.context,
      presentation: read.presentation,
      lis: read.lis,
      custom: Object.fromEntries(read.custom),
      extensions: Object.fromEntries(Object.entries(read.claims).filter(([name]) => name.startsWith("http://"))),
      resourceLink: read.resourceLink,
    };
    const ctx = platformSetup({ tools: [toolRegistration({ clientId: client, deploymentIds: [read.deploymentId] })] });
    const { parameters } = await platformBegin(ctx, message);
    const config = { ...platformConfig, instance: read.platform };
    const page = await platformHandle(ctx, authenticationRequest(platformEndpoints.authorization, parameters), {
      config,
    });
    const issued = readToken(readPost(page).fields.get("id_token") ?? "").payload;
    const services = (claims: Readonly<Record<string, unknown>>) =>
      Object.fromEntries(Object.entries(withoutEnvelope(claims)).filter(([name]) => !/lti-(ags|nrps)/u.test(name)));
    expect(services(issued)).toEqual(services(examples.launch));
  });
});
