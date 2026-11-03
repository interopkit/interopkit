// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import { createHmac } from "node:crypto";
import { DataError, ServiceError, signerFromCryptoKey } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import fc from "fast-check";
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import type { LtiMessage } from "../src/index.js";
import { randomToken } from "../src/protocol/internal.js";
import { ltiLaunch, ltiLogin, type PlatformRegistration } from "../src/tool/index.js";
import { getDataPage, requestServiceToken } from "../src/tool/internal.js";
import {
  ACCESS_TOKEN_URL,
  AGS_SCOPES,
  AUTHENTICATION_URL,
  CLIENT_ID,
  cookieOf,
  DEPLOYMENT_ID,
  formPost,
  ISSUER,
  LOGIN_URL,
  REDIRECT_URI,
  RETURN_URL,
  TARGET_LINK_URI,
  TOOL_ORIGIN,
} from "./fake-platform.js";
import { base64url, generateKeyPair, type KeyPair, NOW, readPage, request, signToken } from "./fixture.js";
import { textOf } from "./text-of.js";
import {
  attackerKey,
  cookieLogin,
  deepLinkingOf,
  launchOf,
  type Options,
  platformKey,
  rotatedKey,
  SECONDS,
  type Setup,
  setup,
  storageLogin,
  toolKey,
  verificationPost,
} from "./tool-setup.js";

describe("the request of a service token", () => {
  const [lineitem, , score] = AGS_SCOPES;
  const scopes = [lineitem ?? "", score ?? ""];

  /** Requests a token as the tool role does, for the deployment of the fake platform. */
  function tokenFor(ctx: Setup, asked: readonly string[], more: Partial<Options> = {}) {
    const options = { ...ctx.options, ...more };
    return requestServiceToken(ctx.registration, DEPLOYMENT_ID, asked, {
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? 10_000,
      clock: options.clock,
    });
  }

  it("requests a token with a client assertion that the signer signs and that names the deployment", async () => {
    const ctx = setup();
    const token = await tokenFor(ctx, scopes);
    expect(token).toEqual({ accessToken: "access-token-1", expiresAt: NOW + 3_600_000, scopes });
    expect(ctx.platform.requests).toEqual([`POST ${ACCESS_TOKEN_URL}`]);
    const [grant] = ctx.platform.grants;
    expect(grant?.scope).toBe(scopes.join(" "));
    expect(grant?.header).toEqual({ alg: "RS256", typ: "JWT", kid: toolKey.kid });
    expect(grant?.payload["https://purl.imsglobal.org/spec/lti/claim/deployment_id"]).toBe(DEPLOYMENT_ID);
  });

  it("uses a new jti for each request", async () => {
    const ctx = setup();
    await tokenFor(ctx, scopes);
    await tokenFor(ctx, scopes);
    const ids = ctx.platform.grants.map((grant) => grant.payload.jti);
    expect(new Set(ids).size).toBe(2);
  });

  it("returns the scopes that the platform grants, a subset of those requested", async () => {
    const token = await tokenFor(setup(), [score ?? "", "https://example.org/scope/other"]);
    expect(token.scopes).toEqual([score]);
  });

  it("takes the requested scopes when the response names none, and has no expiry without expires_in", async () => {
    const ctx = setup();
    ctx.platform.tokenResponse = () => Response.json({ access_token: "t1", token_type: "bearer", expires_in: 60 });
    expect(await tokenFor(ctx, scopes)).toEqual({ accessToken: "t1", expiresAt: NOW + 60_000, scopes });
    ctx.platform.tokenResponse = () => Response.json({ access_token: "t2", token_type: "Bearer" });
    expect(await tokenFor(ctx, scopes)).toStrictEqual({ accessToken: "t2", scopes });
  });

  it("puts the audience of the registration in the assertion when it has one, and the token endpoint when it has none", async () => {
    const named = setup({ audience: "https://lms.example.edu" });
    named.platform.audience = "https://lms.example.edu";
    await tokenFor(named, scopes);
    expect(named.platform.grants.at(-1)?.payload.aud).toBe("https://lms.example.edu");
    const plain = setup();
    await tokenFor(plain, scopes);
    expect(plain.platform.grants.at(-1)?.payload.aud).toBe(ACCESS_TOKEN_URL);
  });

  it("signs with the algorithm and the key of the signer, such as ES256 with a key that a KMS holds", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const signer = signerFromCryptoKey(pair.privateKey, { algorithm: "ES256", keyId: "tool-ec-1" });
    const ctx = setup({ signer });
    let assertion = "";
    const fetch: Options["fetch"] = async (_url, init) => {
      assertion = new URLSearchParams(textOf(init.body)).get("client_assertion") ?? "";
      return Response.json({ access_token: "t", token_type: "Bearer", expires_in: 60 });
    };
    await tokenFor(ctx, scopes, { fetch });
    const { protectedHeader, payload } = await jwtVerify(assertion, pair.publicKey, { currentDate: new Date(NOW) });
    expect(protectedHeader).toEqual({ alg: "ES256", typ: "JWT", kid: "tool-ec-1" });
    expect(payload["https://purl.imsglobal.org/spec/lti/claim/deployment_id"]).toBe(DEPLOYMENT_ID);
  });

  it("sends the request to the token endpoint of the registration within the time limit", async () => {
    const ctx = setup();
    let seen: { url: string; signal: AbortSignal | undefined } | undefined;
    const fetch: Options["fetch"] = async (url, init) => {
      seen = { url, signal: init.signal };
      return Response.json({ access_token: "t", token_type: "Bearer", expires_in: 1 });
    };
    await tokenFor(ctx, scopes, { fetch, timeoutMs: 5000 });
    expect(seen?.url).toBe(ACCESS_TOKEN_URL);
    expect(seen?.signal?.aborted).toBe(false);
  });

  it("throws ServiceError with the status, the body and the OAuth error when the platform refuses", async () => {
    const error = await tokenFor(setup(), ["https://example.org/scope/other"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      status: 400,
      body: '{"error":"invalid_scope"}',
      message: `The token endpoint ${ACCESS_TOKEN_URL} refused the request: invalid_scope.`,
    });
  });

  it("throws ServiceError with status 0 when the platform does not answer, or answers after the time limit", async () => {
    const ctx = setup();
    ctx.platform.tokenResponse = () => {
      throw new TypeError("network down");
    };
    const error = await tokenFor(ctx, scopes).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "ServiceError", status: 0 });
    expect(String(error)).toContain("network down");
    const fetch: Options["fetch"] = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    await expect(tokenFor(ctx, scopes, { fetch, timeoutMs: 20 })).rejects.toMatchObject({
      name: "ServiceError",
      status: 0,
    });
  });

  it("throws ServiceError for an answer that is not a token response", async () => {
    const ctx = setup();
    const answers: readonly (() => Response)[] = [
      () => new Response("<html>", { headers: { "content-type": "text/html" } }),
      () => Response.json([]),
      () => Response.json({ token_type: "Bearer", expires_in: 60 }),
      () => Response.json({ access_token: "t", token_type: "mac", expires_in: 60 }),
      () => Response.json({ access_token: "t", token_type: "Bearer", expires_in: 60, scope: 5 }),
    ];
    for (const answer of answers) {
      ctx.platform.tokenResponse = answer;
      await expect(tokenFor(ctx, scopes)).rejects.toBeInstanceOf(ServiceError);
    }
  });
});

