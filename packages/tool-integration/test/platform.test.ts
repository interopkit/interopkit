// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.

import { DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createJwksCache, LtiError, type LtiErrorReason } from "../src/index.js";
import {
  buildCapabilitiesScript,
  buildPlatformEndpoints,
  handlePlatformRequest,
  type LaunchToCheck,
  type MessageInput,
  type PlatformConfig,
  prepareToolFrame,
  prepareToolLaunch,
} from "../src/platform/index.js";
import { LAUNCH_TTL_SECONDS, openHint, openToken, sealHint } from "../src/platform/internal.js";
import { readMessage, verifyMigration } from "../src/protocol/internal.js";
import { handleLaunch, handleLogin, type PlatformRegistration } from "../src/tool/index.js";
import { cookieOf, MemoryStore } from "./fake-platform.js";
import {
  authenticationRequest,
  clientAssertion,
  ecAssertion,
  TOOL_CLIENT_ID,
  TOOL_DEPLOYMENT_ID,
  TOOL_LAUNCH_URL,
  TOOL_ORIGIN,
  TOOL_REDIRECT_URI,
  tokenRequest,
  toolRegistration,
} from "./fake-tool.js";
import { NOW, readPost, readToken, request } from "./fixture.js";
import { MemoryGradebook } from "./gradebook.js";
import {
  ASSET_ORIGIN,
  attackerKeys,
  authorize,
  baseFields,
  baseMessage,
  begin,
  CLAIM,
  config,
  endpoints,
  handle,
  hintKey,
  ISSUER,
  LEARNER,
  launch,
  OTHER_CLIENT_ID,
  OTHER_LAUNCH_URL,
  otherToolKey,
  PLATFORM_ORIGIN,
  PLAYER_ORIGIN,
  platformKeys,
  previousHintKey,
  type Setup,
  setup,
  toolKeys,
} from "./platform-setup.js";
import { textOf } from "./text-of.js";

const SECONDS = NOW / 1000;
const DL = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const AP = "https://purl.imsglobal.org/spec/lti-ap/claim/";
const MENTOR = "http://purl.imsglobal.org/vocab/lis/v2/membership#Mentor";

/** Reads the claims of an `id_token` into the model, as the tool role does. */
function modelOf(claims: Record<string, unknown>) {
  return readMessage(claims, { issuer: ISSUER, clientId: TOOL_CLIENT_ID, deploymentIds: [TOOL_DEPLOYMENT_ID] });
}

/** The fields of the authentication error response that a page posts, with its status. */
function errorOf(response: HttpResponse): { status: number; error?: string } {
  return { status: response.status, error: readPost(response).fields.get("error") };
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Spells a token otherwise with the same bytes: the last character of a signature of 32 bytes carries two bits that the
 * encoding ignores, and a loose decoder reads both spellings alike.
 */
function otherSpelling(token: string): string {
  const last = BASE64URL.indexOf(token.at(-1) ?? "A");
  return `${token.slice(0, -1)}${BASE64URL[last ^ 1]}`;
}

/** A GET of a path of the platform. */
function get(url: string, method = "GET") {
  return request({ url, method });
}

describe("LtiError", () => {
  it("carries the error that it reports as its cause", () => {
    const cause = new DataError("The form of the request is not one.");
    expect(new LtiError("The request is not valid.", "request-invalid", { cause })).toMatchObject({
      reason: "request-invalid",
      status: 400,
      cause,
    });
    expect("cause" in new LtiError("The request is not valid.", "request-invalid")).toBe(false);
  });
});

describe("buildPlatformEndpoints and the configuration", () => {
  it("gives the URLs of the authorization endpoint, the key set, the token endpoint and the storage page", () => {
    expect(buildPlatformEndpoints(config)).toEqual({
      authorization: `${PLATFORM_ORIGIN}/authorize`,
      jwks: `${PLATFORM_ORIGIN}/jwks`,
      token: `${PLATFORM_ORIGIN}/token`,
      storage: `${PLATFORM_ORIGIN}/storage`,
    });
  });

  it("refuses a configuration in which two of the platform, the frame page and the reserved origins share an origin", () => {
    expect(() => buildPlatformEndpoints({ ...config, frameOrigin: PLATFORM_ORIGIN })).toThrow("must all differ");
    expect(() => buildPlatformEndpoints({ ...config, reservedOrigins: [PLAYER_ORIGIN] })).toThrow("must all differ");
    expect(buildPlatformEndpoints({ ...config, reservedOrigins: [] }).token).toBe(`${PLATFORM_ORIGIN}/token`);
  });

  it("refuses an issuer with a query or a fragment and an origin that is not an https origin", () => {
    expect(() => buildPlatformEndpoints({ ...config, issuer: `${ISSUER}?tenant=1` })).toThrow("query or a fragment");
    expect(() => buildPlatformEndpoints({ ...config, issuer: `${ISSUER}#a` })).toThrow("query or a fragment");
    expect(buildPlatformEndpoints({ ...config, issuer: `${ISSUER}/tenants/1` }).jwks).toBe(`${PLATFORM_ORIGIN}/jwks`);
    expect(() => buildPlatformEndpoints({ ...config, origin: "http://lti.platform.example" })).toThrow(DataError);
    expect(() => buildPlatformEndpoints({ ...config, origin: `${PLATFORM_ORIGIN}/lti` })).toThrow(
      "an origin without a path",
    );
  });

  it("refuses keys that are not a key set, and hint keys that are not HMAC keys of at least 256 bits with SHA-256", async () => {
    const [publicKey] = platformKeys.publicKeys;
    const privateJwk = await crypto.subtle.exportKey("jwk", platformKeys.privateKey);
    expect(() =>
      buildPlatformEndpoints({
        ...config,
        keys: {
          ...config.keys,
          publicKeys: [JSON.parse(JSON.stringify({ ...publicKey, ...privateJwk, kid: "platform-1" }))],
        },
      }),
    ).toThrow("must be a public key");
    expect(() =>
      buildPlatformEndpoints({
        ...config,
        keys: { ...config.keys, publicKeys: [JSON.parse(JSON.stringify({ ...publicKey, kid: "other" }))] },
      }),
    ).toThrow("keyId of the signer must be the kid");
    const short = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 128 }, false, [
      "sign",
      "verify",
    ]);
    const sha1 = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-1" }, false, ["sign", "verify"]);
    expect(() => buildPlatformEndpoints({ ...config, hintKey: short })).toThrow("at least 256 bits");
    expect(() => buildPlatformEndpoints({ ...config, hintKey: sha1 })).toThrow("HMAC key with SHA-256");
    expect(() => buildPlatformEndpoints({ ...config, previousHintKeys: [short] })).toThrow("A previous hint key");
  });

  it("refuses an instance of the platform without a guid of 1 to 255 characters", () => {
    expect(() => buildPlatformEndpoints({ ...config, instance: JSON.parse("{}") })).toThrow("guid");
    expect(() => buildPlatformEndpoints({ ...config, instance: { guid: "g".repeat(256) } })).toThrow("guid");
    expect(buildPlatformEndpoints({ ...config, instance: { guid: "lms-1" } }).token).toBe(endpoints.token);
  });

  it("makes the handler and the login refuse such a configuration", async () => {
    const ctx = setup();
    const broken: PlatformConfig = { ...config, frameOrigin: PLATFORM_ORIGIN };
    await expect(handle(ctx, get(endpoints.jwks), { config: broken })).rejects.toThrow(DataError);
    await expect(prepareToolLaunch(baseMessage, { ...ctx.login, config: broken })).rejects.toThrow(DataError);
  });
});

