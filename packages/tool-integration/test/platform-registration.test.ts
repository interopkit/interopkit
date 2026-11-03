// biome-ignore-all lint/style/useNamingConvention: the names of the configurations of Dynamic Registration are those of the specification.

import { type CallOptions, createCryptoKeySigner, DataError, type Fetch } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { SCOPES, type ToolConfiguration } from "../src/index.js";
import {
  buildRegistrationInitiation,
  buildToolRegistration,
  type PlatformConfig,
  type PlatformRequestOptions,
  type RegisteredTool,
  type RegistrationStore,
} from "../src/platform/index.js";
import { openToken, sealToken } from "../src/platform/internal.js";
import { readPlatformConfiguration, readToolRegistrationResult } from "../src/protocol/internal.js";
import {
  buildPlatformRegistration,
  createServiceClient,
  discoverPlatform,
  readRegistrationInitiation,
  registerTool,
} from "../src/tool/index.js";
import {
  clientAssertion,
  TOOL_CLIENT_ID,
  TOOL_DEPLOYMENT_ID,
  TOOL_JWKS_URL,
  TOOL_LAUNCH_URL,
  TOOL_LOGIN_URL,
  TOOL_ORIGIN,
  TOOL_REDIRECT_URI,
  tokenRequest,
} from "./fake-tool.js";
import { generateKeyPair, request } from "./fixture.js";
import { call, json } from "./platform-services.js";
import {
  ASSET_ORIGIN,
  config,
  handle,
  PLATFORM_ORIGIN,
  PLAYER_ORIGIN,
  previousHintKey,
  type Setup,
  setup,
  toolKeys,
} from "./platform-setup.js";
import { MemoryRoster } from "./roster-stores.js";
import { textOf } from "./text-of.js";

const SECONDS = 1_700_000_000;
const ISSUER = `${PLATFORM_ORIGIN}/tenant-1`;
const CONFIGURATION_URL = `${ISSUER}/.well-known/openid-configuration`;
const REGISTRATION_URL = `${PLATFORM_ORIGIN}/registration`;
const TOOL_LTI = "https://purl.imsglobal.org/spec/lti-tool-configuration";
const PLATFORM_LTI = "https://purl.imsglobal.org/spec/lti-platform-configuration";
const INITIATION_URL = `${TOOL_ORIGIN}/lti/register?institution=7`;

/** The key set of a platform that serves Dynamic Registration, which needs RS256 among the algorithms of an `id_token`. */
const rsaPlatform = await generateKeyPair("platform-rsa-1");

/** A platform whose issuer is a tenant on its origin, signing with RS256, with the instance that names its product. */
const drConfig: PlatformConfig = {
  ...config,
  issuer: ISSUER,
  keys: {
    signer: createCryptoKeySigner(rsaPlatform.privateKey, { algorithm: "RS256", keyId: rsaPlatform.kid }),
    publicKeys: [rsaPlatform.publicJwk],
  },
  instance: { guid: "platform-instance-1", productFamilyCode: "interopkit-tests", version: "2.1" },
};

/** One call to the store of registrations. */
interface RegistrationCall {
  readonly method: string;
  readonly args: readonly unknown[];
  readonly signal: AbortSignal | undefined;
}

/**
 * The registrations of a platform in memory: a new registration gets the next client identifier, an update stays pending as
 * Dynamic Registration 1.0 section 4 allows and the answer shows it, and a tool named "Refused tool" is refused. It records every
 * call.
 */
const REFUSAL = { reason: "invalid_client_metadata", message: "The platform registers no tool of that name." } as const;
const ADDRESS_REFUSAL = {
  reason: "invalid_redirect_uri",
  message: "The platform registers no redirect URI of that tool.",
} as const;

class MemoryRegistrations implements RegistrationStore {
  readonly calls: RegistrationCall[] = [];
  readonly tools = new Map<string, RegisteredTool>();
  readonly pending = new Map<string, ToolConfiguration>();
  private readonly ids = [TOOL_CLIENT_ID, "tool-client-9"];