describe("ltiLaunch", () => {
  describe("on the cookie path", () => {
    it("returns the launch of a resource link, with the claims that the platform sent", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      expect(launchOf(await ltiLaunch(post, ctx.options))).toMatchObject({
        messageType: "LtiResourceLinkRequest",
        issuer: ISSUER,
        clientId: CLIENT_ID,
        deploymentId: DEPLOYMENT_ID,
        version: "1.3.0",
        targetLinkUri: TARGET_LINK_URI,
        user: { subject: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a" },
        roles: [
          "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student",
          "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
        ],
        custom: new Map([
          ["exam", "tryout-1"],
          ["attempt", "2"],
        ]),
        resourceLink: {
          id: "200d101f-2c14-434a-a0f3-57c2a42369fd",
          title: "Introduction Assignment",
          description: "Assignment to introduce who you are",
        },
        services: {
          grades: {
            scopes: AGS_SCOPES,
            lineitems: "https://lms.example.edu/2344/lineitems/",
            lineitem: "https://lms.example.edu/2344/lineitems/1234/lineitem",
          },
        },
      });
    });

    it("returns the settings of a Deep Linking request", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
      const launch = deepLinkingOf(await ltiLaunch(post, ctx.options));
      expect(launch.settings).toMatchObject({
        returnUrl: RETURN_URL,
        acceptTypes: ["link", "file", "html", "ltiResourceLink", "image"],
        acceptMultiple: true,
        data: "deep-link-data-1",
      });
      expect(launch.roles).toEqual(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]);
    });

    it("accepts an anonymous launch, a blank line item, an audience string and an azp that is absent", async () => {
      const ctx = setup();
      const claims = {
        sub: undefined,
        azp: undefined,
        aud: CLIENT_ID,
        "https://purl.imsglobal.org/spec/lti/claim/roles": [],
        "https://purl.imsglobal.org/spec/lti/claim/custom": undefined,
        "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": { scope: [AGS_SCOPES[2]], lineitem: "" },
      };
      const { request: post } = await cookieLogin(ctx, { claims });
      const launch = launchOf(await ltiLaunch(post, ctx.options));
      expect(launch).toMatchObject({ roles: [], custom: new Map(), services: { grades: { scopes: [AGS_SCOPES[2]] } } });
      expect(launch.user.subject).toBeUndefined();
      expect(launch.services.grades?.lineitem).toBeUndefined();
    });

    it("keeps an identifier such as __proto__ as data in the custom properties", async () => {
      const ctx = setup();
      const claims = {
        "https://purl.imsglobal.org/spec/lti/claim/custom": JSON.parse('{"__proto__":"x","constructor":"y"}'),
      };
      const { request: post } = await cookieLogin(ctx, { claims });
      const launch = launchOf(await ltiLaunch(post, ctx.options));
      expect(launch.custom.get("__proto__")).toBe("x");
      expect(launch.custom.get("constructor")).toBe("y");
    });

    it("completes a login once: the same post fails the second time", async () => {
      const ctx = setup();
      const { request: post, auth } = await cookieLogin(ctx);
      launchOf(await ltiLaunch(post, ctx.options));
      expect(ctx.store.records.has(auth.state)).toBe(false);
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ name: "LtiError", reason: "state-unknown" });
    });

    it("lets one of two launches that race with one login complete", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      ctx.store.lose = true;
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ name: "LtiError", reason: "state-reused" });
    });

    it("refuses a token that answers another login", async () => {
      const ctx = setup();
      const first = await cookieLogin(ctx);
      const second = await cookieLogin(ctx);
      const crossed = formPost({ id_token: first.auth.idToken, state: second.auth.state }, { cookie: second.cookie });
      await expect(ltiLaunch(crossed, ctx.options)).rejects.toMatchObject({ reason: "nonce-mismatch" });
      expect(ctx.store.records.has(second.auth.state)).toBe(true);
    });

    it("refuses a launch whose browser did not log in: the state cookie is missing or differs", async () => {
      const ctx = setup();
      const first = await cookieLogin(ctx);
      const second = await cookieLogin(ctx);
      const withCookie = (cookie: string): HttpRequest => first.auth.post(cookie === "" ? {} : { cookie });
      for (const cookie of [
        "",
        `__Host-lti_state_${first.auth.state}=other`,
        second.cookie,
        `lti_state_${first.auth.state}=${first.auth.state}`,
        `x=1; ${second.cookie}`,
      ]) {
        await expect(ltiLaunch(withCookie(cookie), ctx.options), cookie).rejects.toMatchObject({
          name: "LtiError",
          reason: "state-cookie",
        });
      }
      const accepted = withCookie(`other=1; ${first.cookie}; more=2`);
      expect(launchOf(await ltiLaunch(accepted, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
    });

    it("refuses a state that no login of the tool has, without asking the store for a malformed one", async () => {
      const ctx = setup();
      const { auth } = await cookieLogin(ctx);
      const gets = ctx.store.gets;
      for (const state of ["../etc/passwd", "a".repeat(65), "with space", "ünï"]) {
        const post = formPost({ id_token: auth.idToken, state });
        await expect(ltiLaunch(post, ctx.options), state).rejects.toMatchObject({ reason: "state-unknown" });
      }
      expect(ctx.store.gets).toBe(gets);
      const unknown = formPost({ id_token: auth.idToken, state: randomToken() });
      await expect(ltiLaunch(unknown, ctx.options)).rejects.toMatchObject({ reason: "state-unknown" });
    });

    it("refuses a login after ten minutes", async () => {
      const ctx = setup();
      const finish = async (seconds: number): Promise<LtiMessage | HttpResponse> => {
        const response = await ltiLogin(ctx.platform.initiation(), ctx.options);
        ctx.clock.advance(seconds);
        const auth = await ctx.platform.authenticate(response.headers.location ?? "");
        return ltiLaunch(auth.post({ cookie: cookieOf(response.headers["set-cookie"]) }), ctx.options);
      };
      expect(launchOf(await finish(599)).messageType).toBe("LtiResourceLinkRequest");
      await expect(finish(600)).rejects.toMatchObject({ name: "LtiError", reason: "state-expired" });
    });

    it("refuses a token that is not signed with one of the six approved algorithms", async () => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const header = (alg: string): string => base64url(JSON.stringify({ alg, typ: "JWT", kid: "platform-1" }));
      const payload = base64url(JSON.stringify(auth.claims));
      const secret = String(platformKey.publicJwk.n);
      const hmac = createHmac("sha256", secret)
        .update(`${header("HS256")}.${payload}`)
        .digest("base64url");
      const forged = [
        ["none", `${header("none")}.${payload}.`],
        ["HS256 with the modulus of the public key as the secret", `${header("HS256")}.${payload}.${hmac}`],
        ["HS512", `${header("HS512")}.${payload}.${hmac}`],
        ["PS256", signToken(auth.claims, platformKey, { alg: "PS256" })],
        ["EdDSA", `${header("EdDSA")}.${payload}.${hmac}`],
        ["ES256K", `${header("ES256K")}.${payload}.${hmac}`],
      ] as const;
      for (const [name, token] of forged) {
        const post = formPost({ id_token: await token, state: auth.state }, { cookie });
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({
          name: "LtiError",
          reason: "algorithm-unsupported",
        });
      }
    });

    it("refuses another spelling of a signature that has the same bytes", async () => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const [header = "", payload = "", signature = ""] = auth.idToken.split(".");
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      // The 256 bytes of an RS256 signature of 2,048 bits end in the middle of the last character: its lowest bit is padding.
      const respelled = `${signature.slice(0, -1)}${alphabet[alphabet.indexOf(signature.at(-1) ?? "A") ^ 1]}`;
      const post = formPost({ id_token: `${header}.${payload}.${respelled}`, state: auth.state }, { cookie });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ name: "LtiError", reason: "token-malformed" });
      expect(launchOf(await ltiLaunch(auth.post({ cookie }), ctx.options)).messageType).toBe("LtiResourceLinkRequest");
    });

    it("refuses a token whose signature is not the platform's", async () => {
      const ctx = setup();
      const forged = await cookieLogin(ctx, { signer: attackerKey });
      await expect(ltiLaunch(forged.request, ctx.options)).rejects.toMatchObject({ reason: "signature-invalid" });
      const tampered = await cookieLogin(ctx);
      const [header = "", , signature = ""] = tampered.auth.idToken.split(".");
      const claims = { ...tampered.auth.claims, sub: "someone-else" };
      const post = formPost(
        { id_token: `${header}.${base64url(JSON.stringify(claims))}.${signature}`, state: tampered.auth.state },
        { cookie: tampered.cookie },
      );
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "signature-invalid" });
    });

    it("refuses a token whose key the platform's key set does not hold", async () => {
      const ctx = setup();
      await expect(
        ltiLaunch((await cookieLogin(ctx, { signer: rotatedKey })).request, ctx.options),
      ).rejects.toMatchObject({ reason: "key-unknown" });
      const noKid = await cookieLogin(ctx, { header: { kid: undefined } });
      await expect(ltiLaunch(noKid.request, ctx.options)).rejects.toMatchObject({ reason: "key-unknown" });
    });

    it("refuses a token signed with a key that cannot verify with RS256, as a key the set does not hold", async () => {
      const ctx = setup();
      const weak = await generateKeyPair("weak", 1024);
      const cases: readonly [string, KeyPair, Record<string, unknown>][] = [
        ["a key of 1,024 bits", weak, weak.publicJwk],
        ["a modulus that is not base64url", platformKey, { ...platformKey.publicJwk, n: "!!" }],
        ["a kid that two keys share", platformKey, platformKey.publicJwk],
      ];
      for (const [name, signer, jwk] of cases) {
        ctx.platform.signer = signer;
        ctx.platform.keySetResponse = () => Response.json({ keys: [jwk, { ...attackerKey.publicJwk, kid: jwk.kid }] });
        const { request: post } = await cookieLogin(ctx);
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({
          name: "LtiError",
          reason: "key-unknown",
        });
        ctx.clock.advance(60);
      }
    });

    it("refuses the launch with key-unknown when what the platform serves as its key set is not a key set", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      for (const body of ["<html>", "[]", '{"keys":{}}', '{"key":[]}', JSON.stringify({ keys: Array(101).fill({}) })]) {
        ctx.platform.keySetResponse = () => new Response(body);
        await expect(ltiLaunch(post, ctx.options), body).rejects.toMatchObject({
          name: "LtiError",
          reason: "key-unknown",
          status: 401,
        });
        ctx.clock.advance(60);
      }
    });

    it("accepts a token signed with a key that the platform added by rotation", async () => {
      const ctx = setup();
      launchOf(await ltiLaunch((await cookieLogin(ctx)).request, ctx.options));
      ctx.platform.published = [rotatedKey, platformKey];
      ctx.platform.signer = rotatedKey;
      ctx.clock.advance(60);
      const { request: post } = await cookieLogin(ctx);
      expect(launchOf(await ltiLaunch(post, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
      expect(ctx.platform.requests).toHaveLength(2);
    });

    it("refuses a token with a critical header, which names extensions the tool does not support", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { header: { crit: ["exp"] } });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "token-malformed" });
    });

    it("refuses a token that is not a JWT", async () => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const [header = "", payload = "", signature = ""] = auth.idToken.split(".");
      const tokens = [
        "not-a-jwt",
        `${header}.${payload}`,
        `${header}.${payload}.${signature}.extra`,
        `!!!.${payload}.${signature}`,
        `${header}.${payload}.!!!`,
        `${base64url("not json")}.${payload}.${signature}`,
        `${header}.${base64url("[1]")}.${signature}`,
        `${header}.${base64url("null")}.${signature}`,
        `${base64url(new Uint8Array([0xff, 0xfe]).buffer)}.${payload}.${signature}`,
      ];
      for (const token of tokens) {
        const post = formPost({ id_token: token, state: auth.state }, { cookie });
        await expect(ltiLaunch(post, ctx.options), token).rejects.toMatchObject({
          name: "LtiError",
          reason: "token-malformed",
        });
      }
    });

    it("refuses a token of another issuer", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { claims: { iss: "https://evil.example" } });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "issuer-mismatch" });
    });

    it("refuses a token whose audience is not the tool alone", async () => {
      const ctx = setup();
      const audiences: readonly unknown[] = ["another-client", ["another-client"], [], undefined, 5];
      for (const aud of audiences) {
        const { request: post } = await cookieLogin(ctx, { claims: { aud } });
        await expect(ltiLaunch(post, ctx.options), JSON.stringify(aud)).rejects.toMatchObject({
          reason: "audience-mismatch",
        });
      }
      const untrusted = await cookieLogin(ctx, { claims: { aud: [CLIENT_ID, "another-client"] } });
      await expect(ltiLaunch(untrusted.request, ctx.options)).rejects.toMatchObject({ reason: "audience-untrusted" });
      const sole = await cookieLogin(ctx, { claims: { aud: [CLIENT_ID, CLIENT_ID] } });
      expect(launchOf(await ltiLaunch(sole.request, ctx.options)).clientId).toBe(CLIENT_ID);
    });

    it("refuses a token whose authorized party is not the tool", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { claims: { azp: "another-client" } });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "authorized-party-mismatch" });
      const invalid = await cookieLogin(ctx, { claims: { azp: 5 } });
      await expect(ltiLaunch(invalid.request, ctx.options)).rejects.toMatchObject({ reason: "claim-invalid" });
    });

    it("refuses a token at its expiry, allowing a minute of clock skew", async () => {
      const ctx = setup();
      const inSkew = await cookieLogin(ctx, { claims: { exp: SECONDS - 59 } });
      expect(launchOf(await ltiLaunch(inSkew.request, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
      const expired = await cookieLogin(ctx, { claims: { exp: SECONDS - 60 } });
      await expect(ltiLaunch(expired.request, ctx.options)).rejects.toMatchObject({ reason: "token-expired" });
    });

    it("refuses a token issued in the future, allowing a minute of clock skew", async () => {
      const ctx = setup();
      const inSkew = await cookieLogin(ctx, { claims: { iat: SECONDS + 60 } });
      expect(launchOf(await ltiLaunch(inSkew.request, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
      const future = await cookieLogin(ctx, { claims: { iat: SECONDS + 61 } });
      await expect(ltiLaunch(future.request, ctx.options)).rejects.toMatchObject({ reason: "issued-in-future" });
    });

    it("refuses a token without a valid exp, iat, nonce or sub", async () => {
      const ctx = setup();
      const cases: readonly [string, Record<string, unknown>, string][] = [
        ["exp", { exp: undefined }, "claim-missing"],
        ["exp as a string", { exp: "1700000300" }, "claim-invalid"],
        ["iat", { iat: undefined }, "claim-missing"],
        ["iat as null", { iat: null }, "claim-invalid"],
        ["nonce", { nonce: undefined }, "claim-missing"],
        ["nonce as a number", { nonce: 5 }, "claim-invalid"],
        ["sub of 256 characters", { sub: "u".repeat(256) }, "claim-invalid"],
        ["empty sub", { sub: "" }, "claim-invalid"],
      ];
      for (const [name, claims, reason] of cases) {
        const { request: post } = await cookieLogin(ctx, { claims });
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({ name: "LtiError", reason });
      }
    });

    it("refuses a token whose nonce is not the login's", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx, { claims: { nonce: "another-nonce" } });
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "nonce-mismatch" });
    });

    it("refuses a message that is not a launch of this tool", async () => {
      const ctx = setup();
      const claim = "https://purl.imsglobal.org/spec/lti/claim/";
      const cases: readonly [string, Record<string, unknown>, string][] = [
        ["another deployment", { [`${claim}deployment_id`]: "other" }, "deployment-unknown"],
        ["no deployment", { [`${claim}deployment_id`]: undefined }, "claim-missing"],
        ["a long deployment", { [`${claim}deployment_id`]: "d".repeat(256) }, "claim-invalid"],
        [
          "another message type",
          { [`${claim}message_type`]: "LtiAssetProcessorSettingsRequest" },
          "message-type-unsupported",
        ],
        ["no message type", { [`${claim}message_type`]: undefined }, "claim-missing"],
        ["another version", { [`${claim}version`]: "1.2.0" }, "version-unsupported"],
        ["roles that are not an array", { [`${claim}roles`]: "Learner" }, "claim-invalid"],
        ["no roles", { [`${claim}roles`]: undefined }, "claim-missing"],
        ["an http target link", { [`${claim}target_link_uri`]: "http://tool.example/t" }, "claim-invalid"],
        ["no target link", { [`${claim}target_link_uri`]: undefined }, "claim-missing"],
        ["no resource link", { [`${claim}resource_link`]: undefined }, "claim-missing"],
        ["a resource link without an id", { [`${claim}resource_link`]: {} }, "claim-missing"],
        ["a long resource link id", { [`${claim}resource_link`]: { id: "r".repeat(256) } }, "claim-invalid"],
        ["custom values that are not text, numbers or booleans", { [`${claim}custom`]: { a: null } }, "claim-invalid"],
        [
          "a grade services endpoint that is http",
          { "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": { lineitem: "http://lms.example/l" } },
          "claim-invalid",
        ],
      ];
      for (const [name, claims, reason] of cases) {
        const { request: post } = await cookieLogin(ctx, { claims });
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({ name: "LtiError", reason });
      }
    });

    it("refuses a Deep Linking request without valid settings", async () => {
      const ctx = setup();
      const settings = "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings";
      const TARGETS = { accept_presentation_document_targets: ["iframe"] };
      const cases: readonly [string, unknown, string][] = [
        ["none", undefined, "claim-missing"],
        [
          "a return URL that is http",
          { deep_link_return_url: "http://lms.example/r", accept_types: [], ...TARGETS },
          "claim-invalid",
        ],
        ["no return URL", { accept_types: [], ...TARGETS }, "claim-missing"],
        ["no accepted types", { deep_link_return_url: RETURN_URL, ...TARGETS }, "claim-missing"],
        ["no document targets", { deep_link_return_url: RETURN_URL, accept_types: [] }, "claim-missing"],
        [
          "multiple as a string",
          { deep_link_return_url: RETURN_URL, accept_types: [], ...TARGETS, accept_multiple: "yes" },
          "claim-invalid",
        ],
      ];
      for (const [name, value, reason] of cases) {
        const { request: post } = await cookieLogin(ctx, { message: "deep-linking", claims: { [settings]: value } });
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({ reason });
      }
    });

    it("refuses a launch of a platform that the tool no longer has", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      const options: Options = { ...ctx.options, registration: async () => undefined };
      await expect(ltiLaunch(post, options)).rejects.toMatchObject({ reason: "platform-unknown" });
    });

    it("refuses an LTI 1.1 launch, which is an OAuth 1.0a form without an id_token", async () => {
      const ctx = setup();
      const legacy = formPost({
        oauth_consumer_key: "key",
        oauth_signature: "x",
        lti_message_type: "basic-lti-launch-request",
        lti_version: "LTI-1p0",
        resource_link_id: "r1",
      });
      await expect(ltiLaunch(legacy, ctx.options)).rejects.toMatchObject({
        name: "LtiError",
        reason: "legacy-launch",
      });
    });

    it("throws DataError for a request that is not a launch", async () => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const form = { "content-type": "application/x-www-form-urlencoded" };
      const cases: readonly [string, HttpRequest][] = [
        ['A launch must be a POST request, found "GET".', { ...auth.post({ cookie }), method: "GET" }],
        [
          'The content type of the request must be application/x-www-form-urlencoded, found "application/json".',
          { ...auth.post({ cookie }), headers: { "content-type": "application/json", cookie } },
        ],
        [
          "The content type of the request must be application/x-www-form-urlencoded, found undefined.",
          { ...auth.post(), headers: {} },
        ],
        [
          'The launch must have the form parameter "id_token", found undefined.',
          request({ method: "POST", url: REDIRECT_URI, headers: form, body: `state=${auth.state}` }),
        ],
        [
          'The launch must have the form parameter "state", found "".',
          request({ method: "POST", url: REDIRECT_URI, headers: form, body: `id_token=${auth.idToken}&state=` }),
        ],
        [
          'The form of the request has the parameter "state" more than once.',
          request({ method: "POST", url: REDIRECT_URI, headers: form, body: `id_token=a&state=${auth.state}&state=x` }),
        ],
      ];
      for (const [message, post] of cases)
        await expect(ltiLaunch(post, ctx.options), message).rejects.toThrow(new DataError(message));
    });

    it("throws DataError for a request and options of other types", async () => {
      const ctx = setup();
      const { request: post } = await cookieLogin(ctx);
      const cases: readonly [string, () => Promise<unknown>][] = [
        ["The request must be an object, found null.", () => ltiLaunch(JSON.parse("null"), ctx.options)],
        [
          "The URL of the request must be a string, found 5.",
          () => ltiLaunch({ ...post, url: JSON.parse("5") }, ctx.options),
        ],
        [
          'The URL of the request must be an absolute URL, found "/lti/launch".',
          () => ltiLaunch({ ...post, url: "/lti/launch" }, ctx.options),
        ],
        [
          "The body of the request must be a Uint8Array, found null: encode text with a TextEncoder.",
          () => ltiLaunch({ ...post, body: JSON.parse("null") }, ctx.options),
        ],
        [
          "The body of the request must be a Uint8Array, found a string: encode text with a TextEncoder.",
          () => ltiLaunch({ ...post, body: JSON.parse('"id_token=a"') }, ctx.options),
        ],
        [
          "The headers of the request must be an object, found an array.",
          () => ltiLaunch({ ...post, headers: JSON.parse("[]") }, ctx.options),
        ],
        [
          'The header "cookie" of the request must be a string, found 5.',
          () => ltiLaunch({ ...post, headers: JSON.parse('{"cookie":5}') }, ctx.options),
        ],
        [
          'The header names of the request must be in lower case, found "Cookie".',
          () => ltiLaunch({ ...post, headers: { Cookie: "a=b" } }, ctx.options),
        ],
        ["The options must be an object, found null.", () => ltiLaunch(post, JSON.parse("null"))],
        [
          "The option registration must be a function, found null.",
          () => ltiLaunch(post, { ...ctx.options, registration: JSON.parse("null") }),
        ],
        [
          "The option store is invalid: expected an object with the functions put, get and delete, found null.",
          () => ltiLaunch(post, { ...ctx.options, store: JSON.parse("null") }),
        ],
        [
          "The option store is invalid: expected an object with the functions put, get and delete, found an object.",
          () =>
            ltiLaunch(post, {
              ...ctx.options,
              store: { put: ctx.store.put, get: ctx.store.get, delete: JSON.parse("null") },
            }),
        ],
        [
          "The option jwks must be an object, found null.",
          () => ltiLaunch(post, { ...ctx.options, jwks: JSON.parse("null") }),
        ],
      ];
      for (const [message, call] of cases) await expect(call(), message).rejects.toThrow(new DataError(message));
    });

    it("throws DataError when the store returns a login that is not one, or the lookup a registration that is not one", async () => {
      const ctx = setup();
      const { request: post, auth } = await cookieLogin(ctx);
      const record = ctx.store.records.get(auth.state);
      const store = {
        put: ctx.store.put.bind(ctx.store),
        delete: ctx.store.delete.bind(ctx.store),
        get: async () => JSON.parse(JSON.stringify({ ...record, nonce: 5 })),
      };
      await expect(ltiLaunch(post, { ...ctx.options, store })).rejects.toThrow(
        new DataError("The login record is invalid at nonce: expected a string, found 5."),
      );
      const http = { ...ctx.registration, jwksUrl: "http://lms.example.edu/jwks" };
      await expect(ltiLaunch(post, { ...ctx.options, registration: async () => http })).rejects.toThrow(
        new DataError(
          'The registration is invalid at jwksUrl: expected an absolute https URL, found "http://lms.example.edu/jwks".',
        ),
      );
      const other = { ...ctx.registration, issuer: "https://other.example" };
      await expect(ltiLaunch(post, { ...ctx.options, registration: async () => other })).rejects.toMatchObject({
        reason: "platform-unknown",
      });
    });
  });

  describe("on the client-side storage path", () => {
    it("answers the post of the platform with a page that fetches the values from the platform's storage", async () => {
      const ctx = setup();
      const { auth, config, response } = await storageLogin(ctx);
      const page = await ltiLaunch(auth.post(), ctx.options);
      expect("status" in page).toBe(true);
      const view = readPage(page as HttpResponse);
      expect(view.config).toEqual({
        subject: "lti.get_data",
        frame: "lti-storage",
        state: auth.state,
        nonce: config.nonce,
        origin: ISSUER,
        stateField: "stored_state",
        nonceField: "stored_nonce",
        timeoutMs: 10_000,
        capabilitiesTimeoutMs: 100,
      });
      expect(Object.fromEntries(view.inputs)).toEqual({
        id_token: auth.idToken,
        state: auth.state,
        stored_state: "",
        stored_nonce: "",
      });
      expect(view.action).toBe(REDIRECT_URI);
      expect(ctx.store.records.has(auth.state)).toBe(true);
      expect(response.headers["set-cookie"]).toContain(`__Host-lti_state_${auth.state}=${auth.state};`);
      expect(page).not.toHaveProperty(["headers", "set-cookie"]);
    });

    it("sends the verification page with a CSP that names its script and nothing else, and a referrer to its own origin alone", async () => {
      const ctx = setup();
      const { auth } = await storageLogin(ctx);
      const page = (await ltiLaunch(auth.post(), ctx.options)) as HttpResponse;
      const view = readPage(page);
      expect(page).toMatchObject({ status: 200 });
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(page.headers["cache-control"]).toBe("no-store");
      expect(page.headers["x-content-type-options"]).toBe("nosniff");
      // Under no-referrer a browser posts the form with `Origin: null`, and the launch refuses the post as origin-mismatch.
      expect(page.headers["referrer-policy"]).toBe("same-origin");
      expect(page.headers["content-security-policy"]).toBe(
        `default-src 'none'; script-src 'sha256-${view.hash}'; base-uri 'none'; form-action 'self'`,
      );
      expect(view.scripts).toBe(1);
    });

    it("writes the token and the state into the page as text, whatever they hold", async () => {
      const ctx = setup();
      const { auth } = await storageLogin(ctx);
      const hostile = `"><script>alert('x')</script>&amp;`;
      const post = formPost({ id_token: hostile, state: auth.state });
      const view = readPage((await ltiLaunch(post, ctx.options)) as HttpResponse);
      expect(view.scripts).toBe(1);
      expect(view.inputs.get("id_token")).toBe(hostile);
    });

    it("completes the launch when the platform's storage returns the values of the login", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      const launch = launchOf(await ltiLaunch(verificationPost(auth, storage), ctx.options));
      expect(launch).toMatchObject({
        messageType: "LtiResourceLinkRequest",
        user: { subject: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a" },
      });
      expect(ctx.store.records.size).toBe(0);
    });

    it("completes the launch by the state cookie when the browser kept it, with no verification page", async () => {
      const ctx = setup();
      const { auth, response } = await storageLogin(ctx);
      const post = auth.post({ cookie: cookieOf(response.headers["set-cookie"]) });
      expect(launchOf(await ltiLaunch(post, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
      expect(ctx.store.records.size).toBe(0);
    });

    it("falls back to the platform's storage when the cookie is another login's", async () => {
      const ctx = setup();
      const first = await storageLogin(ctx);
      const second = await storageLogin(ctx);
      const page = await ltiLaunch(
        second.auth.post({ cookie: cookieOf(first.response.headers["set-cookie"]) }),
        ctx.options,
      );
      expect(readPage(page as HttpResponse).config.state).toBe(second.auth.state);
      expect(launchOf(await ltiLaunch(verificationPost(second.auth, second.storage), ctx.options)).messageType).toBe(
        "LtiResourceLinkRequest",
      );
    });

    it("completes the launch without any cookie", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      const post = verificationPost(auth, storage);
      expect(post.headers.cookie).toBeUndefined();
      expect(launchOf(await ltiLaunch(post, ctx.options)).messageType).toBe("LtiResourceLinkRequest");
    });

    it("completes a login once", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      launchOf(await ltiLaunch(verificationPost(auth, storage), ctx.options));
      await expect(ltiLaunch(verificationPost(auth, storage), ctx.options)).rejects.toMatchObject({
        reason: "state-unknown",
      });
    });

    it("refuses a post of the verification that does not come from the tool's own origin", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      const foreign: readonly Record<string, string>[] = [
        {},
        { origin: ISSUER },
        { origin: "https://evil.example" },
        { origin: "null" },
        { origin: `${TOOL_ORIGIN}/` },
      ];
      for (const headers of foreign) {
        await expect(
          ltiLaunch(verificationPost(auth, storage, headers), ctx.options),
          JSON.stringify(headers),
        ).rejects.toMatchObject({
          name: "LtiError",
          reason: "origin-mismatch",
        });
      }
    });

    it("refuses values from the platform's storage that are not the login's", async () => {
      const ctx = setup();
      const { auth, storage } = await storageLogin(ctx);
      const fields = { id_token: auth.idToken, state: auth.state };
      const origin = { origin: TOOL_ORIGIN };
      const posts: readonly [string, HttpRequest][] = [
        ["another state", formPost({ ...fields, stored_state: "other", stored_nonce: auth.nonce }, origin)],
        ["another nonce", formPost({ ...fields, stored_state: auth.state, stored_nonce: "other" }, origin)],
        ["no nonce", formPost({ ...fields, stored_state: auth.state }, origin)],
        ["no state", formPost({ ...fields, stored_nonce: auth.nonce }, origin)],
        ["empty values", formPost({ ...fields, stored_state: "", stored_nonce: "" }, origin)],
        [
          "the state for the nonce",
          formPost({ ...fields, stored_state: auth.state, stored_nonce: auth.state }, origin),
        ],
      ];
      for (const [name, post] of posts) {
        await expect(ltiLaunch(post, ctx.options), name).rejects.toMatchObject({
          name: "LtiError",
          reason: "storage-mismatch",
        });
      }
      expect(launchOf(await ltiLaunch(verificationPost(auth, storage), ctx.options)).messageType).toBe(
        "LtiResourceLinkRequest",
      );
    });

    it("checks the token on this path as on the cookie path", async () => {
      const ctx = setup();
      const forged = await storageLogin(ctx, { signer: attackerKey });
      await expect(ltiLaunch(verificationPost(forged.auth, forged.storage), ctx.options)).rejects.toMatchObject({
        reason: "signature-invalid",
      });
      const wrongNonce = await storageLogin(ctx, { claims: { nonce: "another" } });
      await expect(ltiLaunch(verificationPost(wrongNonce.auth, wrongNonce.storage), ctx.options)).rejects.toMatchObject(
        {
          reason: "nonce-mismatch",
        },
      );
    });

    it("does not let the values of the storage stand in for the cookie of a login that used a cookie", async () => {
      const ctx = setup();
      const { auth } = await cookieLogin(ctx);
      const post = formPost(
        { id_token: auth.idToken, state: auth.state, stored_state: auth.state, stored_nonce: auth.nonce },
        { origin: TOOL_ORIGIN },
      );
      await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "state-cookie" });
    });
  });
});