describe("prepareToolLaunch and prepareToolFrame", () => {
  it("builds the third-party initiated login of the tool with the parameters of LTI 1.3 Core section 4.1", async () => {
    const ctx = setup();
    const { initiation } = await begin(ctx);
    expect(initiation).toMatchObject({
      iss: ISSUER,
      targetLinkUri: TOOL_LAUNCH_URL,
      clientId: TOOL_CLIENT_ID,
      deploymentId: TOOL_DEPLOYMENT_ID,
      storageTarget: "lti-storage",
    });
  });

  it("keeps the message for 300 seconds under a random identifier that the sealed hints name", async () => {
    const ctx = setup();
    const { initiation } = await begin(ctx);
    const [[id, entry] = []] = [...ctx.kept];
    expect(entry?.expiresAt).toBe(NOW + LAUNCH_TTL_SECONDS * 1000);
    expect(entry?.message).toEqual(baseMessage);
    expect(entry?.message).not.toBe(baseMessage);
    const hint = await openHint(initiation.messageHint, [hintKey]);
    expect(hint).toEqual({
      id,
      client: TOOL_CLIENT_ID,
      deployment: TOOL_DEPLOYMENT_ID,
      principal: "candidate-7",
      exp: SECONDS + LAUNCH_TTL_SECONDS,
    });
    expect(readToken(initiation.messageHint).header).toEqual({ alg: "HS256", typ: "hint" });
    expect(await openToken(initiation.loginHint, "login", [hintKey])).toEqual({ id });
    expect(id).toMatch(/^[A-Za-z0-9_-]{27}$/u);
  });

  it("gives every login an identifier of its own", async () => {
    const ctx = setup();
    await begin(ctx);
    await begin(ctx);
    expect(ctx.kept.size).toBe(2);
  });

  it("names the frame of the storage page as the host says, and gives the frame the storage page and the allow list", async () => {
    const ctx = setup({ tools: [toolRegistration({ allow: "microphone" })] });
    const url = await prepareToolLaunch(baseMessage, { ...ctx.login, storageTarget: "frame-2" });
    expect(new URL(url).searchParams.get("lti_storage_target")).toBe("frame-2");
    const frame = await prepareToolFrame(baseMessage, ctx.login);
    expect(frame).toEqual({
      url: expect.stringContaining(TOOL_ORIGIN),
      storageUrl: endpoints.storage,
      allow: "microphone",
    });
    const plain = await prepareToolFrame(baseMessage, setup().login);
    expect("allow" in plain).toBe(false);
  });

  it("confirms the message with the host before it looks for the tool, and keeps nothing when the host refuses", async () => {
    const ctx = setup();
    const order: string[] = [];
    const refused = new Error("not yours");
    await expect(
      prepareToolLaunch(baseMessage, {
        ...ctx.login,
        check: async () => {
          order.push("check");
          throw refused;
        },
        registration: async () => {
          order.push("registration");
          return toolRegistration();
        },
      }),
    ).rejects.toBe(refused);
    expect(order).toEqual(["check"]);
    expect(ctx.kept.size).toBe(0);
  });

  it("refuses a deployment that is not the tool's, and a tool that the platform does not have, before anything is kept", async () => {
    const ctx = setup();
    await expect(prepareToolLaunch({ ...baseMessage, deploymentId: "other" }, ctx.login)).rejects.toMatchObject({
      reason: "deployment-unknown",
    });
    await expect(prepareToolLaunch({ ...baseMessage, clientId: "nobody" }, ctx.login)).rejects.toMatchObject({
      reason: "tool-unknown",
    });
    expect(ctx.kept.size).toBe(0);
  });

  it("refuses a launch whose target or tool is on the origin of the platform, the frame page or a reserved origin", async () => {
    for (const origin of [PLATFORM_ORIGIN, PLAYER_ORIGIN, ASSET_ORIGIN]) {
      const ctx = setup({ tools: [toolRegistration({ redirectUris: [TOOL_REDIRECT_URI, `${origin}/launch`] })] });
      await expect(prepareToolLaunch(baseMessage, ctx.login)).rejects.toMatchObject({ reason: "origin-refused" });
      const other = setup();
      await expect(
        prepareToolLaunch({ ...baseMessage, targetLinkUri: `${origin}/tool` }, other.login),
      ).rejects.toMatchObject({ reason: "origin-refused" });
      expect(other.kept.size).toBe(0);
    }
  });

  it("holds the message to the rules of the sender before the host is asked", async () => {
    const ctx = setup();
    const broken: unknown[] = [
      { ...baseMessage, roles: ["Teacher-of-nothing"] },
      { ...baseMessage, roleScopeMentor: ["a"] },
      { ...baseMessage, extensions: { vendor: 1 } },
      { ...baseMessage, deploymentId: "d".repeat(256) },
      { ...baseMessage, user: { subject: "s".repeat(256) } },
      { ...baseMessage, targetLinkUri: "http://tool.example.com/launch" },
      { ...baseMessage, context: { id: "c", type: ["Not a type"] } },
    ];
    for (const message of broken) {
      await expect(prepareToolLaunch(message as MessageInput, ctx.login), JSON.stringify(message)).rejects.toThrow(
        DataError,
      );
    }
    expect(ctx.checked).toEqual([]);
    await prepareToolLaunch({ ...baseMessage, roles: [MENTOR], roleScopeMentor: ["a"] }, ctx.login);
  });

  it("refuses a message that is not one, as JSON gives it", async () => {
    const ctx = setup();
    const messages = [
      "null",
      "[]",
      '{"messageType":"LtiResourceLinkRequest"}',
      JSON.stringify({ ...baseMessage, messageType: "LtiDeepLinkingResponse" }),
      JSON.stringify({ ...baseMessage, unknown: 1 }),
      JSON.stringify({ ...baseMessage, roles: "Learner" }),
      JSON.stringify({ ...baseMessage, custom: { a: 1 } }),
      JSON.stringify({ ...baseMessage, user: [] }),
      JSON.stringify({ ...baseMessage, migration: { oauthConsumerKey: "k", oauthConsumerKeySign: "s" } }),
    ];
    for (const text of messages) {
      await expect(prepareToolLaunch(JSON.parse(text), ctx.login), text).rejects.toThrow(DataError);
    }
  });

  it("keeps a custom property named __proto__ as data", async () => {
    const ctx = setup();
    await prepareToolLaunch({ ...baseMessage, custom: JSON.parse('{"__proto__":"x"}') }, ctx.login);
    const [entry] = ctx.kept.values();
    expect(Object.getOwnPropertyNames(entry?.message.custom)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(entry?.message.custom)).toBe(Object.prototype);
  });

  it("keeps the query of the login URL of the tool", async () => {
    const ctx = setup({ tools: [toolRegistration({ loginUrl: `${TOOL_ORIGIN}/lti/login?tenant=7` })] });
    const url = new URL(await prepareToolLaunch(baseMessage, ctx.login));
    expect(url.searchParams.get("tenant")).toBe("7");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
  });

  it("throws DataError for options of other types", async () => {
    const ctx = setup();
    const cases: unknown[] = [
      null,
      { ...ctx.login, check: "yes" },
      { ...ctx.login, launches: { put: () => undefined } },
      { ...ctx.login, storageTarget: "" },
      { ...ctx.login, signal: "aborted" },
      { ...ctx.login, clock: JSON.parse("{}") },
    ];
    for (const options of cases) {
      await expect(prepareToolLaunch(baseMessage, options as never)).rejects.toThrow(DataError);
    }
  });
});