  async register(configuration: ToolConfiguration, options?: CallOptions) {
    this.calls.push({ method: "register", args: [configuration], signal: options?.signal });
    if (configuration.clientName === "Refused tool") return REFUSAL;
    if (configuration.clientName === "Refused address") return ADDRESS_REFUSAL;
    const tool = { clientId: this.ids.shift() ?? "tool-client-x", configuration };
    this.tools.set(tool.clientId, tool);
    return tool;
  }

  async get(clientId: string, options?: CallOptions) {
    this.calls.push({ method: "get", args: [clientId], signal: options?.signal });
    return this.tools.get(clientId);
  }

  async update(clientId: string, configuration: ToolConfiguration, options?: CallOptions) {
    this.calls.push({ method: "update", args: [clientId, configuration], signal: options?.signal });
    if (!this.tools.has(clientId)) return undefined;
    if (configuration.clientName === "Refused tool") return REFUSAL;
    if (configuration.clientName === "Refused address") return ADDRESS_REFUSAL;
    this.pending.set(clientId, configuration);
    return { clientId, configuration };
  }
}

/** The methods of a store of registrations, with some replaced. */
function storeWith(store: MemoryRegistrations, change: Partial<RegistrationStore>): RegistrationStore {
  return {
    register: (configuration, options) => store.register(configuration, options),
    get: (clientId, options) => store.get(clientId, options),
    update: (clientId, configuration, options) => store.update(clientId, configuration, options),
    ...change,
  };
}

/** A platform that serves Dynamic Registration over registrations in memory, and the roster, so that it offers a service. */
function registering(
  change: Partial<PlatformRequestOptions> = {},
): Setup & { readonly registrations: MemoryRegistrations } {
  const ctx = setup();
  const registrations = new MemoryRegistrations();
  Object.assign(ctx.requests, {
    config: drConfig,
    services: { registrations, roster: new MemoryRoster(TOOL_CLIENT_ID) },
    ...change,
  });
  return Object.assign(ctx, { registrations });
}

/** The registration that the tool of the tests asks for, as Dynamic Registration 1.0 section 2.2 has it. */
function toolRequest(change: Record<string, unknown> = {}, lti: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    application_type: "web",
    response_types: ["id_token"],
    grant_types: ["implicit", "client_credentials"],
    initiate_login_uri: TOOL_LOGIN_URL,
    redirect_uris: [TOOL_REDIRECT_URI],
    client_name: "Drawing tool",
    "client_name#ja": "お絵かき",
    jwks_uri: TOOL_JWKS_URL,
    logo_uri: `${TOOL_ORIGIN}/logo.png`,
    token_endpoint_auth_method: "private_key_jwt",
    scope: `${SCOPES.contextMembershipReadonly} ${SCOPES.score} https://example.com/scope/other`,
    [TOOL_LTI]: {
      domain: "tool.example.com",
      target_link_uri: TOOL_LAUNCH_URL,
      custom_parameters: { exam: "$Context.id" },
      claims: ["iss", "sub", "name"],
      messages: [{ type: "LtiDeepLinkingRequest", target_link_uri: `${TOOL_ORIGIN}/lti/dl` }],
      ...lti,
    },
    ...change,
  };
}

/** The registration token of a new initiation of the platform. */
async function registrationToken(ctx: Setup): Promise<string> {
  const url = new URL(await buildRegistrationInitiation(INITIATION_URL, { config: drConfig, clock: ctx.clock }));
  return url.searchParams.get("registration_token") ?? "";
}

/** Posts a registration request with a token, which `null` leaves out. */
async function register(
  ctx: Setup,
  body: unknown,
  token: string | null,
  options: { readonly type?: string; readonly change?: Partial<PlatformRequestOptions> } = {},
) {
  const posted = call(REGISTRATION_URL, token ?? undefined, {
    method: "POST",
    type: options.type ?? "application/json",
    body,
  });
  return handle(ctx, posted, options.change);
}

