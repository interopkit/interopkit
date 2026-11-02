// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import { type CallOptions, DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { signConsumerKey } from "../src/protocol/internal.js";
import { ltiLaunch, ltiLogin } from "../src/tool/index.js";
import { CLIENT_ID, DEPLOYMENT_ID, formPost, ISSUER, JWKS_URL, TARGET_LINK_URI } from "./fake-platform.js";
import { request } from "./fixture.js";
import { cookieLogin, launchOf, type Options, setup } from "./tool-setup.js";

/**
 * The rules that bind a launch to its login, the platform's authentication error, the size of the form, and what the
 * registration and the options of `ltiLaunch` accept: versions, other message types, audiences, algorithms and the LTI 1.1
 * migration claim. The expectations come from LTI 1.3 Core sections 4.1.2 and 5.3.4, the Security Framework 1.1 sections
 * 5.1.1.5 and 5.1.3, and the worked example of the Migration Guide.
 */

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const OTHER_DEPLOYMENT = "f2b3c1d7-0e1a-4c5b-9d8e-1a2b3c4d5e6f";

describe("the login that a launch answers", () => {
  it("keeps the deployment and the target of the initiation, and refuses a launch of another deployment", async () => {
    const ctx = setup({ deploymentIds: [DEPLOYMENT_ID, OTHER_DEPLOYMENT] });
    const { request: post } = await cookieLogin(ctx, { claims: { [`${CLAIM}deployment_id`]: OTHER_DEPLOYMENT } });
    await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({
      name: "LtiError",
      reason: "deployment-mismatch",
      status: 403,
      message: `The deployment of the launch, "${OTHER_DEPLOYMENT}", is not the deployment "${DEPLOYMENT_ID}" of its login.`,
    });
    expect(ctx.store.records.size).toBe(1);
  });

  it("accepts the deployment that the registration lists when the initiation named none", async () => {
    const ctx = setup({ deploymentIds: [DEPLOYMENT_ID, OTHER_DEPLOYMENT] });
    const issue = { claims: { [`${CLAIM}deployment_id`]: OTHER_DEPLOYMENT } };
    const { request: post } = await cookieLogin(ctx, issue, { deploymentId: null });
    expect(launchOf(await ltiLaunch(post, ctx.options)).deploymentId).toBe(OTHER_DEPLOYMENT);
  });

  it("refuses a launch whose target_link_uri is not the target of its login", async () => {
    const ctx = setup();
    const other = "https://tool.example.com/lti/elsewhere";
    const { request: post } = await cookieLogin(ctx, { claims: { [`${CLAIM}target_link_uri`]: other } });
    await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({
      name: "LtiError",
      reason: "target-mismatch",
      status: 400,
      message: `The target_link_uri of the launch, "${other}", is not the target "${TARGET_LINK_URI}" of its login.`,
    });
  });

  it("refuses a login for a deployment that the registration does not list, and keeps nothing", async () => {
    const ctx = setup();
    await expect(
      ltiLogin(ctx.platform.initiation({ deploymentId: OTHER_DEPLOYMENT }), ctx.options),
    ).rejects.toMatchObject({ name: "LtiError", reason: "deployment-unknown" });
    expect(ctx.store.records.size).toBe(0);
  });

  it("refuses a login whose target_link_uri is not an https URL, and keeps nothing", async () => {
    const ctx = setup();
    const initiation = ctx.platform.initiation({ targetLinkUri: "http://tool.example.com/lti" });
    await expect(ltiLogin(initiation, ctx.options)).rejects.toStrictEqual(
      new DataError(
        'The target_link_uri of the login initiation must be an absolute https URL, found "http://tool.example.com/lti".',
      ),
    );
    expect(ctx.store.records.size).toBe(0);
  });

  it("refuses an initiation form of more than 65,536 bytes before it is decoded", async () => {
    const ctx = setup();
    const post = ctx.platform.initiation({ method: "POST", messageHint: "h".repeat(65_536) });
    await expect(ltiLogin(post, ctx.options)).rejects.toThrow(/above the limit of 65536 bytes/u);
    expect(ctx.store.records.size).toBe(0);
  });
});

describe("the authentication error response of a platform", () => {
  it("is refused with its error and description, and leaves the login to expire", async () => {
    const ctx = setup();
    const response = await ltiLogin(ctx.platform.initiation(), ctx.options);
    const state = new URL(response.headers.location ?? "").searchParams.get("state") ?? "";
    const post = formPost({ error: "login_required", error_description: "The user is not logged in.", state });
    await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({
      name: "LtiError",
      reason: "platform-error",
      status: 400,
      message:
        'The platform answered the authentication request with the error "login_required" ("The user is not logged in.").',
    });
    await expect(ltiLaunch(formPost({ error: "invalid_request" }), ctx.options)).rejects.toMatchObject({
      reason: "platform-error",
      message: 'The platform answered the authentication request with the error "invalid_request".',
    });
    expect(ctx.store.records.has(state)).toBe(true);
    expect(ctx.store.gets).toBe(0);
  });
});

