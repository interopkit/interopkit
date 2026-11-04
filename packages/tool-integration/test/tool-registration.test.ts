// biome-ignore-all lint/style/useNamingConvention: the names of the configurations of Dynamic Registration are those of the specification.

import { createCryptoKeySigner, DataError, type Fetch, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { type LtiMessage, SCOPES, type ToolRegistrationResult } from "../src/index.js";
import {
  buildPlatformRegistration,
  buildRegistrationClosePage,
  createServiceClient,
  discoverPlatform,
  handleLaunch,
  type RegistrationInitiation,
  readRegistrationInitiation,
  registerTool,
  type ToolConfigurationInput,
} from "../src/tool/index.js";
import { CLIENT_ID, DEPLOYMENT_ID, ISSUER, REDIRECT_URI, TOOL_ORIGIN } from "./fake-platform.js";
import { readPost, request } from "./fixture.js";
import { textOf } from "./text-of.js";
import { cookieLogin, type Setup, setup, toolKey } from "./tool-setup.js";

const PLATFORM_LTI = "https://purl.imsglobal.org/spec/lti-platform-configuration";
const TOOL_LTI = "https://purl.imsglobal.org/spec/lti-tool-configuration";
const CONFIGURATION_URL = `${ISSUER}/.well-known/openid-configuration`;
const REGISTRATION_ENDPOINT = `${ISSUER}/connect/register`;
const CLIENT_URI = `${REGISTRATION_ENDPOINT}/${CLIENT_ID}`;
const INITIATION_URL = `${TOOL_ORIGIN}/lti/register`;

/** The OpenID configuration of the platform, with the properties that Dynamic Registration 1.0 section 2.1 requires. */
function configuration(change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/auth`,
    token_endpoint: `${ISSUER}/token`,
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256"],
    jwks_uri: `${ISSUER}/jwks`,
    registration_endpoint: REGISTRATION_ENDPOINT,
    scopes_supported: ["openid", SCOPES.registration],
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    claims_supported: ["sub", "iss"],
    [PLATFORM_LTI]: { product_family_code: "lms-example", messages_supported: [{ type: "LtiResourceLinkRequest" }] },
    ...change,
  };
}

/** The tool of the tests, as the host describes it. */
const tool: ToolConfigurationInput = {
  initiateLoginUri: `${TOOL_ORIGIN}/lti/login`,
  redirectUris: [REDIRECT_URI],
  clientName: "Drawing tool",
  jwksUri: `${TOOL_ORIGIN}/.well-known/jwks.json`,
  scope: SCOPES.score,
  lti: {
    domain: "tool.example.com",
    targetLinkUri: `${TOOL_ORIGIN}/lti/launch`,
    messages: [{ type: "LtiDeepLinkingRequest" }],
    claims: ["iss", "sub"],
  },
};

/** One request that reached the platform: its method, address, headers and body. */
interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * A platform's side of Dynamic Registration, written from sections 2 to 4 of the specification: the OpenID configuration at its
 * address, the registration endpoint, which answers the registration it recorded, and the client configuration endpoint. Its key set
 * and token endpoint are those of `FakePlatform`. It records every request.
 */
class FakeRegistrar {
  readonly sent: Sent[] = [];
  /** The configuration that the platform serves; a test replaces it. */
  document: Record<string, unknown> = configuration();
  /** What the registration endpoint adds to the registration it answers with; a test replaces it. */
  acknowledgment: Record<string, unknown> = { client_id: CLIENT_ID, registration_client_uri: CLIENT_URI };
  /** Replaces every answer while set. */
  answer: (() => Response) | undefined;
  private readonly ctx: Setup;

  constructor(ctx: Setup) {
    this.ctx = ctx;
  }

  readonly fetch: Fetch = async (url, init) => {
    if (url === `${ISSUER}/token` || url === `${ISSUER}/jwks`) return this.ctx.platform.fetch(url, init);
    expect(init.redirect).toBe("manual");
    this.sent.push({ method: init.method, url, headers: init.headers, body: textOf(init.body) });
    if (this.answer !== undefined) return this.answer();
    if (url.startsWith(CONFIGURATION_URL)) return Response.json(this.document);
    if (url.endsWith("/connect/register") || url === CLIENT_URI) {
      const asked = init.method === "GET" ? {} : JSON.parse(textOf(init.body));
      return Response.json(
        {
          application_type: "web",
          response_types: ["id_token"],
          grant_types: ["implict", "client_credentials"],
          initiate_login_uri: tool.initiateLoginUri,
          redirect_uris: [REDIRECT_URI],
          client_name: asked.client_name ?? tool.clientName,
          jwks_uri: tool.jwksUri,
          token_endpoint_auth_method: "private_key_jwt",
          [TOOL_LTI]: {
            domain: "tool.example.com",
            target_link_uri: `${TOOL_ORIGIN}/lti/launch`,
            claims: ["iss", "sub"],
            messages: [],
            deployment_id: DEPLOYMENT_ID,
          },
          ...this.acknowledgment,
        },
        { status: init.method === "POST" ? 201 : 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };
}

/** The initiation of the tests: the configuration and a registration token. */
const initiation: RegistrationInitiation = { openidConfiguration: CONFIGURATION_URL, registrationToken: "reg-token-1" };

/** The registration request of a platform: a GET of the initiation URL with its parameters. */
function initiationRequest(parameters: Readonly<Record<string, string>>, method = "GET") {
  return request({ method, url: `${INITIATION_URL}?${new URLSearchParams(parameters)}` });
}

describe("readRegistrationInitiation", () => {
  it("reads the address of the configuration and the registration token", () => {
    expect(
      readRegistrationInitiation(
        initiationRequest({ openid_configuration: CONFIGURATION_URL, registration_token: "t-1" }),
      ),
    ).toEqual({ openidConfiguration: CONFIGURATION_URL, registrationToken: "t-1" });
    expect(readRegistrationInitiation(initiationRequest({ openid_configuration: CONFIGURATION_URL }))).toEqual({
      openidConfiguration: CONFIGURATION_URL,
    });
  });

  it("refuses another method, an address missing, given twice, not https or with a fragment, and an empty token", () => {
    const refused = [
      initiationRequest({ openid_configuration: CONFIGURATION_URL }, "POST"),
      initiationRequest({}),
      request({
        url: `${INITIATION_URL}?openid_configuration=${CONFIGURATION_URL}&openid_configuration=${CONFIGURATION_URL}`,
      }),
      initiationRequest({ openid_configuration: "http://lms.example.edu/.well-known/openid-configuration" }),
      initiationRequest({ openid_configuration: `${CONFIGURATION_URL}#x` }),
      initiationRequest({ openid_configuration: CONFIGURATION_URL, registration_token: "" }),
    ];
    for (const sent of refused) {
      expect(() => readRegistrationInitiation(sent)).toThrow(expect.objectContaining({ reason: "request-invalid" }));
    }
    for (const text of ["null", "5", "[]"])
      expect(() => readRegistrationInitiation(JSON.parse(text))).toThrow(DataError);
  });

  it("keeps the refusal of the address as the cause of the LtiError", () => {
    const sent = initiationRequest({ openid_configuration: "http://lms.example.edu/.well-known/openid-configuration" });
    expect(() => readRegistrationInitiation(sent)).toThrow(
      expect.objectContaining({ name: "LtiError", reason: "request-invalid", cause: expect.any(DataError) }),
    );
  });
});