describe("the authentication request", () => {
  it("answers with the page that posts the id_token and the state to the redirect URI", async () => {
    const ctx = setup();
    const page = await authorize(ctx);
    expect(page.status).toBe(200);
    const post = readPost(page);
    expect(post.action).toBe(TOOL_REDIRECT_URI);
    expect([...post.fields.keys()]).toEqual(["id_token", "state"]);
    expect(post.fields.get("state")).toBe("state-1");
    expect(post.scripts).toBe(1);
  });

  it("sends the page under a policy that allows its script by hash, forms to the tool and framing by the player", async () => {
    const page = await authorize(setup());
    const post = readPost(page);
    expect(page.headers["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${post.hash}'; base-uri 'none'; form-action ${TOOL_ORIGIN}; frame-ancestors ${PLAYER_ORIGIN}`,
    );
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("writes every value of the page as text, whatever the tool sends", async () => {
    const state = `"><script>alert(1)</script>&'`;
    const page = await authorize(setup(), (parameters) => parameters.set("state", state));
    expect(textOf(page.body)).not.toContain("<script>alert");
    expect(readPost(page).fields.get("state")).toBe(state);
  });

  it("writes a redirect URI with quotes in its query as text in the form", async () => {
    const redirect = `${TOOL_REDIRECT_URI}?a="><script>alert(1)</script>`;
    const ctx = setup({ tools: [toolRegistration({ redirectUris: [redirect] })] });
    const page = await authorize(ctx);
    expect(textOf(page.body)).not.toContain("<script>alert");
    expect(readPost(page).action).toBe(redirect);
  });

  it("accepts the authentication request as a form POST as well as a GET", async () => {
    const page = await authorize(setup(), undefined, { method: "POST" });
    expect(readPost(page).fields.has("id_token")).toBe(true);
  });

  it("issues the id_token with the claims of the kept message, signed with the signer of the key set", async () => {
    const ctx = setup();
    const { claims, page } = await launch(ctx);
    expect(readToken(readPost(page).fields.get("id_token") ?? "").header).toEqual({
      alg: "ES256",
      kid: "platform-1",
      typ: "JWT",
    });
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: TOOL_CLIENT_ID,
      sub: "candidate-7",
      iat: SECONDS,
      exp: SECONDS + 300,
      nonce: "nonce-1",
    });
    const message = modelOf(claims);
    expect(message).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      deploymentId: TOOL_DEPLOYMENT_ID,
      targetLinkUri: TOOL_LAUNCH_URL,
      user: { subject: "candidate-7", name: "Ana Candidate", email: "ana@example.edu" },
      roles: [LEARNER],
      context: { id: "course-1", label: "C1", title: "Course 1" },
      resourceLink: { id: "session-1-q-draw", title: "Drawing tool" },
    });
    expect(message.custom).toEqual(new Map([["exam", "tryout-1"]]));
    expect(message.services).toEqual({});
    expect(claims[`${CLAIM}tool_platform`]).toBeUndefined();
  });

  it("issues an anonymous launch without a sub", async () => {
    const ctx = setup();
    const { claims } = await launch(ctx, { ...baseMessage, user: {} });
    expect("sub" in claims).toBe(false);
    expect(modelOf(claims).user).toEqual({});
  });

  it("writes the claims of every part of a message, its extensions and the instance of the platform", async () => {
    const ctx = setup();
    const instance = { guid: "lms-1", name: "Campus LMS", productFamilyCode: "campus", version: "4.2" };
    const message: MessageInput = {
      ...baseMessage,
      actualUser: { id: "admin-1", roles: [LEARNER], name: "Admin" },
      roles: [LEARNER, MENTOR],
      roleScopeMentor: ["candidate-9"],
      organization: { id: "org-1", name: "Faculty" },
      presentation: {
        documentTarget: "iframe",
        height: 600,
        width: 800,
        returnUrl: "https://app.platform.example/back",
        locale: "id",
      },
      lis: { person_sourcedid: "p-7", course_section_sourcedid: "s-1" },
      extensions: { "https://vendor.example/claim": { tier: 2 } },
    };
    const { claims } = await launch(ctx, message, { config: { ...config, instance } });
    const read = modelOf(claims);
    expect(read).toMatchObject({
      actualUser: { id: "admin-1", roles: [LEARNER], name: "Admin" },
      roleScopeMentor: ["candidate-9"],
      organization: { id: "org-1", name: "Faculty" },
      presentation: message.presentation,
      lis: message.lis,
      platform: instance,
    });
    expect(claims["https://vendor.example/claim"]).toEqual({ tier: 2 });
  });

  it("issues a Deep Linking request whose data seals its user, its settings and the host's data for a day", async () => {
    const ctx = setup();
    const settings = {
      returnUrl: "https://lti.platform.example/deep-linking/return",
      acceptTypes: ["ltiResourceLink"],
      acceptPresentationDocumentTargets: ["iframe"],
      acceptMultiple: true,
      data: { course: "course-1", slot: 3 },
    };
    const { claims } = await launch(ctx, { ...baseFields, messageType: "LtiDeepLinkingRequest", settings });
    const read = modelOf(claims);
    if (read.messageType !== "LtiDeepLinkingRequest") throw new Error("not a Deep Linking request");
    expect(read.settings).toMatchObject({
      returnUrl: settings.returnUrl,
      acceptTypes: ["ltiResourceLink"],
      acceptMultiple: true,
    });
    const data = read.settings.data ?? "";
    expect(readToken(data).header).toEqual({ alg: "HS256", typ: "deep-linking-data" });
    expect(await openToken(data, "deep-linking-data", [hintKey])).toEqual({
      client: TOOL_CLIENT_ID,
      deployment: TOOL_DEPLOYMENT_ID,
      subject: "candidate-7",
      settings: {
        returnUrl: settings.returnUrl,
        acceptTypes: ["ltiResourceLink"],
        acceptPresentationDocumentTargets: ["iframe"],
        acceptMultiple: true,
      },
      data: settings.data,
      exp: SECONDS + 86_400,
    });
    expect(claims[`${DL}deep_linking_settings`]).toMatchObject({ data });
  });

  it("issues a Start Proctoring message whose session data seals the attempt for an hour, and an End Assessment message", async () => {
    const ctx = setup();
    const { claims } = await launch(ctx, {
      ...baseMessage,
      messageType: "LtiStartProctoring",
      attemptNumber: 2,
      startAssessmentUrl: "https://lti.platform.example/proctoring/start",
      proctoringSettings: { data: "camera" },
    });
    const read = modelOf(claims);
    if (read.messageType !== "LtiStartProctoring") throw new Error("not a Start Proctoring message");
    expect(read).toMatchObject({ attemptNumber: 2, proctoringSettings: { data: "camera" } });
    expect(await openToken(read.sessionData, "session-data", [hintKey])).toEqual({
      client: TOOL_CLIENT_ID,
      deployment: TOOL_DEPLOYMENT_ID,
      resourceLink: "session-1-q-draw",
      attempt: 2,
      subject: "candidate-7",
      exp: SECONDS + 3600,
    });
    expect(claims[`${AP}session_data`]).toBe(read.sessionData);
    const ended = await launch(setup(), {
      ...baseMessage,
      messageType: "LtiEndAssessment",
      attemptNumber: 2,
      errorMessage: "The camera stopped.",
    });
    expect(modelOf(ended.claims)).toMatchObject({
      messageType: "LtiEndAssessment",
      attemptNumber: 2,
      errorMessage: "The camera stopped.",
    });
  });

  it("signs the consumer key of the migration claim with the secret that migrationSecret gives, and keeps no secret", async () => {
    const ctx = setup();
    const message = { ...baseMessage, migration: { oauthConsumerKey: "key-1", userId: "u-11" } };
    const asked: string[] = [];
    const migrationSecret = async (key: string) => {
      asked.push(key);
      return "secret-1";
    };
    const { claims } = await launch(ctx, message, { migrationSecret });
    expect(asked).toEqual(["key-1"]);
    const read = modelOf(claims);
    expect(await verifyMigration(read, "secret-1")).toBe(true);
    expect(await verifyMigration(read, "secret-2")).toBe(false);
    const unsigned = await launch(setup(), message, { migrationSecret: async () => undefined });
    expect(modelOf(unsigned.claims).migration).toEqual({ oauthConsumerKey: "key-1", userId: "u-11", verified: false });
    const without = await launch(setup(), message);
    expect(modelOf(without.claims).migration?.oauthConsumerKeySign).toBeUndefined();
  });

  it("substitutes the variables that the message answers, those that the host resolves, and leaves the others", async () => {
    const ctx = setup({ tools: [toolRegistration({ custom: { tool: "$Context.id", exam: "from-the-tool" } })] });
    const resolved: string[] = [];
    const substitution = {
      names: ["CourseSection.timeFrame.begin", "com.example.secret"],
      resolve: async (name: string) => {
        resolved.push(name);
        return name === "com.example.secret" ? undefined : "2026-11-01T00:00:00Z";
      },
    };
    const custom = {
      user: "$User.id",
      name: "$Person.name.full",
      sourced: "$Person.sourcedId",
      begin: "$CourseSection.timeFrame.begin",
      secret: "$com.example.secret",
      unknown: "$Group.sourcedId",
      plain: "$ plain",
      exam: "tryout-1",
    };
    const { claims } = await launch(ctx, { ...baseMessage, custom }, { substitution });
    expect(Object.fromEntries(modelOf(claims).custom)).toEqual({
      tool: "course-1",
      exam: "tryout-1",
      user: "candidate-7",
      name: "Ana Candidate",
      sourced: "",
      begin: "2026-11-01T00:00:00Z",
      secret: "$com.example.secret",
      unknown: "$Group.sourcedId",
      plain: "$ plain",
    });
    expect(resolved).toEqual(["CourseSection.timeFrame.begin", "com.example.secret"]);
  });

  it("answers every variable of the message from the message itself, and with nothing where the message has no value", async () => {
    const instance = {
      guid: "lms-1",
      name: "Campus",
      description: "The campus LMS",
      url: "https://lms.example",
      contactEmail: "admin@lms.example",
      productFamilyCode: "campus",
      version: "4.2",
    };
    const message: MessageInput = {
      ...baseMessage,
      user: {
        subject: "u-1",
        name: "Ana B C",
        givenName: "Ana",
        familyName: "C",
        middleName: "B",
        email: "a@x",
        picture: "https://img.example/a",
      },
      actualUser: {
        id: "admin-1",
        name: "Root A",
        givenName: "Root",
        familyName: "A",
        middleName: "M",
        email: "r@x",
        picture: "https://img.example/r",
      },
      roles: [MENTOR],
      roleScopeMentor: ["u-2", "u-3"],
      context: {
        id: "c-1",
        label: "C1",
        title: "Course",
        type: ["http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering"],
      },
      organization: {
        id: "o-1",
        type: "institution",
        name: "Faculty",
        description: "Of arts",
        url: "https://org.example",
      },
      presentation: {
        documentTarget: "window",
        height: 600,
        width: 800,
        returnUrl: "https://app.platform.example/r",
        locale: "id",
      },
      lis: { person_sourcedid: "p-1", course_offering_sourcedid: "co-1", course_section_sourcedid: "cs-1" },
      resourceLink: { id: "rl-1", title: "Quiz", description: "The quiz" },
    };
    const expected: Record<string, string> = {
      "User.id": "u-1",
      "User.image": "https://img.example/a",
      "User.scope.mentor": "u-2,u-3",
      "ActualUser.id": "admin-1",
      "ActualUser.image": "https://img.example/r",
      "Person.sourcedId": "p-1",
      "Person.name.full": "Ana B C",
      "Person.name.family": "C",
      "Person.name.given": "Ana",
      "Person.name.middle": "B",
      "Person.email.primary": "a@x",
      "ActualPerson.name.full": "Root A",
      "ActualPerson.name.family": "A",
      "ActualPerson.name.given": "Root",
      "ActualPerson.name.middle": "M",
      "ActualPerson.email.primary": "r@x",
      "Context.id": "c-1",
      "Context.type": "http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering",
      "Context.label": "C1",
      "Context.title": "Course",
      "CourseOffering.sourcedId": "co-1",
      "CourseSection.sourcedId": "cs-1",
      "ResourceLink.id": "rl-1",
      "ResourceLink.title": "Quiz",
      "ResourceLink.description": "The quiz",
      "Message.returnUrl": "https://app.platform.example/r",
      "Message.documentTarget": "window",
      "Message.height": "600",
      "Message.width": "800",
      "Message.locale": "id",
      "Organization.id": "o-1",
      "Organization.type": "institution",
      "Organization.name": "Faculty",
      "Organization.description": "Of arts",
      "Organization.url": "https://org.example",
      "ToolPlatform.productFamilyCode": "campus",
      "ToolPlatform.version": "4.2",
      "ToolPlatformInstance.guid": "lms-1",
      "ToolPlatformInstance.name": "Campus",
      "ToolPlatformInstance.description": "The campus LMS",
      "ToolPlatformInstance.url": "https://lms.example",
      "ToolPlatformInstance.contactEmail": "admin@lms.example",
    };
    const custom = Object.fromEntries(Object.keys(expected).map((name) => [name, `$${name}`]));
    const ctx = setup();
    const full = await launch(ctx, { ...message, custom }, { config: { ...config, instance } });
    expect(Object.fromEntries(modelOf(full.claims).custom)).toEqual(expected);
    const empty = await launch(setup(), {
      ...baseFields,
      messageType: "LtiEndAssessment",
      attemptNumber: 1,
      user: {},
      context: undefined,
      custom,
    });
    expect(new Set(modelOf(empty.claims).custom.values())).toEqual(new Set([""]));
  });

  it("refuses to the browser what comes before the tool and its redirect URI are known, and takes nothing", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const query = (change: (search: URLSearchParams) => void) => {
      const changed = new URLSearchParams(parameters);
      change(changed);
      return authenticationRequest(endpoints.authorization, changed);
    };
    const answers = [
      await handle(ctx, request({ url: endpoints.authorization, method: "PUT" })),
      await handle(
        ctx,
        request({
          url: endpoints.authorization,
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "a".repeat(65_537),
        }),
      ),
      await handle(ctx, request({ url: `${endpoints.authorization}?${parameters}&nonce=again` })),
      await handle(
        ctx,
        query((search) => search.delete("client_id")),
      ),
      await handle(
        ctx,
        query((search) => search.set("client_id", "nobody")),
      ),
      await handle(
        ctx,
        query((search) => search.set("redirect_uri", "https://evil.example/catch")),
      ),
      await handle(
        ctx,
        query((search) => search.delete("redirect_uri")),
      ),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([405, 413, 400, 400, 400, 400, 400]);
    expect(answers[0]?.headers.allow).toBe("GET, POST");
    for (const answer of answers) expect(textOf(answer.body)).not.toContain("<form");
    expect(ctx.kept.size).toBe(1);
  });

  it("posts the authentication error response to the tool for a request that breaks the protocol", async () => {
    const cases: [(search: URLSearchParams) => void, string][] = [
      [(search) => search.set("scope", "openid profile"), "invalid_scope"],
      [(search) => search.set("response_type", "code"), "unsupported_response_type"],
      [(search) => search.set("response_mode", "query"), "invalid_request"],
      [(search) => search.set("prompt", "login"), "invalid_request"],
      [(search) => search.delete("nonce"), "invalid_request"],
      [(search) => search.delete("lti_message_hint"), "invalid_request"],
    ];
    for (const [change, error] of cases) {
      const ctx = setup();
      const page = await authorize(ctx, change);
      expect(errorOf(page), error).toEqual({ status: page.status, error });
      expect(readPost(page).action).toBe(TOOL_REDIRECT_URI);
      expect(readPost(page).fields.get("state")).toBe("state-1");
      expect(ctx.kept.size, error).toBe(1);
    }
  });

  it("posts the error response without a state when the request has none", async () => {
    const page = await authorize(setup(), (search) => search.delete("state"));
    expect([...readPost(page).fields.keys()]).toEqual(["error", "error_description"]);
  });

  it("refuses with login_required a hint that this platform did not seal for this launch and tool", async () => {
    const ctx = setup();
    const { initiation } = await begin(ctx);
    const forged = await sealHint(
      { id: "x", client: TOOL_CLIENT_ID, deployment: TOOL_DEPLOYMENT_ID, exp: SECONDS + 300 },
      await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
    );
    const cases: [(search: URLSearchParams) => void, LtiErrorReason][] = [
      [(search) => search.set("lti_message_hint", forged), "hint-invalid"],
      [(search) => search.set("lti_message_hint", initiation.loginHint), "hint-invalid"],
      [
        (search) => {
          search.set("lti_message_hint", otherSpelling(initiation.messageHint));
          search.set("login_hint", initiation.loginHint);
        },
        "hint-invalid",
      ],
      [(search) => search.set("login_hint", initiation.messageHint), "login-hint-mismatch"],
      [(search) => search.delete("login_hint"), "login-hint-mismatch"],
    ];
    for (const [change, reason] of cases) {
      const page = await authorize(ctx, change);
      expect(errorOf(page), reason).toEqual({ status: new LtiError("", reason).status, error: "login_required" });
    }
    expect(ctx.kept.size).toBe(cases.length + 1);
  });

  it("refuses the hint of another tool", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx, {
      ...baseMessage,
      clientId: OTHER_CLIENT_ID,
      targetLinkUri: OTHER_LAUNCH_URL,
    });
    parameters.set("client_id", TOOL_CLIENT_ID);
    parameters.set("redirect_uri", TOOL_REDIRECT_URI);
    const page = await handle(ctx, authenticationRequest(endpoints.authorization, parameters));
    expect(errorOf(page)).toEqual({ status: 403, error: "login_required" });
    expect(readPost(page).fields.get("error_description")).toBe("The lti_message_hint was issued for another tool.");
  });

  it("expires the hint after 300 seconds", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    ctx.clock.advance(LAUNCH_TTL_SECONDS);
    const page = await handle(ctx, authenticationRequest(endpoints.authorization, parameters));
    expect(readPost(page).fields.get("error_description")).toBe("The lti_message_hint has expired.");
    expect(ctx.kept.size).toBe(1);
  });

  it("takes the message once, so that the same request a second time is refused", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const first = await handle(ctx, authenticationRequest(endpoints.authorization, parameters));
    expect(readPost(first).fields.has("id_token")).toBe(true);
    const second = await handle(ctx, authenticationRequest(endpoints.authorization, parameters));
    expect(errorOf(second)).toEqual({ status: 403, error: "login_required" });
    expect(readPost(second).fields.get("error_description")).toContain("has been used or has expired");
  });

  it("lets only one of two requests with one hint have the id_token", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const pages = await Promise.all(
      [1, 2].map(() => handle(ctx, authenticationRequest(endpoints.authorization, parameters))),
    );
    expect(pages.map((page) => readPost(page).fields.has("id_token")).sort()).toEqual([false, true]);
  });

  it("opens a hint that a previous hint key sealed, and refuses one of a key it does not hold", async () => {
    const ctx = setup();
    const rotated = { ...ctx.login, config: { ...config, hintKey: previousHintKey, previousHintKeys: [] } };
    const url = await prepareToolLaunch(baseMessage, rotated);
    const search = new URL(url).searchParams;
    const parameters = new URLSearchParams([
      ["scope", "openid"],
      ["response_type", "id_token"],
      ["client_id", TOOL_CLIENT_ID],
      ["redirect_uri", TOOL_REDIRECT_URI],
      ["login_hint", search.get("login_hint") ?? ""],
      ["state", "s"],
      ["response_mode", "form_post"],
      ["nonce", "n"],
      ["prompt", "none"],
      ["lti_message_hint", search.get("lti_message_hint") ?? ""],
    ]);
    const page = await handle(ctx, authenticationRequest(endpoints.authorization, parameters));
    expect(readPost(page).fields.has("id_token")).toBe(true);
    const unknown = setup();
    await prepareToolLaunch(baseMessage, { ...unknown.login, config: rotated.config });
    const refused = await handle(unknown, authenticationRequest(endpoints.authorization, parameters), {
      config: { ...config, previousHintKeys: [] },
    });
    expect(readPost(refused).fields.get("error")).toBe("login_required");
  });

  it("asks checkLaunch about the launch before it takes the message, and keeps the message when it refuses", async () => {
    const ctx = setup();
    const seen: unknown[] = [];
    const page = await authorize(ctx, undefined, {
      requests: {
        checkLaunch: async (asked) => {
          seen.push(asked);
          return false;
        },
      },
    });
    expect(errorOf(page)).toEqual({ status: 403, error: "access_denied" });
    const request = expect.objectContaining({
      url: expect.stringMatching(/^https:\/\/lti\.platform\.example\/authorize\?/u),
    });
    expect(seen).toEqual([
      { clientId: TOOL_CLIENT_ID, deploymentId: TOOL_DEPLOYMENT_ID, principal: "candidate-7", request },
    ]);
    expect(ctx.kept.size).toBe(1);
    const anonymous = setup();
    await authorize(anonymous, undefined, {
      message: { ...baseMessage, user: {} },
      requests: { checkLaunch: async (asked) => seen.push(asked) > 0 },
    });
    expect(seen.at(-1)).toEqual({ clientId: TOOL_CLIENT_ID, deploymentId: TOOL_DEPLOYMENT_ID, request });
  });

  it("gives checkLaunch the request, so that one set of options checks the session of each browser", async () => {
    const ctx = setup();
    const sessions = new Map([["session=ana", "candidate-7"]]);
    const checkLaunch = async ({ principal, request }: LaunchToCheck) =>
      sessions.get(request.headers.cookie ?? "") === principal;
    const { parameters } = await begin(ctx);
    const asked = authenticationRequest(endpoints.authorization, parameters);
    const other = await handle(
      ctx,
      { ...asked, headers: { ...asked.headers, cookie: "session=eve" } },
      { checkLaunch },
    );
    expect(errorOf(other)).toEqual({ status: 403, error: "access_denied" });
    const own = await handle(ctx, { ...asked, headers: { ...asked.headers, cookie: "session=ana" } }, { checkLaunch });
    expect(readPost(own).fields.has("id_token")).toBe(true);
  });

  it("refuses a deployment that the tool lost between the login and the authentication request", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    ctx.tools.set(TOOL_CLIENT_ID, toolRegistration({ deploymentIds: ["deployment-2"] }));
    const page = await handle(ctx, authenticationRequest(endpoints.authorization, parameters));
    expect(errorOf(page)).toEqual({ status: 400, error: "unauthorized_client" });
  });
});