describe("ltiLogin", () => {
  it("answers the initiation with the authentication request and a state cookie", async () => {
    const ctx = setup();
    const response = await ltiLogin(ctx.platform.initiation(), ctx.options);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.location ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(AUTHENTICATION_URL);
    expect([...location.searchParams.keys()]).toEqual([
      "scope",
      "response_type",
      "client_id",
      "redirect_uri",
      "login_hint",
      "state",
      "response_mode",
      "nonce",
      "prompt",
      "lti_message_hint",
    ]);
    const state = location.searchParams.get("state") ?? "";
    const nonce = location.searchParams.get("nonce") ?? "";
    expect(response.headers["set-cookie"]).toBe(
      `__Host-lti_state_${state}=${state}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=None`,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe("");
    expect(state).not.toBe(nonce);
    expect(ctx.store.records.get(state)).toEqual({
      nonce,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      deploymentId: DEPLOYMENT_ID,
      targetLinkUri: TARGET_LINK_URI,
      storageTarget: undefined,
      expiresAt: NOW + 600_000,
    });
  });

  it("returns lti_message_hint unaltered and accepts the initiation as a POST", async () => {
    const ctx = setup();
    const hint = "a b&c=d/é?";
    for (const method of ["GET", "POST"] as const) {
      const response = await ltiLogin(ctx.platform.initiation({ method, messageHint: hint }), ctx.options);
      expect(new URL(response.headers.location ?? "").searchParams.get("lti_message_hint"), method).toBe(hint);
    }
  });

  it("leaves out lti_message_hint when the platform sends none", async () => {
    const ctx = setup();
    const initiation = request({
      url: `${LOGIN_URL}?iss=${encodeURIComponent(ISSUER)}&login_hint=1&target_link_uri=${encodeURIComponent(TARGET_LINK_URI)}`,
    });
    const response = await ltiLogin(initiation, ctx.options);
    expect(new URL(response.headers.location ?? "").searchParams.has("lti_message_hint")).toBe(false);
  });

  it("looks up the registration by the issuer, and the client when the platform names one", async () => {
    const ctx = setup();
    await ltiLogin(ctx.platform.initiation(), ctx.options);
    await ltiLogin(ctx.platform.initiation({ clientId: true }), ctx.options);
    expect(ctx.lookups).toEqual([`${ISSUER} undefined`, `${ISSUER} ${CLIENT_ID}`]);
  });

  it("gives each login its own state and nonce", async () => {
    const ctx = setup();
    const locations = await Promise.all(
      Array.from({ length: 20 }, async () => (await ltiLogin(ctx.platform.initiation(), ctx.options)).headers.location),
    );
    const params = locations.map((location) => new URL(location ?? "").searchParams);
    expect(new Set(params.map((p) => p.get("state"))).size).toBe(20);
    expect(new Set(params.map((p) => p.get("nonce"))).size).toBe(20);
    expect(ctx.store.records.size).toBe(20);
  });

  it("keeps a query that the authentication endpoint already has", async () => {
    const ctx = setup({ authenticationUrl: `${AUTHENTICATION_URL}?tenant=7` });
    const response = await ltiLogin(ctx.platform.initiation(), ctx.options);
    const location = new URL(response.headers.location ?? "");
    expect(location.searchParams.get("tenant")).toBe("7");
    expect(location.searchParams.get("scope")).toBe("openid");
  });

  it("answers an initiation with lti_storage_target with a page that stores state and nonce in the platform, and the state cookie", async () => {
    const ctx = setup();
    const response = await ltiLogin(ctx.platform.initiation({ storageTarget: "_parent" }), ctx.options);
    expect(response.status).toBe(200);
    const view = readPage(response);
    const request = new URL(view.config.authenticationRequest ?? "");
    const state = request.searchParams.get("state");
    expect(response.headers["set-cookie"]).toBe(
      `__Host-lti_state_${state}=${state}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=None`,
    );
    expect(view.config).toEqual({
      subject: "lti.put_data",
      frame: "_parent",
      state: request.searchParams.get("state"),
      nonce: request.searchParams.get("nonce"),
      origin: ISSUER,
      authenticationRequest: request.href,
      timeoutMs: 10_000,
      capabilitiesTimeoutMs: 100,
    });
    expect(`${request.origin}${request.pathname}`).toBe(AUTHENTICATION_URL);
    expect(ctx.store.records.get(view.config.state ?? "")).toEqual({
      nonce: view.config.nonce,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      deploymentId: DEPLOYMENT_ID,
      targetLinkUri: TARGET_LINK_URI,
      storageTarget: "_parent",
      expiresAt: NOW + 600_000,
    });
  });

  it("sends the storage page with a CSP that names its script and nothing else", async () => {
    const ctx = setup();
    const response = await ltiLogin(ctx.platform.initiation({ storageTarget: "frame" }), ctx.options);
    const view = readPage(response);
    expect(response.headers["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${view.hash}'; base-uri 'none'; form-action 'self'`,
    );
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(view.scripts).toBe(1);
  });

  it("writes the name of the target frame into the page as text, whatever it holds", async () => {
    const ctx = setup();
    const hostile = `"><script>alert(1)</script>'&`;
    const response = await ltiLogin(ctx.platform.initiation({ storageTarget: hostile }), ctx.options);
    const view = readPage(response);
    expect(view.scripts).toBe(1);
    expect(view.config.frame).toBe(hostile);
  });

  it("throws LtiError when the tool has no registration for the platform", async () => {
    const ctx = setup();
    const initiation = request({
      url: `${LOGIN_URL}?iss=${encodeURIComponent("https://unknown.example")}&login_hint=1&target_link_uri=${encodeURIComponent(TARGET_LINK_URI)}`,
    });
    await expect(ltiLogin(initiation, ctx.options)).rejects.toMatchObject({
      name: "LtiError",
      reason: "platform-unknown",
    });
    expect(ctx.store.records.size).toBe(0);
    const other = request({
      url: `${LOGIN_URL}?iss=${encodeURIComponent(ISSUER)}&client_id=other&login_hint=1&target_link_uri=${encodeURIComponent(TARGET_LINK_URI)}`,
    });
    await expect(ltiLogin(other, ctx.options)).rejects.toMatchObject({ reason: "platform-unknown" });
    const mismatch = { ...ctx.options, registration: async () => ({ ...ctx.registration, clientId: "another" }) };
    await expect(ltiLogin(ctx.platform.initiation({ clientId: true }), mismatch)).rejects.toMatchObject({
      reason: "platform-unknown",
    });
  });

  it("throws DataError for an initiation that lacks a parameter or repeats one", async () => {
    const ctx = setup();
    const query = (text: string): HttpRequest => request({ url: `${LOGIN_URL}?${text}` });
    const hint = `iss=${encodeURIComponent(ISSUER)}&login_hint=1&target_link_uri=${encodeURIComponent(TARGET_LINK_URI)}`;
    const cases: readonly [string, HttpRequest][] = [
      [
        'The login initiation must have the parameter "iss", found undefined.',
        query("login_hint=1&target_link_uri=https%3A%2F%2Ft.example"),
      ],
      [
        'The login initiation must have the parameter "login_hint", found undefined.',
        query(`iss=${encodeURIComponent(ISSUER)}&target_link_uri=https%3A%2F%2Ft.example`),
      ],
      [
        'The login initiation must have the parameter "target_link_uri", found undefined.',
        query(`iss=${encodeURIComponent(ISSUER)}&login_hint=1`),
      ],
      [
        'The login initiation must have the parameter "iss", found "".',
        query("iss=&login_hint=1&target_link_uri=https%3A%2F%2Ft.example"),
      ],
      [
        'The login initiation must have the parameter "lti_storage_target", found "".',
        query(`${hint}&lti_storage_target=`),
      ],
      ['The login initiation must have the parameter "client_id", found "".', query(`${hint}&client_id=`)],
      ['The query of the request has the parameter "login_hint" more than once.', query(`${hint}&login_hint=2`)],
      ['A login initiation must be a GET or a POST request, found "PUT".', { ...query(hint), method: "PUT" }],
      [
        'The content type of the request must be application/x-www-form-urlencoded, found "text/plain".',
        request({ method: "POST", url: LOGIN_URL, headers: { "content-type": "text/plain" }, body: hint }),
      ],
    ];
    for (const [message, initiation] of cases)
      await expect(ltiLogin(initiation, ctx.options), message).rejects.toThrow(new DataError(message));
  });

  it("throws DataError for a request and options of other types", async () => {
    const ctx = setup();
    const initiation = ctx.platform.initiation();
    const cases: readonly [string, () => Promise<unknown>][] = [
      ['The request must be an object, found "GET".', () => ltiLogin(JSON.parse('"GET"'), ctx.options)],
      [
        "The method of the request must be a string, found 5.",
        () => ltiLogin({ ...initiation, method: JSON.parse("5") }, ctx.options),
      ],
      ["The options must be an object, found null.", () => ltiLogin(initiation, JSON.parse("null"))],
      [
        'The option registration must be a function, found "r".',
        () => ltiLogin(initiation, { ...ctx.options, registration: JSON.parse('"r"') }),
      ],
      [
        "The option clock must be an object, found 5.",
        () => ltiLogin(initiation, { ...ctx.options, clock: JSON.parse("5") }),
      ],
      [
        "The option store is invalid: expected an object with the functions put, get and delete, found null.",
        () =>
          ltiLogin(initiation, {
            registration: ctx.options.registration,
            clock: ctx.clock,
            store: JSON.parse("null"),
          }),
      ],
    ];
    for (const [message, call] of cases) await expect(call(), message).rejects.toThrow(new DataError(message));
  });

  it("throws DataError when the registration is not one", async () => {
    const ctx = setup();
    const { registration } = ctx;
    const { signer } = registration;
    const bad: readonly [string, PlatformRegistration][] = [
      ["The registration is invalid: expected an object, found null.", JSON.parse("null")],
      [
        'The registration is invalid at issuer: expected an absolute https URL, found "http://lms.example.edu".',
        { ...registration, issuer: "http://lms.example.edu" },
      ],
      [
        'The registration is invalid at issuer: expected an issuer without a query or a fragment, found "https://lms.example.edu/?a=1".',
        { ...registration, issuer: `${ISSUER}/?a=1` },
      ],
      [
        "The registration is invalid at clientId: expected a length of at least 1, found 0.",
        { ...registration, clientId: "" },
      ],
      [
        "The registration is invalid at deploymentIds: expected a length of at least 1, found 0.",
        { ...registration, deploymentIds: [] },
      ],
      [
        "The registration is invalid at deploymentIds[0]: expected a string, found 5.",
        { ...registration, deploymentIds: [JSON.parse("5")] },
      ],
      [
        'The registration is invalid at authenticationUrl: expected an absolute https URL, found "/auth".',
        { ...registration, authenticationUrl: "/auth" },
      ],
      [
        "The registration is invalid at accessTokenUrl: expected a string, found 5.",
        { ...registration, accessTokenUrl: JSON.parse("5") },
      ],
      [
        'The registration is invalid at redirectUri: expected an absolute https URL, found "http://tool.example/l".',
        { ...registration, redirectUri: "http://tool.example/l" },
      ],
      [
        'The registration is invalid at algorithms[0]: expected "RS256", "RS384", "RS512", "ES256", "ES384" or "ES512", found "HS256".',
        { ...registration, algorithms: JSON.parse('["HS256"]') },
      ],
      [
        "The registration is invalid at algorithms: expected a length of at least 1, found 0.",
        { ...registration, algorithms: [] },
      ],
      [
        "The registration is invalid at trustedAudiences[0]: expected a length of at least 1, found 0.",
        { ...registration, trustedAudiences: [""] },
      ],
      [
        'The registration is invalid at serviceOrigins[0]: expected an https origin such as "https://lms.example.edu", found "https://lms.example.edu/api".',
        { ...registration, serviceOrigins: ["https://lms.example.edu/api"] },
      ],
      [
        'The registration is invalid at serviceOrigins[0]: expected an absolute https URL, found "http://lms.example.edu".',
        { ...registration, serviceOrigins: ["http://lms.example.edu"] },
      ],
      [
        "The signer of the registration must be an object, found null.",
        { ...registration, signer: JSON.parse("null") },
      ],
      [
        'The algorithm of the signer of the registration must be one of RS256, RS384, RS512, ES256, ES384, ES512 (Security Framework section 7.2), found "PS256".',
        { ...registration, signer: { ...signer, algorithm: "PS256" } },
      ],
      [
        "The signer of the registration must have a function sign.",
        { ...registration, signer: JSON.parse('{"algorithm":"RS256","keyId":"tool-1"}') },
      ],
      [
        "The keyId of the signer of the registration must be a non-empty string, found undefined.",
        { ...registration, signer: { algorithm: "RS256", sign: signer.sign } },
      ],
    ];
    for (const [message, found] of bad) {
      const options = { ...ctx.options, registration: async () => found };
      await expect(ltiLogin(ctx.platform.initiation(), options), message).rejects.toThrow(new DataError(message));
    }
  });
});

describe("properties", () => {
  it("makes tokens of 160 random bits in base64url that do not repeat", () => {
    const tokens = Array.from({ length: 500 }, () => randomToken());
    expect(new Set(tokens).size).toBe(500);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{27}$/u);
  });

  it("puts any frame name into the storage page as text that decodes to the name", async () => {
    const ctx = setup();
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 60, unit: "binary" }), async (name) => {
        const response = await ltiLogin(ctx.platform.initiation({ storageTarget: name }), ctx.options);
        const view = readPage(response);
        expect(view.config.frame).toBe(name);
        expect(view.scripts).toBe(1);
        expect(view.inputs.size).toBe(0);
      }),
      { numRuns: 60 },
    );
  });
});

describe("the verification page", () => {
  it("writes the redirect URI and the token as text in the form, whatever they hold", async () => {
    const hostile = `x"><img src="https://stranger.example/leak"><script>alert(1)</script>'`;
    const page = await getDataPage({
      frame: "_parent",
      state: hostile,
      nonce: hostile,
      authenticationUrl: "https://lms.example.edu/auth",
      redirectUri: `https://tool.example.com/l${hostile}`,
      idToken: hostile,
    });
    const encoded =
      "x&quot;&gt;&lt;img src=&quot;https://stranger.example/leak&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&#39;";
    expect(page.body).toContain(`action="https://tool.example.com/l${encoded}"`);
    expect(page.body).toContain(`name="id_token" value="${encoded}"`);
    expect(page.body).not.toContain("<img");
    expect(textOf(page.body).match(/<script>/gu)).toHaveLength(1);
  });
});