describe("discoverPlatform", () => {
  it("fetches the configuration with the registration token and reads it", async () => {
    const registrar = new FakeRegistrar(setup());
    const platform = await discoverPlatform(initiation, { fetch: registrar.fetch });
    expect(platform).toMatchObject({ issuer: ISSUER, registrationEndpoint: REGISTRATION_ENDPOINT });
    expect(registrar.sent).toEqual([
      {
        method: "GET",
        url: CONFIGURATION_URL,
        headers: { accept: "application/json", authorization: "Bearer reg-token-1" },
        body: "",
      },
    ]);
  });

  it("accepts each address of a configuration that Dynamic Registration 3.4 calls valid", async () => {
    const issuer = "https://platform.example.com";
    const registrar = new FakeRegistrar(setup());
    for (const path of [
      "/.well-known/opendid-configuration",
      "/.well-known/opendid-configuration?r=7462647772",
      "/.well-known/lti-opendid-configuration",
      "/lti/opendid-configuration",
      "/lti/opendid-configuration/reg/849021",
    ]) {
      registrar.answer = () => Response.json(configuration({ issuer }));
      await expect(
        discoverPlatform({ openidConfiguration: `${issuer}${path}` }, { fetch: registrar.fetch }),
      ).resolves.toMatchObject({
        issuer,
      });
    }
  });

  it("refuses each address that Dynamic Registration 3.4 calls invalid, look-alike hosts and paths outside the issuer", async () => {
    const registrar = new FakeRegistrar(setup());
    const cases: [issuer: string, address: string][] = [
      ["https://platform.example.com", "https://attacker.io/.well-known/opendid-configuration"],
      ["https://platform.example.com", "https://platform.example.org/.well-known/opendid-configuration"],
      ["https://platform.example.com", "https://lti.platform.example.com/opendid-configuration"],
      ["https://platform.example.com", "https://example.com/.well-known/opendid-configuration"],
      ["https://platform.example.com", "https://platform.example.com.evil.io/.well-known/openid-configuration"],
      [
        "https://platform.example.com/tenant",
        "https://platform.example.com/tenant-evil/.well-known/openid-configuration",
      ],
      [
        "https://platform.example.com/tenant",
        "https://platform.example.com/tenant/../other/.well-known/openid-configuration",
      ],
      ["https://platform.example.com/tenant", "https://platform.example.com/.well-known/openid-configuration"],
      ["https://platform.example.com", "https://platform.example.com:8443/.well-known/openid-configuration"],
    ];
    for (const [issuer, address] of cases) {
      registrar.answer = () => Response.json(configuration({ issuer }));
      await expect(
        discoverPlatform({ openidConfiguration: address }, { fetch: registrar.fetch }),
        address,
      ).rejects.toMatchObject({
        reason: "issuer-mismatch",
        status: 401,
      });
    }
  });

  it("fetches no address that names no public host, and refuses a configuration whose endpoints do not", async () => {
    const registrar = new FakeRegistrar(setup());
    for (const address of [
      "https://localhost/.well-known/openid-configuration",
      "https://127.0.0.1/.well-known/openid-configuration",
      "https://user@platform.example.com/.well-known/openid-configuration",
      "https://intranet/.well-known/openid-configuration",
    ]) {
      await expect(
        discoverPlatform({ openidConfiguration: address }, { fetch: registrar.fetch }),
      ).rejects.toMatchObject({
        reason: "service-origin-refused",
      });
    }
    expect(registrar.sent).toEqual([]);
    for (const change of [
      { jwks_uri: "https://169.254.169.254/jwks" },
      { token_endpoint: "https://localhost/token" },
      { registration_endpoint: "https://10.1.2.3/register" },
      { authorization_endpoint: "https://lms.internal/auth" },
    ]) {
      registrar.document = configuration(change);
      await expect(discoverPlatform(initiation, { fetch: registrar.fetch })).rejects.toMatchObject({
        reason: "service-origin-refused",
      });
    }
  });

  it("refuses a configuration that breaks section 2.1, an answer above its limits, and a redirect", async () => {
    const registrar = new FakeRegistrar(setup());
    for (const change of [
      { id_token_signing_alg_values_supported: ["ES256"] },
      { token_endpoint_auth_methods_supported: ["client_secret_basic"] },
      { [PLATFORM_LTI]: undefined },
      { issuer: `${ISSUER}?tenant=1` },
    ]) {
      registrar.document = configuration(change);
      await expect(discoverPlatform(initiation, { fetch: registrar.fetch })).rejects.toThrow(DataError);
    }
    registrar.document = configuration({ claims_supported: Array.from({ length: 20_000 }, () => "sub") });
    await expect(discoverPlatform(initiation, { fetch: registrar.fetch })).rejects.toThrow("maxBytes");
    await expect(
      discoverPlatform(initiation, { fetch: registrar.fetch, maxBytes: 1_048_576, maxTokens: 1000 }),
    ).rejects.toThrow("maxTokens");
    registrar.answer = () => new Response("", { status: 302, headers: { location: CONFIGURATION_URL } });
    await expect(discoverPlatform(initiation, { fetch: registrar.fetch })).rejects.toThrow(ServiceError);
  });

  it("refuses an initiation and options of other types", async () => {
    const registrar = new FakeRegistrar(setup());
    for (const text of [
      "null",
      "5",
      "[]",
      '{"openidConfiguration":5}',
      '{"openidConfiguration":"https://lms.example.edu/c","registrationToken":""}',
    ]) {
      await expect(discoverPlatform(JSON.parse(text), { fetch: registrar.fetch })).rejects.toThrow(DataError);
    }
    for (const text of ["null", "{}", '{"fetch":5}', '{"fetch":null}']) {
      await expect(discoverPlatform(initiation, JSON.parse(text))).rejects.toThrow(DataError);
    }
  });
});