describe("the key set", () => {
  it("publishes the public keys of the key set, which verify the id_token, with a cache lifetime of an hour", async () => {
    const ctx = setup();
    const response = await handle(ctx, get(endpoints.jwks));
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=3600");
    expect(JSON.parse(textOf(response.body))).toEqual({ keys: platformKeys.publicKeys });
    expect(textOf(response.body)).not.toContain('"d"');
  });

  it("publishes every key of a rotation, answers HEAD without a body and other methods with 405", async () => {
    const ctx = setup();
    const next = { ...platformKeys.publicKeys[0], kid: "platform-2" };
    const rotation = { ...config, keys: { ...config.keys, publicKeys: [...config.keys.publicKeys, next] } };
    const both = await handle(ctx, get(endpoints.jwks), { config: rotation });
    expect(JSON.parse(textOf(both.body)).keys.map((key: { kid: string }) => key.kid)).toEqual([
      "platform-1",
      "platform-2",
    ]);
    const head = await handle(ctx, get(endpoints.jwks, "HEAD"));
    expect([head.status, head.body]).toEqual([200, ""]);
    const post = await handle(ctx, get(endpoints.jwks, "POST"));
    expect([post.status, post.headers.allow]).toEqual([405, "GET, HEAD"]);
  });
});

describe("the token endpoint", () => {
  /** Posts a token request for the first tool with an assertion that `change` edits. */
  async function token(
    ctx: Setup,
    change: Parameters<typeof clientAssertion>[3] = {},
    header = {},
    scope = "https://purl.imsglobal.org/spec/lti-ags/scope/score",
  ) {
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock, change, header);
    return handle(ctx, tokenRequest(endpoints.token, assertion, scope));
  }

  /** The OAuth error of an answer. */
  function oauthError(response: HttpResponse): string {
    expect(response.status).toBe(400);
    return JSON.parse(textOf(response.body)).error;
  }

  it("verifies the assertion and refuses a scope that no service of the platform offers, after the jti is spent", async () => {
    const ctx = setup();
    const response = await token(ctx);
    expect(oauthError(response)).toBe("invalid_scope");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect([...ctx.used.keys()]).toEqual([expect.stringMatching(/^assertion:tool-client-1:/u)]);
    expect(ctx.toolFetches).toEqual(["https://tool.example.com/.well-known/jwks.json"]);
  });

  it("grants a sealed token of an hour for the scopes that the request asks for, the registration grants and a service offers", async () => {
    const SCORE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
    const RESULT = "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly";
    const ctx = setup({ tools: [toolRegistration({ scopes: [SCORE, "https://example.com/other"] })] });
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock, {
      [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
    });
    Object.assign(ctx.requests, { services: { gradebook: new MemoryGradebook(TOOL_CLIENT_ID) } });
    const response = await handle(ctx, tokenRequest(endpoints.token, assertion, `${RESULT} ${SCORE}`));
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(textOf(response.body));
    expect(body).toEqual({ access_token: expect.any(String), token_type: "Bearer", expires_in: 3600, scope: SCORE });
    expect(readToken(body.access_token).header).toEqual({ alg: "HS256", typ: "access" });
    expect(await openToken(body.access_token, "access", [hintKey])).toEqual({
      client: TOOL_CLIENT_ID,
      deployment: TOOL_DEPLOYMENT_ID,
      scopes: [SCORE],
      exp: SECONDS + 3600,
    });
    const without = await token(ctx);
    expect(await openToken(JSON.parse(textOf(without.body)).access_token, "access", [hintKey])).not.toHaveProperty(
      "deployment",
    );
  });

  it("refuses a request that is not a token request of the protocol", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    expect((await handle(ctx, get(endpoints.token))).status).toBe(405);
    const tooLarge = request({
      url: endpoints.token,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a".repeat(65_537),
    });
    expect(oauthError(await handle(ctx, tooLarge))).toBe("invalid_request");
    const json = request({
      url: endpoints.token,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(oauthError(await handle(ctx, json))).toBe("invalid_request");
    const cases: [Record<string, string | undefined>, string][] = [
      [{ grant_type: "authorization_code" }, "unsupported_grant_type"],
      [{ client_assertion_type: "urn:other" }, "invalid_request"],
      [{ client_assertion: undefined }, "invalid_request"],
      [{ scope: undefined }, "invalid_scope"],
    ];
    for (const [overrides, error] of cases) {
      expect(oauthError(await handle(ctx, tokenRequest(endpoints.token, assertion, "s", overrides))), error).toBe(
        error,
      );
    }
    expect(ctx.used.size).toBe(0);
  });

  it("refuses an assertion that the Security Framework does not allow, with invalid_client and no jti spent", async () => {
    const ctx = setup();
    const cases: [Parameters<typeof clientAssertion>[3], Record<string, unknown>][] = [
      [{ iss: "nobody", sub: "nobody" }, {}],
      [{ sub: "someone-else" }, {}],
      [{ aud: "https://elsewhere.example/token" }, {}],
      [{ aud: [endpoints.token, "https://elsewhere.example"] }, {}],
      [{ exp: SECONDS - 61 }, {}],
      [{ exp: SECONDS + 3601 }, {}],
      [{ iat: SECONDS + 61 }, {}],
      [{ jti: "" }, {}],
      [{ jti: undefined }, {}],
      [{ [`${CLAIM}message_type`]: "LtiDeepLinkingResponse" }, {}],
      [{ [`${CLAIM}deployment_id`]: "deployment-9" }, {}],
      [{}, { kid: "unknown" }],
    ];
    for (const [change, header] of cases) {
      expect(oauthError(await token(ctx, change, header)), JSON.stringify(change)).toBe("invalid_client");
    }
    expect(
      oauthError(
        await handle(
          ctx,
          tokenRequest(endpoints.token, await clientAssertion(attackerKeys, endpoints.token, ctx.clock), "s"),
        ),
      ),
    ).toBe("invalid_client");
    expect(ctx.used.size).toBe(0);
  });

  it("accepts the platform's issuer beside the token URL in aud, and the deployment of the tool", async () => {
    const ctx = setup();
    expect(oauthError(await token(ctx, { aud: [endpoints.token, ISSUER] }))).toBe("invalid_scope");
    expect(oauthError(await token(ctx, { [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID }))).toBe("invalid_scope");
  });

  it("refuses none, HMAC and an algorithm that the registration does not list, before any key is fetched", async () => {
    const ctx = setup({ tools: [toolRegistration({ algorithms: ["ES256"] })] });
    const claims = {
      iss: TOOL_CLIENT_ID,
      sub: TOOL_CLIENT_ID,
      aud: endpoints.token,
      iat: SECONDS,
      exp: SECONDS + 300,
      jti: "j",
    };
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString("base64url");
    const unsigned = `${encode({ alg: "none", kid: "tool-key-1" })}.${encode(claims)}.`;
    const hmac = `${encode({ alg: "HS256", kid: "tool-key-1" })}.${encode(claims)}.${Buffer.from("x".repeat(32)).toString("base64url")}`;
    for (const assertion of [unsigned, hmac, await clientAssertion(toolKeys, endpoints.token, ctx.clock)]) {
      const response = await handle(ctx, tokenRequest(endpoints.token, assertion, "s"));
      expect(JSON.parse(textOf(response.body)).error_description).toContain("must be signed with one of ES256");
    }
    expect(ctx.toolFetches).toEqual([]);
  });

  it("verifies the ES256 assertion of a tool that gave its key and not a key set", async () => {
    const ctx = setup();
    const assertion = await ecAssertion(otherToolKey, endpoints.token, ctx.clock, {
      iss: OTHER_CLIENT_ID,
      sub: OTHER_CLIENT_ID,
    });
    expect(oauthError(await handle(ctx, tokenRequest(endpoints.token, assertion, "s")))).toBe("invalid_scope");
    expect(ctx.toolFetches).toEqual([]);
  });

  it("takes an assertion once, and remembers its jti until its expiry, rounded up, and the leeway after it", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock, { exp: SECONDS + 300.25 });
    expect(oauthError(await handle(ctx, tokenRequest(endpoints.token, assertion, "s")))).toBe("invalid_scope");
    expect([...ctx.used.values()]).toEqual([(SECONDS + 301 + 60) * 1000]);
    const again = await handle(ctx, tokenRequest(endpoints.token, assertion, "s"));
    expect(JSON.parse(textOf(again.body))).toMatchObject({
      error: "invalid_client",
      error_description: "The jti of the assertion has been used.",
    });
  });

  it("answers 500 when the key set of the tool cannot be fetched, and spends no jti", async () => {
    const ctx = setup();
    ctx.failToolKeys = true;
    const response = await token(ctx);
    expect(response.status).toBe(500);
    expect(textOf(response.body)).not.toContain("503");
    expect(ctx.used.size).toBe(0);
  });

  it("refuses with invalid_client the assertion of a tool whose key set is not a JWK Set, and spends no jti", async () => {
    for (const body of ['{"keys":"x"}', "<html>", JSON.stringify({ keys: Array.from({ length: 101 }, () => ({})) })]) {
      const ctx = setup();
      const jwks = createJwksCache({ fetch: async () => new Response(body), clock: ctx.clock });
      const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
      const refused = await handle(ctx, tokenRequest(endpoints.token, assertion, "s"), { jwks });
      expect(refused.status, body).toBe(400);
      expect(JSON.parse(textOf(refused.body)), body).toMatchObject({
        error: "invalid_client",
        error_description: expect.stringContaining("The key set has no usable key for the token"),
      });
      expect(ctx.used.size).toBe(0);
    }
  });

  it("refuses a client_id of the request that is not the issuer of its assertion, before the assertion is verified", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const other = await handle(ctx, tokenRequest(endpoints.token, assertion, "s", { client_id: OTHER_CLIENT_ID }));
    expect(JSON.parse(textOf(other.body))).toMatchObject({
      error: "invalid_client",
      error_description: expect.stringContaining("is not the issuer of its assertion"),
    });
    expect([ctx.toolFetches, ctx.used.size]).toEqual([[], 0]);
    const same = await handle(ctx, tokenRequest(endpoints.token, assertion, "s", { client_id: TOOL_CLIENT_ID }));
    expect(oauthError(same)).toBe("invalid_scope");
  });

  it("grants a scope that the request names twice once", async () => {
    const SCORE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
    const ctx = setup({ tools: [toolRegistration({ scopes: [SCORE] })] });
    Object.assign(ctx.requests, { services: { gradebook: new MemoryGradebook(TOOL_CLIENT_ID) } });
    const response = await token(ctx, {}, {}, `${SCORE} ${SCORE}`);
    const body = JSON.parse(textOf(response.body));
    expect(body.scope).toBe(SCORE);
    expect((await openToken(body.access_token, "access", [hintKey]))?.scopes).toEqual([SCORE]);
  });
});