describe("buildRegistrationInitiation", () => {
  it("adds the configuration below the issuer and a registration token for an hour to the tool's initiation URL", async () => {
    const ctx = setup();
    const url = new URL(await buildRegistrationInitiation(INITIATION_URL, { config: drConfig, clock: ctx.clock }));
    expect(`${url.origin}${url.pathname}`).toBe(`${TOOL_ORIGIN}/lti/register`);
    expect(url.searchParams.get("institution")).toBe("7");
    expect(url.searchParams.get("openid_configuration")).toBe(CONFIGURATION_URL);
    const sealed = await openToken(url.searchParams.get("registration_token") ?? "", "registration", [
      drConfig.hintKey,
    ]);
    expect(sealed).toEqual({ id: expect.stringMatching(/^[\w-]{27}$/u), exp: SECONDS + 3600 });
    const shorter = new URL(
      await buildRegistrationInitiation(INITIATION_URL, { config: drConfig, clock: ctx.clock, ttlSeconds: 600 }),
    );
    const opened = await openToken(shorter.searchParams.get("registration_token") ?? "", "registration", [
      drConfig.hintKey,
    ]);
    expect(opened?.exp).toBe(SECONDS + 600);
  });

  it("refuses a platform that cannot serve Dynamic Registration, and arguments of other types", async () => {
    const ctx = setup();
    const clock = ctx.clock;
    for (const platform of [
      { ...drConfig, issuer: "https://platform.example" },
      { ...drConfig, keys: config.keys },
      { ...drConfig, instance: { guid: "platform-instance-1" } },
    ]) {
      await expect(buildRegistrationInitiation(INITIATION_URL, { config: platform, clock })).rejects.toThrow(DataError);
    }
    await expect(
      buildRegistrationInitiation("http://tool.example.com/register", { config: drConfig, clock }),
    ).rejects.toThrow(DataError);
    for (const text of ["null", "5", "[]"]) {
      await expect(buildRegistrationInitiation(JSON.parse(text), { config: drConfig, clock })).rejects.toThrow(
        DataError,
      );
      await expect(buildRegistrationInitiation(INITIATION_URL, JSON.parse(text))).rejects.toThrow(DataError);
    }
  });
});