describe("the size of the form of a launch", () => {
  it("is at most 65,536 bytes by default, refused before the store is asked", async () => {
    const ctx = setup();
    const { auth, cookie } = await cookieLogin(ctx);
    const fields = { id_token: auth.idToken, state: auth.state };
    const filler = (bytes: number) => "f".repeat(bytes - new URLSearchParams({ ...fields, pad: "" }).toString().length);
    const full = formPost({ ...fields, pad: filler(65_536) }, { cookie });
    expect(full.body.byteLength).toBe(65_536);
    expect(launchOf(await ltiLaunch(full, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
    const over = formPost({ ...fields, pad: filler(65_537) }, { cookie });
    const gets = ctx.store.gets;
    await expect(ltiLaunch(over, ctx.options)).rejects.toMatchObject({
      name: "LtiError",
      reason: "form-too-large",
      status: 400,
      message: "The form of the launch has 65537 bytes, above the limit of 65536 bytes of the option maxFormBytes.",
    });
    expect(ctx.store.gets).toBe(gets);
  });

  it("is what the option maxFormBytes says", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    await expect(ltiLaunch(post, { ...ctx.options, maxFormBytes: 100 })).rejects.toMatchObject({
      reason: "form-too-large",
    });
    expect(launchOf(await ltiLaunch(post, { ...ctx.options, maxFormBytes: post.body.byteLength })).issuer).toBe(ISSUER);
  });
});

describe("the versions and the message types that a launch accepts", () => {
  it("accepts the version of LTI 1.3 by default, and another version only when the option names it", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { claims: { [`${CLAIM}version`]: "1.3.1" } });
    await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "version-unsupported" });
    const again = setup();
    const { request: second } = await cookieLogin(again, { claims: { [`${CLAIM}version`]: "1.3.1" } });
    const launch = launchOf(await ltiLaunch(second, { ...again.options, versions: ["1.3.0", "1.3.1"] }));
    expect(launch.version).toBe("1.3.1");
  });

  it("returns a message type that the package does not model only when the option names it, with every claim", async () => {
    const issue = { claims: { [`${CLAIM}message_type`]: "LtiEulaRequest", "https://vendor.example/eula": "v2" } };
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, issue);
    await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "message-type-unsupported" });
    const again = setup();
    const { request: second } = await cookieLogin(again, issue);
    const result = await ltiLaunch(second, { ...again.options, otherMessageTypes: ["LtiEulaRequest"] });
    if ("status" in result) throw new Error("The launch answered with a page.");
    expect(result.messageType).toBe("LtiEulaRequest");
    expect(result.claims["https://vendor.example/eula"]).toBe("v2");
  });
});

describe("the audiences and the algorithms that a registration accepts", () => {
  const TRUSTED = "https://partner.example";

  it("accepts a second audience that the registration trusts, with the tool as the authorized party", async () => {
    const ctx = setup({ trustedAudiences: [TRUSTED] });
    const { request: post } = await cookieLogin(ctx, { claims: { aud: [CLIENT_ID, TRUSTED], azp: CLIENT_ID } });
    expect(launchOf(await ltiLaunch(post, ctx.options)).clientId).toBe(CLIENT_ID);
  });

  it("refuses an audience that the registration does not trust, and several audiences without azp", async () => {
    const untrusted = setup();
    const { request: first } = await cookieLogin(untrusted, { claims: { aud: [CLIENT_ID, TRUSTED], azp: CLIENT_ID } });
    await expect(ltiLaunch(first, untrusted.options)).rejects.toMatchObject({
      reason: "audience-untrusted",
      status: 401,
    });
    const trusted = setup({ trustedAudiences: [TRUSTED] });
    const { request: second } = await cookieLogin(trusted, { claims: { aud: [CLIENT_ID, TRUSTED], azp: undefined } });
    await expect(ltiLaunch(second, trusted.options)).rejects.toMatchObject({
      reason: "authorized-party-missing",
      status: 401,
    });
  });

  it("refuses a token signed with an algorithm that the registration does not accept, before fetching a key", async () => {
    const ctx = setup({ algorithms: ["ES256", "ES384"] });
    const { request: post } = await cookieLogin(ctx);
    await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({
      reason: "algorithm-unsupported",
      message: "The token must be signed with one of ES256, ES384 (Security Framework sections 5.1.3 and 7.2).",
    });
    expect(ctx.platform.requests).not.toContain(`GET ${JWKS_URL}`);
  });
});