describe("the storage page and the routes", () => {
  it("serves the storage page that answers the frame of the tool, framed only by the player", async () => {
    const ctx = setup();
    const page = await handle(ctx, get(endpoints.storage), { toolFrame: "frame-7" });
    expect(page.status).toBe(200);
    expect(textOf(page.body)).toContain("frame-7");
    expect(page.headers["content-security-policy"]).toContain(`frame-ancestors ${PLAYER_ORIGIN}`);
    expect((await handle(ctx, get(endpoints.storage, "POST"))).status).toBe(405);
  });

  it("refuses a request for another origin than the platform's, and answers 404 for a path that names nothing", async () => {
    const ctx = setup();
    for (const origin of [PLAYER_ORIGIN, ASSET_ORIGIN, "https://evil.example"]) {
      expect((await handle(ctx, get(`${origin}/jwks`))).status).toBe(403);
    }
    expect((await handle(ctx, get(`${PLATFORM_ORIGIN}/nothing`))).status).toBe(404);
    expect((await handle(ctx, get(`${PLATFORM_ORIGIN}/jwks/`))).status).toBe(404);
  });

  it("throws DataError for requests and options of other types", async () => {
    const ctx = setup();
    await expect(handlePlatformRequest(JSON.parse("null"), ctx.requests)).rejects.toThrow(DataError);
    const cases: unknown[] = [
      null,
      { ...ctx.requests, client: undefined },
      { ...ctx.requests, once: "yes" },
      { ...ctx.requests, jwks: {} },
      { ...ctx.requests, maxBodyBytes: "65536" },
      { ...ctx.requests, maxBodyBytes: 0 },
      { ...ctx.requests, substitution: { names: "User.id", resolve: async () => "" } },
      { ...ctx.requests, toolFrame: "" },
      { ...ctx.requests, unknown: true },
    ];
    for (const options of cases) {
      await expect(handlePlatformRequest(get(endpoints.jwks), options as never)).rejects.toThrow(DataError);
    }
  });
});