describe("registerTool", () => {
  it("posts the configuration with what LTI fixes and the registration token, and returns the registration", async () => {
    const registrar = new FakeRegistrar(setup());
    const platform = await discoverPlatform(initiation, { fetch: registrar.fetch });
    const result = await registerTool(platform, tool, initiation, { fetch: registrar.fetch });
    expect(result).toMatchObject({ clientId: CLIENT_ID, registrationClientUri: CLIENT_URI });
    const posted = registrar.sent[1];
    expect(posted).toMatchObject({
      method: "POST",
      url: REGISTRATION_ENDPOINT,
      headers: { accept: "application/json", "content-type": "application/json", authorization: "Bearer reg-token-1" },
    });
    expect(JSON.parse(posted?.body ?? "")).toEqual({
      application_type: "web",
      response_types: ["id_token"],
      grant_types: ["implicit", "client_credentials"],
      initiate_login_uri: `${TOOL_ORIGIN}/lti/login`,
      redirect_uris: [REDIRECT_URI],
      client_name: "Drawing tool",
      jwks_uri: `${TOOL_ORIGIN}/.well-known/jwks.json`,
      token_endpoint_auth_method: "private_key_jwt",
      scope: SCOPES.score,
      [TOOL_LTI]: {
        domain: "tool.example.com",
        target_link_uri: `${TOOL_ORIGIN}/lti/launch`,
        messages: [{ type: "LtiDeepLinkingRequest" }],
        claims: ["iss", "sub"],
      },
    });
  });

  it("sends the token to no registration endpoint outside the issuer's origin, unless registrationOrigins names it", async () => {
    const registrar = new FakeRegistrar(setup());
    const platform = await discoverPlatform(initiation, { fetch: registrar.fetch });
    const elsewhere = { ...platform, registrationEndpoint: "https://register.lms.example.edu/connect/register" };
    await expect(registerTool(elsewhere, tool, initiation, { fetch: registrar.fetch })).rejects.toMatchObject({
      reason: "issuer-mismatch",
    });
    expect(registrar.sent).toHaveLength(1);
    await expect(
      registerTool(elsewhere, tool, initiation, {
        fetch: registrar.fetch,
        registrationOrigins: ["https://register.lms.example.edu"],
      }),
    ).resolves.toMatchObject({ clientId: CLIENT_ID });
    expect(registrar.sent.at(-1)?.url).toBe("https://register.lms.example.edu/connect/register");
  });

  it("refuses an answer whose client configuration endpoint is outside the issuer's origin", async () => {
    const registrar = new FakeRegistrar(setup());
    const platform = await discoverPlatform(initiation, { fetch: registrar.fetch });
    registrar.acknowledgment = { client_id: CLIENT_ID, registration_client_uri: "https://attacker.io/register/1" };
    await expect(registerTool(platform, tool, initiation, { fetch: registrar.fetch })).rejects.toMatchObject({
      reason: "issuer-mismatch",
    });
  });

  it("reports the refusal of the platform as a ServiceError with its body", async () => {
    const registrar = new FakeRegistrar(setup());
    const platform = await discoverPlatform(initiation, { fetch: registrar.fetch });
    registrar.answer = () =>
      Response.json({ error: "invalid_client_metadata", error_description: "No." }, { status: 400 });
    await expect(registerTool(platform, tool, initiation, { fetch: registrar.fetch })).rejects.toMatchObject({
      status: 400,
      body: expect.stringContaining("invalid_client_metadata"),
    });
  });

  it("refuses a tool that names what LTI fixes, breaks section 2.2, and arguments of other types, before it sends anything", async () => {
    const registrar = new FakeRegistrar(setup());
    const platform = await discoverPlatform(initiation, { fetch: registrar.fetch });
    for (const input of [
      { ...tool, applicationType: "web" },
      { ...tool, jwksUri: "http://tool.example.com/jwks" },
      { ...tool, redirectUris: [] },
      { ...tool, lti: { ...tool.lti, domain: "https://tool.example.com" } },
      { ...tool, lti: null },
      null,
    ]) {
      await expect(registerTool(platform, input as never, initiation, { fetch: registrar.fetch })).rejects.toThrow(
        DataError,
      );
    }
    await expect(registerTool(JSON.parse("{}"), tool, initiation, { fetch: registrar.fetch })).rejects.toThrow(
      DataError,
    );
    for (const origins of [
      ["https://lms.example.edu/connect"],
      ["http://lms.example.edu"],
      "https://lms.example.edu",
    ]) {
      await expect(
        registerTool(platform, tool, initiation, { fetch: registrar.fetch, registrationOrigins: origins as never }),
      ).rejects.toThrow("registrationOrigins");
    }
    expect(registrar.sent).toHaveLength(1);
  });
});