describe("the OpenID configuration", () => {
  it("is served below the issuer with the endpoints, the algorithms, the scopes offered and the variables of the platform", async () => {
    const ctx = registering({
      substitution: { names: ["CourseSection.timeFrame.end"], resolve: async () => undefined },
    });
    const answer = await handle(ctx, call(CONFIGURATION_URL, undefined));
    expect(answer.status).toBe(200);
    const body = json(answer);
    expect(body).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${PLATFORM_ORIGIN}/authorize`,
      token_endpoint: `${PLATFORM_ORIGIN}/token`,
      jwks_uri: `${PLATFORM_ORIGIN}/jwks`,
      registration_endpoint: REGISTRATION_URL,
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
      token_endpoint_auth_signing_alg_values_supported: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
      scopes_supported: ["openid", SCOPES.contextMembershipReadonly, SCOPES.registrationReadonly, SCOPES.registration],
      response_types_supported: ["id_token"],
      id_token_signing_alg_values_supported: ["RS256"],
      subject_types_supported: ["public"],
      claims_supported: [
        "iss",
        "sub",
        "name",
        "given_name",
        "family_name",
        "middle_name",
        "email",
        "email_verified",
        "picture",
        "locale",
      ],
      [PLATFORM_LTI]: {
        product_family_code: "interopkit-tests",
        version: "2.1",
        messages_supported: [
          { type: "LtiResourceLinkRequest" },
          { type: "LtiDeepLinkingRequest" },
          { type: "LtiSubmissionReviewRequest" },
          { type: "LtiStartProctoring" },
          { type: "LtiEndAssessment" },
        ],
      },
    });
    const { variables } = body[PLATFORM_LTI];
    expect(variables).toContain("User.id");
    expect(variables).toContain("LineItem.url");
    expect(variables.at(-1)).toBe("CourseSection.timeFrame.end");
    expect(readPlatformConfiguration(body).issuer).toBe(ISSUER);
  });

  it("says what discovery says of the messages, the claims and the kinds of subject", async () => {
    const discovery = {
      messagesSupported: [{ type: "LtiDeepLinkingRequest", placements: ["ContentArea"] }],
      claimsSupported: ["iss", "sub"],
      subjectTypesSupported: ["pairwise"],
    };
    const body = json(await handle(registering({ discovery }), call(CONFIGURATION_URL, undefined)));
    expect(body).toMatchObject({ claims_supported: ["iss", "sub"], subject_types_supported: ["pairwise"] });
    expect(body[PLATFORM_LTI].messages_supported).toEqual([
      { type: "LtiDeepLinkingRequest", placements: ["ContentArea"] },
    ]);
  });

  it("exists only with the store of registrations, and answers only a GET", async () => {
    expect((await handle(setup(), call(`${PLATFORM_ORIGIN}/.well-known/openid-configuration`, undefined))).status).toBe(
      404,
    );
    const ctx = registering();
    expect((await handle(ctx, call(CONFIGURATION_URL, undefined, { method: "POST" }))).status).toBe(405);
    expect((await handle(ctx, call(`${PLATFORM_ORIGIN}/.well-known/openid-configuration`, undefined))).status).toBe(
      404,
    );
  });

  it("is refused for a platform whose issuer is not on its origin, that does not sign with RS256 or names no product", async () => {
    const registrations = new MemoryRegistrations();
    for (const platform of [
      { ...drConfig, issuer: "https://platform.example" },
      { ...drConfig, keys: config.keys },
      { ...drConfig, instance: undefined },
    ]) {
      await expect(
        handle(setup(), call(CONFIGURATION_URL, undefined), { config: platform, services: { registrations } }),
      ).rejects.toThrow("Dynamic Registration needs");
    }
  });
});

describe("the registration endpoint", () => {
  it("registers a valid configuration with its scopes narrowed to those offered, and answers its client and its endpoint", async () => {
    const ctx = registering();
    const answer = await register(ctx, toolRequest(), await registrationToken(ctx));
    expect(answer.status, textOf(answer.body)).toBe(201);
    expect(answer.headers["cache-control"]).toBe("no-store");
    const body = json(answer);
    expect(body).toMatchObject({
      client_id: TOOL_CLIENT_ID,
      registration_client_uri: `${REGISTRATION_URL}/${TOOL_CLIENT_ID}`,
      scope: SCOPES.contextMembershipReadonly,
      client_name: "Drawing tool",
      "client_name#ja": "お絵かき",
      [TOOL_LTI]: { domain: "tool.example.com", custom_parameters: { exam: "$Context.id" } },
    });
    expect(body).not.toHaveProperty("registration_access_token");
    expect(readToolRegistrationResult(body).clientId).toBe(TOOL_CLIENT_ID);
    const [registered] = ctx.registrations.calls;
    expect(registered).toMatchObject({ method: "register", args: [{ scope: SCOPES.contextMembershipReadonly }] });
  });

  it("drops the scope of a registration that asks for none that the platform offers", async () => {
    const ctx = registering();
    await register(ctx, toolRequest({ scope: "https://example.com/scope/other" }), await registrationToken(ctx));
    expect(ctx.registrations.calls[0]?.args[0]).not.toHaveProperty("scope");
  });

  it("accepts a registration token once: a second registration with it is refused before the body is read", async () => {
    const ctx = registering();
    const token = await registrationToken(ctx);
    expect((await register(ctx, toolRequest(), token)).status).toBe(201);
    const again = await register(ctx, "not JSON", token);
    expect(again.status).toBe(401);
    expect(again.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
    expect(ctx.registrations.calls).toHaveLength(1);
  });

  it("spends the token of a configuration that it refuses, so the tool starts again from the initiation", async () => {
    const ctx = registering();
    const token = await registrationToken(ctx);
    expect((await register(ctx, toolRequest({ grant_types: ["implicit"] }), token)).status).toBe(400);
    expect((await register(ctx, toolRequest(), token)).status).toBe(401);
  });

  it("refuses a request without a token, unless openRegistration is set", async () => {
    const ctx = registering();
    const refused = await register(ctx, toolRequest(), null);
    expect(refused.status).toBe(401);
    expect(json(refused)).toMatchObject({ error: "invalid_token" });
    const open = await register(ctx, toolRequest(), null, { change: { openRegistration: true } });
    expect(open.status).toBe(201);
  });

  it("refuses a token of another key, of another use, or past its hour, and takes one of an earlier hint key", async () => {
    const ctx = registering();
    const other = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const fields = { id: "registration-1", exp: SECONDS + 3600 };
    for (const token of [
      "registration-1",
      await sealToken("registration", fields, other),
      await sealToken("access", fields, drConfig.hintKey),
      await sealToken("registration", { id: "registration-2", exp: SECONDS }, drConfig.hintKey),
    ]) {
      expect((await register(ctx, toolRequest(), token)).status).toBe(401);
    }
    expect((await register(ctx, toolRequest(), await sealToken("registration", fields, previousHintKey))).status).toBe(
      201,
    );
    const expiring = await registrationToken(ctx);
    ctx.clock.advance(3600);
    expect((await register(ctx, toolRequest(), expiring)).status).toBe(401);
  });

  it("refuses another media type, a body above the limit, and a configuration that breaks section 2.2", async () => {
    const ctx = registering({ openRegistration: true });
    expect((await register(ctx, toolRequest(), null, { type: "text/plain" })).status).toBe(415);
    expect((await register(ctx, toolRequest({ client_name: "x".repeat(65_536) }), null)).status).toBe(413);
    for (const body of [
      toolRequest({ grant_types: ["implicit"] }),
      toolRequest({ response_types: ["code"] }),
      toolRequest({ token_endpoint_auth_method: "client_secret_basic" }),
      toolRequest({ jwks_uri: "http://tool.example.com/jwks" }),
      toolRequest({}, { domain: "https://tool.example.com" }),
      "{",
    ]) {
      const refused = await register(ctx, body, null);
      expect(refused.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(json(refused)).toMatchObject({ error: "invalid_client_metadata" });
    }
    expect(ctx.registrations.calls).toEqual([]);
  });

  it("refuses an address that names no public host or lies on an origin of the platform", async () => {
    const ctx = registering({ openRegistration: true });
    for (const uri of [
      "https://localhost/launch",
      "https://10.0.0.1/launch",
      `${PLATFORM_ORIGIN}/launch`,
      `${PLAYER_ORIGIN}/launch`,
      `${ASSET_ORIGIN}/launch`,
    ]) {
      const refused = await register(ctx, toolRequest({ redirect_uris: [TOOL_REDIRECT_URI, uri] }), null);
      expect(json(refused), uri).toMatchObject({ error: "invalid_redirect_uri" });
    }
    for (const change of [
      { jwks_uri: "https://169.254.169.254/jwks" },
      { initiate_login_uri: `${PLAYER_ORIGIN}/login` },
      { "logo_uri#ja": "https://intranet/logo.png" },
      { tos_uri: "https://192.168.0.1/tos" },
    ]) {
      const refused = await register(ctx, toolRequest(change), null);
      expect(json(refused), JSON.stringify(change)).toMatchObject({ error: "invalid_client_metadata" });
    }
    for (const lti of [
      { target_link_uri: `${PLATFORM_ORIGIN}/x` },
      { messages: [{ type: "LtiDeepLinkingRequest", icon_uri: "https://localhost/i.png" }] },
    ]) {
      const refused = await register(ctx, toolRequest({}, lti), null);
      expect(json(refused), JSON.stringify(lti)).toMatchObject({ error: "invalid_client_metadata" });
    }
    expect(ctx.registrations.calls).toEqual([]);
  });

  it("answers the refusal of the store with 400, its failure with 500, and throws when it breaks its contract", async () => {
    const ctx = registering({ openRegistration: true });
    const refused = await register(ctx, toolRequest({ client_name: "Refused tool" }), null);
    expect(json(refused)).toEqual({
      error: "invalid_client_metadata",
      error_description: "The platform registers no tool of that name.",
    });
    const redirect = await register(ctx, toolRequest({ client_name: "Refused address" }), null);
    expect(redirect.status).toBe(400);
    expect(json(redirect)).toEqual({
      error: "invalid_redirect_uri",
      error_description: "The platform registers no redirect URI of that tool.",
    });
    const failing = storeWith(ctx.registrations, {
      register: () => Promise.reject(new Error("The database is down.")),
    });
    const failed = await register(ctx, toolRequest(), null, { change: { services: { registrations: failing } } });
    expect(failed.status).toBe(500);
    expect(textOf(failed.body)).not.toContain("database");
    for (const answer of [
      { clientId: "", configuration: {} },
      { reason: "no_such_code", message: "No." },
      { reason: "invalid_client_metadata", message: 5 },
      { reason: "invalid_client_metadata", message: "" },
      { clientId: "c", configuration: { clientName: 5 } },
    ]) {
      const broken = storeWith(ctx.registrations, { register: async () => answer as never });
      await expect(
        register(ctx, toolRequest(), null, { change: { services: { registrations: broken } } }),
      ).rejects.toThrow("RegistrationStore.register breaks its contract");
    }
  });

  it("passes the signal of the request to the store, fails closed when once fails, and answers only a POST", async () => {
    const ctx = registering({ openRegistration: true });
    const signal = new AbortController().signal;
    await register(ctx, toolRequest(), null, { change: { signal } });
    expect(ctx.registrations.calls[0]?.signal).toBe(signal);
    const token = await registrationToken(ctx);
    const failing = await register(ctx, toolRequest(), token, {
      change: { once: () => Promise.reject(new Error("down")) },
    });
    expect(failing.status).toBe(500);
    await expect(
      register(ctx, toolRequest(), token, { change: { once: async () => "yes" as unknown as boolean } }),
    ).rejects.toThrow("The option once must resolve with a boolean");
    const read = await handle(ctx, call(REGISTRATION_URL, undefined));
    expect(read.status).toBe(405);
    expect((await handle(setup(), call(REGISTRATION_URL, undefined, { method: "POST" }))).status).toBe(404);
  });
});

/** A platform with the first tool registered and activated, granted the scopes of `lti-reg`, and a token of `scope`. */
async function activated(scope: string): Promise<Setup & { registrations: MemoryRegistrations; token: string }> {
  const ctx = registering({ openRegistration: true });
  await register(ctx, toolRequest(), null);
  const registered = ctx.registrations.tools.get(TOOL_CLIENT_ID);
  if (registered === undefined) throw new Error("The tool is not registered.");
  ctx.tools.set(
    TOOL_CLIENT_ID,
    buildToolRegistration(registered, {
      scopes: [SCOPES.registrationReadonly, SCOPES.registration],
      deploymentIds: [TOOL_DEPLOYMENT_ID],
    }),
  );
  const assertion = await clientAssertion(toolKeys, `${PLATFORM_ORIGIN}/token`, ctx.clock);
  const granted = await handle(ctx, tokenRequest(`${PLATFORM_ORIGIN}/token`, assertion, scope));
  expect(granted.status, textOf(granted.body)).toBe(200);
  return Object.assign(ctx, { token: JSON.parse(textOf(granted.body)).access_token as string });
}

const CLIENT_URL = `${REGISTRATION_URL}/${TOOL_CLIENT_ID}`;

describe("the client configuration endpoint", () => {
  it("is not offered by a store without get and update: no address in the answer, no route and no scope of lti-reg", async () => {
    const ctx = registering({ openRegistration: true });
    const { registrations } = ctx;
    const change = { services: { registrations: { register: registrations.register.bind(registrations) } } };
    const answer = await register(ctx, toolRequest(), null, { change });
    expect(answer.status, textOf(answer.body)).toBe(201);
    expect(json(answer)).not.toHaveProperty("registration_client_uri");
    const configuration = json(await handle(ctx, call(CONFIGURATION_URL, undefined), change));
    expect(configuration.scopes_supported).toEqual(["openid"]);
    expect((await handle(ctx, call(CLIENT_URL, undefined), change)).status).toBe(404);
  });

  it("serves only the method that the store has, and offers only the scope that it needs", async () => {
    const ctx = await activated(SCOPES.registrationReadonly);
    const { registrations } = ctx;
    const change = {
      services: {
        registrations: {
          register: registrations.register.bind(registrations),
          get: registrations.get.bind(registrations),
        },
      },
    };
    expect((await handle(ctx, call(CLIENT_URL, ctx.token), change)).status).toBe(200);
    const body = { client_id: TOOL_CLIENT_ID, ...toolRequest() };
    const put = await handle(
      ctx,
      call(CLIENT_URL, ctx.token, { method: "PUT", type: "application/json", body }),
      change,
    );
    expect([put.status, put.headers.allow]).toEqual([405, "GET"]);
    const configuration = json(await handle(ctx, call(CONFIGURATION_URL, undefined), change));
    expect(configuration.scopes_supported).toEqual(["openid", SCOPES.registrationReadonly]);
    for (const broken of [{ get: registrations.get }, { register: registrations.register, update: "update" }]) {
      await expect(
        handle(ctx, call(CLIENT_URL, ctx.token), { services: { registrations: broken as never } }),
      ).rejects.toThrow(DataError);
    }
  });

  it("answers the calling tool's registration to a token of registration.readonly", async () => {
    const ctx = await activated(SCOPES.registrationReadonly);
    const answer = await handle(ctx, call(CLIENT_URL, ctx.token));
    expect(answer.status).toBe(200);
    expect(json(answer)).toMatchObject({ client_id: TOOL_CLIENT_ID, registration_client_uri: CLIENT_URL });
    expect(ctx.registrations.calls.at(-1)).toMatchObject({ method: "get", args: [TOOL_CLIENT_ID] });
  });

  it("answers 404 for the registration of another tool, and for one that the store does not have", async () => {
    const ctx = await activated(SCOPES.registrationReadonly);
    expect((await register(ctx, toolRequest({ client_name: "Another tool" }), null)).status).toBe(201);
    expect(ctx.registrations.tools.has("tool-client-9")).toBe(true);
    expect((await handle(ctx, call(`${REGISTRATION_URL}/tool-client-9`, ctx.token))).status).toBe(404);
    ctx.registrations.tools.clear();
    expect((await handle(ctx, call(CLIENT_URL, ctx.token))).status).toBe(404);
  });

  it("gives an update to the store with its scopes narrowed, and answers the pending configuration", async () => {
    const ctx = await activated(SCOPES.registration);
    const body = { client_id: TOOL_CLIENT_ID, ...toolRequest({ client_name: "Drawing tool 2" }) };
    const answer = await handle(ctx, call(CLIENT_URL, ctx.token, { method: "PUT", type: "application/json", body }));
    expect(answer.status, textOf(answer.body)).toBe(200);
    expect(json(answer)).toMatchObject({ client_id: TOOL_CLIENT_ID, client_name: "Drawing tool 2" });
    expect(ctx.registrations.pending.get(TOOL_CLIENT_ID)).toMatchObject({
      clientName: "Drawing tool 2",
      scope: SCOPES.contextMembershipReadonly,
    });
  });

  it("refuses an update that names another client, breaks the rules or is refused, and one with a read-only token", async () => {
    const ctx = await activated(SCOPES.registration);
    const put = (body: unknown, token = ctx.token) =>
      handle(ctx, call(CLIENT_URL, token, { method: "PUT", type: "application/json", body }));
    expect(json(await put({ client_id: "tool-client-9", ...toolRequest() }))).toMatchObject({
      error: "invalid_client_metadata",
    });
    expect(json(await put(toolRequest({ jwks_uri: "https://localhost/jwks" })))).toMatchObject({
      error: "invalid_client_metadata",
    });
    expect(json(await put(toolRequest({ client_name: "Refused tool" })))).toMatchObject({
      error: "invalid_client_metadata",
    });
    const reader = await activated(SCOPES.registrationReadonly);
    const forbidden = await handle(
      reader,
      call(CLIENT_URL, reader.token, { method: "PUT", type: "application/json", body: toolRequest() }),
    );
    expect(forbidden.status).toBe(403);
  });

  it("throws when the store changes the client identifier of a registration", async () => {
    const ctx = await activated(SCOPES.registration);
    const moved = async (_clientId: string, configuration: ToolConfiguration) => ({
      clientId: "tool-client-9",
      configuration,
    });
    const services = { registrations: storeWith(ctx.registrations, { update: moved }) };
    const posted = call(CLIENT_URL, ctx.token, { method: "PUT", type: "application/json", body: toolRequest() });
    await expect(handle(ctx, posted, { services })).rejects.toThrow("changed the client identifier");
  });
});

describe("buildToolRegistration", () => {
  it("makes the registration of a tool from what the tool registered and what the administrator grants", async () => {
    const ctx = registering({ openRegistration: true });
    await register(ctx, toolRequest(), null);
    const registered = ctx.registrations.tools.get(TOOL_CLIENT_ID);
    if (registered === undefined) throw new Error("The tool is not registered.");
    expect(buildToolRegistration(registered, { scopes: [SCOPES.score], deploymentIds: ["d-1", "d-2"] })).toEqual({
      clientId: TOOL_CLIENT_ID,
      deploymentIds: ["d-1", "d-2"],
      loginUrl: TOOL_LOGIN_URL,
      redirectUris: [TOOL_REDIRECT_URI],
      jwksUrl: TOOL_JWKS_URL,
      scopes: [SCOPES.score],
      custom: { exam: "$Context.id" },
    });
  });

  it("refuses a grant without a deployment, a registration that is not one, and arguments of other types", async () => {
    const ctx = registering({ openRegistration: true });
    await register(ctx, toolRequest(), null);
    const registered = ctx.registrations.tools.get(TOOL_CLIENT_ID);
    if (registered === undefined) throw new Error("The tool is not registered.");
    expect(() => buildToolRegistration(registered, { scopes: [], deploymentIds: [] })).toThrow(DataError);
    expect(() =>
      buildToolRegistration(
        { ...registered, configuration: { ...registered.configuration, jwksUri: "http://x.example" } },
        {
          scopes: [],
          deploymentIds: ["d-1"],
        },
      ),
    ).toThrow(DataError);
    for (const text of ["null", "5", "[]", '{"clientId":""}']) {
      expect(() => buildToolRegistration(JSON.parse(text), { scopes: [], deploymentIds: ["d-1"] })).toThrow(DataError);
      expect(() => buildToolRegistration(registered, JSON.parse(text))).toThrow(DataError);
    }
  });
});

describe("a tool of this package and this platform", () => {
  it("register the tool from the initiation to the activation on both sides, and the tool reads its registration back", async () => {
    const ctx = registering();
    // The tool's server reaches the platform's handler through this fetch.
    const fetch: Fetch = async (url, init) => {
      const body = typeof init.body === "string" ? init.body : textOf(init.body);
      const answer = await handle(ctx, request({ url, method: init.method, headers: { ...init.headers }, body }));
      return new Response(answer.body as BodyInit, { status: answer.status, headers: answer.headers });
    };
    const opened = await buildRegistrationInitiation(INITIATION_URL, { config: drConfig, clock: ctx.clock });
    const initiation = readRegistrationInitiation(request({ url: opened }));
    const platform = await discoverPlatform(initiation, { fetch });
    expect(platform).toMatchObject({ issuer: ISSUER, registrationEndpoint: REGISTRATION_URL });
    const result = await registerTool(
      platform,
      {
        initiateLoginUri: TOOL_LOGIN_URL,
        redirectUris: [TOOL_REDIRECT_URI],
        clientName: "Drawing tool",
        jwksUri: TOOL_JWKS_URL,
        scope: `${SCOPES.registrationReadonly} ${SCOPES.score}`,
        lti: { domain: "tool.example.com", targetLinkUri: TOOL_LAUNCH_URL, messages: [], claims: ["iss", "sub"] },
      },
      initiation,
      { fetch },
    );
    expect(result).toMatchObject({ clientId: TOOL_CLIENT_ID, scope: SCOPES.registrationReadonly });
    const registered = ctx.registrations.tools.get(result.clientId);
    if (registered === undefined) throw new Error("The platform did not keep the registration.");
    ctx.tools.set(
      result.clientId,
      buildToolRegistration(registered, { scopes: [SCOPES.registrationReadonly], deploymentIds: [TOOL_DEPLOYMENT_ID] }),
    );
    const signer = createCryptoKeySigner(toolKeys.privateKey, { algorithm: "RS256", keyId: toolKeys.kid });
    const record = buildPlatformRegistration(platform, result, {
      signer,
      redirectUri: TOOL_REDIRECT_URI,
      deploymentIds: [TOOL_DEPLOYMENT_ID],
    });
    const client = createServiceClient(
      { issuer: ISSUER, clientId: result.clientId, deploymentId: TOOL_DEPLOYMENT_ID },
      { registration: async () => record, clock: ctx.clock, fetch, scopes: [SCOPES.registrationReadonly] },
    );
    await expect(client.getToolRegistration(result)).resolves.toMatchObject({
      clientId: TOOL_CLIENT_ID,
      clientName: "Drawing tool",
      registrationClientUri: `${REGISTRATION_URL}/${TOOL_CLIENT_ID}`,
    });
  });
});