describe("buildCapabilitiesScript", () => {
  it("names the frame of the storage page for lti.put_data and lti.get_data, with the hash of the script", async () => {
    const { source, hash } = await buildCapabilitiesScript({ storageTarget: "frame-2" });
    expect(source).toContain('var target = "frame-2";');
    expect(hash).toBe(`'sha256-${(await import("node:crypto")).createHash("sha256").update(source).digest("base64")}'`);
    expect((await buildCapabilitiesScript()).source).toContain('var target = "lti-storage";');
  });

  it("writes any name as a literal that cannot close the script", async () => {
    const { source } = await buildCapabilitiesScript({ storageTarget: '</script><script>alert(1)//"$&' });
    expect(source).not.toContain("</script>");
    expect(source).toContain('"\\u003c/script>\\u003cscript>alert(1)//\\"$&"');
  });

  it("throws DataError for options of other types", async () => {
    await expect(buildCapabilitiesScript(JSON.parse("null"))).rejects.toThrow(DataError);
    await expect(buildCapabilitiesScript(JSON.parse('{"storageTarget":5}'))).rejects.toThrow(DataError);
    await expect(buildCapabilitiesScript({ storageTarget: "" })).rejects.toThrow(DataError);
  });
});

describe("the tool role and the platform role together", () => {
  /** Launches a message of the platform role into the tool role of this package, on the cookie path. */
  async function roundTrip(message: MessageInput) {
    const ctx = setup();
    const platformFetch = async (url: string, init: { method: string; headers: Readonly<Record<string, string>> }) => {
      const answer = await handle(ctx, request({ url, method: init.method, headers: init.headers }));
      return new Response(answer.body === "" ? null : answer.body, { status: answer.status, headers: answer.headers });
    };
    const registration: PlatformRegistration = {
      issuer: ISSUER,
      clientId: TOOL_CLIENT_ID,
      deploymentIds: [TOOL_DEPLOYMENT_ID],
      authenticationUrl: endpoints.authorization,
      jwksUrl: endpoints.jwks,
      accessTokenUrl: endpoints.token,
      redirectUri: TOOL_REDIRECT_URI,
      signer: { algorithm: "RS256", keyId: toolKeys.kid, sign: async () => new Uint8Array() },
    };
    const options = {
      registration: async () => registration,
      clock: ctx.clock,
      store: new MemoryStore(),
      jwks: createJwksCache({ fetch: platformFetch, clock: ctx.clock }),
    };
    const initiation = new URL(await prepareToolLaunch(message, ctx.login));
    initiation.searchParams.delete("lti_storage_target");
    const login = await handleLogin(request({ url: initiation.href }), options);
    const page = await handle(ctx, request({ url: login.headers.location ?? "" }));
    const post = readPost(page);
    const launched = await handleLaunch(
      request({
        url: post.action,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieOf(login.headers["set-cookie"]) },
        body: new URLSearchParams([...post.fields]).toString(),
      }),
      options,
    );
    if ("status" in launched) throw new Error("The tool answered with a page.");
    return launched;
  }

  it("launches each message type of the platform into the tool role, which reads what the host gave", async () => {
    const resourceLink = await roundTrip(baseMessage);
    expect(resourceLink).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      resourceLink: baseMessage.resourceLink,
    });
    const deepLinking = await roundTrip({
      ...baseFields,
      messageType: "LtiDeepLinkingRequest",
      settings: {
        returnUrl: `${PLATFORM_ORIGIN}/dl`,
        acceptTypes: ["link"],
        acceptPresentationDocumentTargets: ["window"],
      },
    });
    expect(deepLinking).toMatchObject({ messageType: "LtiDeepLinkingRequest", settings: { acceptTypes: ["link"] } });
    const proctoring = await roundTrip({
      ...baseMessage,
      messageType: "LtiStartProctoring",
      attemptNumber: 1,
      startAssessmentUrl: `${PLATFORM_ORIGIN}/start`,
    });
    expect(proctoring).toMatchObject({ messageType: "LtiStartProctoring", attemptNumber: 1 });
    const ended = await roundTrip({ ...baseMessage, messageType: "LtiEndAssessment", attemptNumber: 1 });
    expect(ended).toMatchObject({ messageType: "LtiEndAssessment", user: { subject: "candidate-7" } });
  });
});

describe("properties", () => {
  it("never opens a hint that was changed", async () => {
    const ctx = setup();
    const { initiation } = await begin(ctx);
    const hint = initiation.messageHint;
    await fc.assert(
      fc.asyncProperty(fc.nat(hint.length - 1), fc.constantFrom(..."ABCabc012-_."), async (at, char) => {
        fc.pre(hint[at] !== char);
        const changed = `${hint.slice(0, at)}${char}${hint.slice(at + 1)}`;
        expect(await openHint(changed, [hintKey, previousHintKey])).toBeUndefined();
      }),
      { seed: 7, numRuns: 60 },
    );
  });

  it("passes custom properties that name no variable unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 8 }),
          fc.string({ maxLength: 12 }).filter((text) => !text.startsWith("$")),
          { maxKeys: 5 },
        ),
        async (custom) => {
          const ctx = setup();
          const { claims } = await launch(ctx, { ...baseMessage, custom });
          expect(Object.fromEntries(modelOf(claims).custom)).toEqual(custom);
        },
      ),
      { seed: 11, numRuns: 15 },
    );
  });
});