describe("buildPlatformRegistration", () => {
  it("makes the tool's record of the platform from its configuration and the registration", async () => {
    const ctx = setup();
    const registrar = new FakeRegistrar(ctx);
    const platform = await discoverPlatform(initiation, { fetch: registrar.fetch });
    const result = await registerTool(platform, tool, initiation, { fetch: registrar.fetch });
    const signer = createCryptoKeySigner(toolKey.privateKey, { algorithm: "RS256", keyId: toolKey.kid });
    expect(buildPlatformRegistration(platform, result, { signer, redirectUri: REDIRECT_URI })).toEqual({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      deploymentIds: [DEPLOYMENT_ID],
      authenticationUrl: `${ISSUER}/auth`,
      jwksUrl: `${ISSUER}/jwks`,
      accessTokenUrl: `${ISSUER}/token`,
      redirectUri: REDIRECT_URI,
      signer,
    });
    const audience = { ...platform, authorizationServer: `${ISSUER}/as` };
    expect(
      buildPlatformRegistration(audience, result, { signer, redirectUri: REDIRECT_URI, deploymentIds: ["d-2"] }),
    ).toMatchObject({
      audience: `${ISSUER}/as`,
      deploymentIds: ["d-2"],
    });
  });

  it("refuses a launch URL that is not a redirect URI of the registration, and a registration without a deployment", async () => {
    const registrar = new FakeRegistrar(setup());
    const platform = await discoverPlatform(initiation, { fetch: registrar.fetch });
    const result = await registerTool(platform, tool, initiation, { fetch: registrar.fetch });
    const signer = createCryptoKeySigner(toolKey.privateKey, { algorithm: "RS256", keyId: toolKey.kid });
    expect(() => buildPlatformRegistration(platform, result, { signer, redirectUri: `${TOOL_ORIGIN}/other` })).toThrow(
      DataError,
    );
    const withoutDeployment = { ...result, lti: { ...result.lti, deploymentId: undefined } };
    expect(() => buildPlatformRegistration(platform, withoutDeployment, { signer, redirectUri: REDIRECT_URI })).toThrow(
      "deploymentIds",
    );
    for (const text of ["null", "5", "{}"]) {
      expect(() => buildPlatformRegistration(platform, result, JSON.parse(text))).toThrow(DataError);
      expect(() =>
        buildPlatformRegistration(platform, JSON.parse(text), { signer, redirectUri: REDIRECT_URI }),
      ).toThrow(DataError);
    }
  });
});

