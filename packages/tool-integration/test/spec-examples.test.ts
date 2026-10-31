// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims and of AGS scores are those of the specifications.

import { resolve } from "node:path";
import { DataError } from "@interopkit/core";
import { createLocalJWKSet, exportJWK } from "jose";
import { describe, expect, it } from "vitest";
import { readSpecExamples } from "../../../scripts/spec-examples.js";
import { readAgsScore } from "../src/platform/index.js";
import { verifyJwt } from "../src/protocol/internal.js";
import {
  type DeepLinkingLaunch,
  deepLinkResponse,
  type LtiLaunch,
  ltiLaunch,
  type PlatformRegistration,
  publishAgsScore,
} from "../src/tool/index.js";
import { readLaunch } from "../src/tool/internal.js";
import { FakeLms, LINE_ITEM_URL } from "./fake-lms.js";
import { registrationOf } from "./fake-platform.js";
import { generateKeyPair, readToken, signToken } from "./fixture.js";
import { launch as platformLaunch, setup as platformSetup } from "./platform-setup.js";
import { cookieLogin, setup, toolKey } from "./tool-setup.js";

/**
 * The examples are those of the specifications: LTI Core 1.3 Appendix E, Deep Linking 2.0 Appendices A and B, and AGS 2.0
 * section 3.4. `pnpm spec-examples` downloads them at the hashes that scripts/spec-examples.lock.json pins.
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

describe("the launch of LTI Core Appendix E", () => {
  const { launch } = examples;
  const client = String(launch.azp);

  it("reads into the launch that its claims say", () => {
    const read = readLaunch(launch, registrationFor(launch, client));
    expect(read).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      subject: launch.sub,
      deploymentId: launch[`${CLAIM}deployment_id`],
      roles: launch[`${CLAIM}roles`],
      targetLinkUri: launch[`${CLAIM}target_link_uri`],
      resourceLink: launch[`${CLAIM}resource_link`],
    });
    expect(Object.fromEntries(read.custom)).toEqual(launch[`${CLAIM}custom`]);
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
      { issuer: String(launch.iss), audience: client, requiredClaims: ["exp", "iat"] },
      now,
    );
    expect(claims).toEqual(readToken(token).payload);
    expect(claims).toEqual(launch);
  });
});

/**
 * The request of Deep Linking Appendix A has no `target_link_uri`, which LTI Core section 5.3.4 requires of every message
 * (spec-gaps.md). The tool role keeps the rule, so the examples are read with the claim added.
 */
const TARGET = { [`${CLAIM}target_link_uri`]: "https://tool.example.com/lti/deep-linking" };
const deepLinkingRequest: Readonly<Record<string, unknown>> = { ...examples.deepLinkingRequest, ...TARGET };

describe("the Deep Linking request of Deep Linking Appendix A", () => {
  const request = deepLinkingRequest;
  const settings = request[`${DL}deep_linking_settings`] as Record<string, unknown>;

  it("is refused as it stands, because it lacks the target_link_uri that LTI Core requires", () => {
    expect(() => readLaunch(examples.deepLinkingRequest, registrationFor(request, String(request.aud)))).toThrow(
      expect.objectContaining({ reason: "claim-missing" }),
    );
  });

  it("reads into the settings that it says", () => {
    const read = readLaunch(request, registrationFor(request, String(request.aud)));
    expect(read).toMatchObject({
      messageType: "LtiDeepLinkingRequest",
      settings: {
        returnUrl: settings.deep_link_return_url,
        acceptTypes: settings.accept_types,
        acceptMultiple: settings.accept_multiple,
        data: settings.data,
      },
    });
  });
});

describe("the Deep Linking response of Deep Linking Appendix B", () => {
  it("places the resource link of the example as the example says, as far as the tool role supports it", async () => {
    const request = deepLinkingRequest;
    const registration = registrationFor(request, String(request.aud));
    const launch = readLaunch(request, registration) as DeepLinkingLaunch;
    const items = examples.deepLinkingResponse[`${DL}content_items`] as readonly Record<string, unknown>[];
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

describe("the scores of AGS section 3.4", () => {
  /** A tool launched by a user, and what the score service received of a publish. */
  async function publish(score: Record<string, unknown>): Promise<unknown> {
    const { userId, ...input } = score;
    const ctx = setup();
    const lms = new FakeLms(ctx.platform);
    const { request: post } = await cookieLogin(ctx, { claims: { sub: String(userId) } });
    const launch = (await ltiLaunch(post, ctx.options)) as LtiLaunch;
    const received: unknown[] = [];
    const fetch: typeof lms.fetch = async (url, init) => {
      if (url !== `${LINE_ITEM_URL}/scores`) return lms.fetch(url, init);
      received.push(JSON.parse(init.body ?? ""));
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
  it("reads each score of AGS section 3.4 into the fields that it says", () => {
    for (const example of examples.scores) {
      expect(readAgsScore(example)).toMatchObject({
        userId: example.userId,
        timestamp: example.timestamp,
        timestampMs: Date.parse(String(example.timestamp)),
        activityProgress: example.activityProgress,
        gradingProgress: example.gradingProgress,
      });
    }
  });

  it("issues an id_token with the required claims of LTI Core Appendix E, of the same kinds", async () => {
    const issued = (await platformLaunch(platformSetup())).claims;
    const required = [
      "iss",
      "sub",
      "aud",
      "exp",
      "iat",
      "nonce",
      `${CLAIM}deployment_id`,
      `${CLAIM}message_type`,
      `${CLAIM}version`,
      `${CLAIM}roles`,
      `${CLAIM}resource_link`,
      `${CLAIM}target_link_uri`,
    ];
    for (const name of required) {
      expect(name in issued, name).toBe(true);
      expect(typeof issued[name], name).toBe(typeof examples.launch[name === "aud" ? "iss" : name]);
    }
    expect(issued[`${CLAIM}message_type`]).toBe(examples.launch[`${CLAIM}message_type`]);
    expect(issued[`${CLAIM}version`]).toBe(examples.launch[`${CLAIM}version`]);
    expect(Object.keys(issued).every((name) => name in examples.launch || name.includes("lti-ags"))).toBe(true);
  });
});