describe("the LTI 1.1 migration claim", () => {
  const SECRET = "secret-of-lti-1.1";
  const KEY = "consumer-key-1";

  /** Signs the consumer key of the claims as a platform that holds the secret does. */
  const signed =
    (secret: string) =>
    async (claims: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sign = await signConsumerKey(
        {
          consumerKey: KEY,
          deploymentId: DEPLOYMENT_ID,
          issuer: ISSUER,
          clientId: CLIENT_ID,
          expiresAt: Number(claims.exp),
          nonce: String(claims.nonce),
        },
        secret,
      );
      return {
        ...claims,
        [`${CLAIM}lti1p1`]: { user_id: "34212", oauth_consumer_key: KEY, oauth_consumer_key_sign: sign },
      };
    };

  /** A tool whose LTI 1.1 secret lookup records what it receives. */
  function migrating(answer: (key: string) => Promise<unknown>) {
    const ctx = setup();
    const seen: { key: string; signal: AbortSignal | undefined }[] = [];
    const { signal } = new AbortController();
    const options: Options = {
      ...ctx.options,
      signal,
      legacySecret: (key: string, call?: CallOptions) => {
        seen.push({ key, signal: call?.signal });
        return answer(key) as Promise<string | undefined>;
      },
    };
    return { ctx, options, seen, signal };
  }

  it("is verified when the host's secret for the consumer key signs it, and the lookup gets the key and the signal", async () => {
    const { ctx, options, seen, signal } = migrating(async () => SECRET);
    const { request: post } = await cookieLogin(ctx, { amend: signed(SECRET) });
    const launch = launchOf(await ltiLaunch(post, options));
    expect(launch.migration).toMatchObject({ userId: "34212", oauthConsumerKey: KEY, verified: true });
    expect(seen).toStrictEqual([{ key: KEY, signal }]);
  });

  it("is not verified when another secret signed it, when the host has no secret, or when the tool asks for none", async () => {
    for (const [secret, lookup] of [
      ["another secret", async () => SECRET],
      [SECRET, async () => undefined],
    ] as const) {
      const { ctx, options } = migrating(lookup);
      const { request: post } = await cookieLogin(ctx, { amend: signed(secret) });
      expect(launchOf(await ltiLaunch(post, options)).migration?.verified).toBe(false);
    }
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { amend: signed(SECRET) });
    expect(launchOf(await ltiLaunch(post, ctx.options)).migration?.verified).toBe(false);
  });

  it("asks for no secret when the launch has no migration claim", async () => {
    const { ctx, options, seen } = migrating(async () => SECRET);
    const { request: post } = await cookieLogin(ctx);
    expect(launchOf(await ltiLaunch(post, options)).migration).toBeUndefined();
    expect(seen).toStrictEqual([]);
  });

  it("fails the launch, and keeps the login, when the lookup rejects or answers what is not a secret", async () => {
    const down = new Error("The secret store is down.");
    const failing = migrating(() => Promise.reject(down));
    const { request: post, auth } = await cookieLogin(failing.ctx, { amend: signed(SECRET) });
    await expect(ltiLaunch(post, failing.options)).rejects.toBe(down);
    expect(failing.ctx.store.records.has(auth.state)).toBe(true);
    const odd = migrating(async () => 5);
    const { request: second } = await cookieLogin(odd.ctx, { amend: signed(SECRET) });
    await expect(ltiLaunch(second, odd.options)).rejects.toStrictEqual(
      new DataError("The option legacySecret must resolve with a string or undefined, found 5."),
    );
  });
});

describe("the options of ltiLaunch that this unit adds", () => {
  it("are refused when they have other types", async () => {
    const ctx = setup();
    const post = request({ method: "POST", url: "https://tool.example.com/lti/launch" });
    const cases: readonly [string, Partial<Record<keyof Options, unknown>>][] = [
      ['The option versions must be an array, found "1.3.0".', { versions: "1.3.0" }],
      ["An entry of the option versions must be a non-empty string, found 5.", { versions: [5] }],
      ['An entry of the option otherMessageTypes must be a non-empty string, found "".', { otherMessageTypes: [""] }],
      ["The option maxFormBytes must be a positive integer, found 0.", { maxFormBytes: 0 }],
      ['The option maxFormBytes must be a positive integer, found "65536".', { maxFormBytes: "65536" }],
      ['The option legacySecret must be a function, found "secret".', { legacySecret: "secret" }],
    ];
    for (const [message, more] of cases) {
      const options = JSON.parse(JSON.stringify(more));
      await expect(ltiLaunch(post, { ...ctx.options, ...options }), message).rejects.toStrictEqual(
        new DataError(message),
      );
    }
  });
});