describe("buildRegistrationClosePage", () => {
  it("answers with a page whose one script tells the platform's window that it may close", async () => {
    const page = await buildRegistrationClosePage();
    const { scripts, hash } = readPost(page);
    expect(scripts).toBe(1);
    expect(textOf(page.body)).toContain(
      '<script>(window.opener || window.parent).postMessage({ subject: "org.imsglobal.lti.close" }, "*");</script>',
    );
    expect(page.headers["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'`,
    );
    expect(page.headers["cache-control"]).toBe("no-store");
  });
});

/** A launch of the platform, for the client of its services. */
async function launched(ctx: Setup): Promise<LtiMessage> {
  const { request: post } = await cookieLogin(ctx);
  return (await handleLaunch(post, ctx.options)) as LtiMessage;
}

describe("the client of the client configuration endpoint", () => {
  const registration: ToolRegistrationResult = {
    clientId: CLIENT_ID,
    registrationClientUri: CLIENT_URI,
    applicationType: "web",
    responseTypes: ["id_token"],
    grantTypes: ["implicit", "client_credentials"],
    initiateLoginUri: tool.initiateLoginUri,
    redirectUris: [REDIRECT_URI],
    clientName: "Drawing tool",
    jwksUri: tool.jwksUri,
    tokenEndpointAuthMethod: "private_key_jwt",
    lti: tool.lti,
  };

  it("reads the registration with the registration access token that the platform gave, and asks for no token", async () => {
    const ctx = setup();
    const registrar = new FakeRegistrar(ctx);
    const client = createServiceClient(await launched(ctx), { ...ctx.options, fetch: registrar.fetch, scopes: [] });
    const read = await client.getToolRegistration({ ...registration, registrationAccessToken: "rat-1" });
    expect(read.clientId).toBe(CLIENT_ID);
    expect(registrar.sent).toMatchObject([
      { method: "GET", url: CLIENT_URI, headers: { authorization: "Bearer rat-1" } },
    ]);
    expect(ctx.platform.grants).toEqual([]);
  });

  it("reads the registration with a token of registration.readonly without a registration access token", async () => {
    const ctx = setup();
    const registrar = new FakeRegistrar(ctx);
    const scopes = [SCOPES.registrationReadonly, SCOPES.registration];
    const client = createServiceClient(await launched(ctx), { ...ctx.options, fetch: registrar.fetch, scopes });
    await client.getToolRegistration(registration);
    expect(ctx.platform.grants.map(({ scope }) => scope)).toEqual([SCOPES.registrationReadonly]);
    expect(registrar.sent[0]?.headers.authorization).toBe("Bearer access-token-1");
  });

  it("puts the new configuration with its client, with a token of registration, and returns what the platform answers", async () => {
    const ctx = setup();
    const registrar = new FakeRegistrar(ctx);
    const scopes = [SCOPES.registration];
    const client = createServiceClient(await launched(ctx), { ...ctx.options, fetch: registrar.fetch, scopes });
    const updated = await client.updateToolRegistration(registration, { ...tool, clientName: "Drawing tool 2" });
    expect(updated.clientName).toBe("Drawing tool 2");
    const [put] = registrar.sent;
    expect(put).toMatchObject({ method: "PUT", url: CLIENT_URI, headers: { "content-type": "application/json" } });
    expect(JSON.parse(put?.body ?? "")).toMatchObject({ client_id: CLIENT_ID, client_name: "Drawing tool 2" });
  });

  it("refuses an answer of another client, a registration without its endpoint, and an endpoint on a private host", async () => {
    const ctx = setup();
    const registrar = new FakeRegistrar(ctx);
    const client = createServiceClient(await launched(ctx), {
      ...ctx.options,
      fetch: registrar.fetch,
      scopes: [SCOPES.registration],
    });
    registrar.acknowledgment = { client_id: "another-client" };
    await expect(client.getToolRegistration(registration)).rejects.toThrow("another-client");
    const { registrationClientUri: _uri, ...without } = registration;
    await expect(client.getToolRegistration(without)).rejects.toThrow("registrationClientUri");
    await expect(
      client.getToolRegistration({ ...registration, registrationClientUri: "https://localhost/register" }),
    ).rejects.toMatchObject({ reason: "service-origin-refused" });
    for (const text of ["null", "5", "{}"]) {
      await expect(client.getToolRegistration(JSON.parse(text))).rejects.toThrow(DataError);
      await expect(client.updateToolRegistration(registration, JSON.parse(text))).rejects.toThrow(DataError);
    }
  });
});
