// biome-ignore-all lint/style/useNamingConvention: the names of the configurations of Dynamic Registration are those of the specification.

import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PlatformConfiguration, ToolConfiguration, ToolRegistrationResult } from "../src/index.js";
import {
  readPlatformConfiguration,
  readToolConfiguration,
  readToolRegistrationResult,
  writePlatformConfiguration,
  writeToolConfiguration,
  writeToolRegistrationResult,
} from "../src/protocol/internal.js";
import { FUZZ, fuzzJson } from "./fuzz.js";
import { expectRefusals, expectRefusesOtherTypes, plainJson } from "./services.js";

const PLATFORM_LTI = "https://purl.imsglobal.org/spec/lti-platform-configuration";
const TOOL_LTI = "https://purl.imsglobal.org/spec/lti-tool-configuration";

/** The properties that Dynamic Registration 1.0 section 2.1.1 requires of a platform. */
const platform = {
  issuer: "https://server.example.com",
  authorization_endpoint: "https://server.example.com/connect/authorize",
  token_endpoint: "https://server.example.com/connect/token",
  token_endpoint_auth_methods_supported: ["private_key_jwt"],
  token_endpoint_auth_signing_alg_values_supported: ["RS256"],
  jwks_uri: "https://server.example.com/jwks.json",
  registration_endpoint: "https://server.example.com/connect/register",
  scopes_supported: ["openid", "https://purl.imsglobal.org/spec/lti-ags/scope/score"],
  response_types_supported: ["id_token"],
  subject_types_supported: ["public", "pairwise"],
  id_token_signing_alg_values_supported: ["RS256"],
  claims_supported: ["sub", "iss", "name"],
  [PLATFORM_LTI]: {
    product_family_code: "ExamplePlatformVendor-Product",
    version: "1.0",
    messages_supported: [
      { type: "LtiResourceLinkRequest" },
      { type: "LtiDeepLinkingRequest", placements: ["ContentArea", "RichTextEditor"] },
    ],
    variables: ["CourseSection.timeFrame.end", "Context.id.history", "Membership.role"],
  },
};

/** The properties that Dynamic Registration 1.0 section 2.2.1 requires of a tool. */
const tool = {
  application_type: "web",
  response_types: ["id_token"],
  grant_types: ["implicit", "client_credentials"],
  initiate_login_uri: "https://client.example.org/lti",
  redirect_uris: ["https://client.example.org/callback", "https://client.example.org/callback2"],
  client_name: "Virtual Garden",
  jwks_uri: "https://client.example.org/.well-known/jwks.json",
  token_endpoint_auth_method: "private_key_jwt",
  scope: "https://purl.imsglobal.org/spec/lti-ags/scope/score",
  [TOOL_LTI]: {
    domain: "client.example.org",
    target_link_uri: "https://client.example.org/lti",
    claims: ["iss", "sub", "name"],
    messages: [{ type: "LtiDeepLinkingRequest" }],
  },
};

describe("the configuration of a platform", () => {
  it("is read with every property of Dynamic Registration 1.0 section 2.1, and written as it is read", () => {
    const full = {
      ...platform,
      authorization_server: "https://server.example.com/as",
      "https://example.org/branding": 1,
    };
    const read = readPlatformConfiguration(full);
    expect(read).toMatchObject({
      issuer: "https://server.example.com",
      registrationEndpoint: "https://server.example.com/connect/register",
      tokenEndpointAuthMethodsSupported: ["private_key_jwt"],
      authorizationServer: "https://server.example.com/as",
      lti: {
        productFamilyCode: "ExamplePlatformVendor-Product",
        messagesSupported: [
          { type: "LtiResourceLinkRequest" },
          { type: "LtiDeepLinkingRequest", placements: ["ContentArea", "RichTextEditor"] },
        ],
        variables: ["CourseSection.timeFrame.end", "Context.id.history", "Membership.role"],
      },
    });
    expect(writePlatformConfiguration(read)).toEqual({
      ...platform,
      authorization_server: "https://server.example.com/as",
    });
  });

  it("keeps the extensions of its LTI configuration, named by a URL", () => {
    const lti = { ...platform[PLATFORM_LTI], "https://example.org/branding": { logo: true } };
    const read = readPlatformConfiguration({ ...platform, [PLATFORM_LTI]: lti });
    expect(read.lti.extensions).toEqual({ "https://example.org/branding": { logo: true } });
    expect(writePlatformConfiguration(read)[PLATFORM_LTI]).toEqual(lti);
    expect(() => writePlatformConfiguration({ ...read, lti: { ...read.lti, extensions: { vendor: 1 } } })).toThrow(
      DataError,
    );
  });

  it("is refused when it lacks what Dynamic Registration requires of a platform, or its lists lack what LTI requires of them", () => {
    expectRefusals(readPlatformConfiguration, platform, [
      ["no issuer", { issuer: undefined }],
      ["an issuer with a query", { issuer: "https://server.example.com/?x=1" }],
      ["an issuer with a fragment", { issuer: "https://server.example.com/#x" }],
      ["an issuer that is http", { issuer: "http://server.example.com" }],
      ["no authorization endpoint", { authorization_endpoint: undefined }],
      ["no registration endpoint", { registration_endpoint: undefined }],
      ["a token endpoint that is http", { token_endpoint: "http://server.example.com/t" }],
      ["no jwks_uri", { jwks_uri: undefined }],
      [
        "authentication methods without private_key_jwt",
        { token_endpoint_auth_methods_supported: ["client_secret_basic"] },
      ],
      ["signing algorithms without RS256", { token_endpoint_auth_signing_alg_values_supported: ["ES256"] }],
      ["scopes without openid", { scopes_supported: ["https://purl.imsglobal.org/spec/lti-ags/scope/score"] }],
      ["response types without id_token", { response_types_supported: ["code"] }],
      ["id token algorithms without RS256", { id_token_signing_alg_values_supported: ["ES256"] }],
      ["no claims_supported", { claims_supported: undefined }],
      ["no subject_types_supported", { subject_types_supported: undefined }],
      ["no LTI configuration", { [PLATFORM_LTI]: undefined }],
      [
        "an LTI configuration without messages_supported",
        { [PLATFORM_LTI]: { product_family_code: "x", version: "1" } },
      ],
      [
        "a message supported without a type",
        { [PLATFORM_LTI]: { ...platform[PLATFORM_LTI], messages_supported: [{}] } },
      ],
      ["an authorization_server that is http", { authorization_server: "http://x.example/" }],
    ]);
    expectRefusesOtherTypes(readPlatformConfiguration);
  });
});

describe("the registration that a tool asks for", () => {
  it("is read with every property of Dynamic Registration 1.0 section 2.2, translations and extensions among them", () => {
    const full = {
      ...tool,
      logo_uri: "https://client.example.org/logo.png",
      contacts: ["ve7jtb@example.org"],
      client_uri: "https://client.example.org/",
      tos_uri: "https://client.example.org/tos",
      policy_uri: "https://client.example.org/policy",
      "client_name#ja": "ガーデン",
      [TOOL_LTI]: {
        domain: "client.example.org",
        secondary_domains: ["cdn.example.org"],
        deployment_id: "dep-1",
        target_link_uri: "https://client.example.org/lti",
        custom_parameters: { context_history: "$Context.id.history" },
        description: "A garden",
        "description#ja": "庭",
        claims: ["iss", "sub"],
        "https://myplatform.example.org/branding": { color: "green" },
        messages: [
          {
            type: "LtiDeepLinkingRequest",
            target_link_uri: "https://client.example.org/pick",
            label: "Add your Garden image",
            "label#ja": "庭を選んでください",
            icon_uri: "https://client.example.org/i.png",
            custom_parameters: { a: "b" },
            placements: ["RichTextEditor"],
            roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
            supported_types: ["file"],
            supported_media_types: ["image/*"],
            "https://vendor.example.org/x": 1,
          },
        ],
      },
    };
    const read = readToolConfiguration(full);
    expect(read.localized).toEqual(new Map([["client_name#ja", "ガーデン"]]));
    expect(read.lti.localized).toEqual(new Map([["description#ja", "庭"]]));
    expect(read.lti.messages[0]).toMatchObject({
      localized: new Map([["label#ja", "庭を選んでください"]]),
      extensions: { "https://vendor.example.org/x": 1 },
      supportedMediaTypes: ["image/*"],
    });
    expect(read.lti.extensions).toEqual({ "https://myplatform.example.org/branding": { color: "green" } });
    expect(read.lti.customParameters).toEqual({ context_history: "$Context.id.history" });
    expect(writeToolConfiguration(read)).toEqual(full);
  });

  it("is refused when it breaks a rule that Dynamic Registration gives a tool", () => {
    expectRefusals(readToolConfiguration, tool, [
      ["an application type that is not web", { application_type: "native" }],
      ["response types without id_token", { response_types: ["code"] }],
      ["grant types without implicit", { grant_types: ["client_credentials"] }],
      ["grant types without client_credentials", { grant_types: ["implicit"] }],
      ["the misspelling implict", { grant_types: ["implict", "client_credentials"] }],
      ["no initiate_login_uri", { initiate_login_uri: undefined }],
      ["an initiate_login_uri that is http", { initiate_login_uri: "http://client.example.org/lti" }],
      ["no redirect_uris", { redirect_uris: [] }],
      ["a redirect URI that is http", { redirect_uris: ["http://client.example.org/cb"] }],
      ["no client_name", { client_name: undefined }],
      ["an empty client_name", { client_name: "" }],
      ["no jwks_uri", { jwks_uri: undefined }],
      ["another token_endpoint_auth_method", { token_endpoint_auth_method: "client_secret_basic" }],
      ["a logo_uri that is http", { logo_uri: "http://client.example.org/logo.png" }],
      ["no LTI configuration", { [TOOL_LTI]: undefined }],
      ["an LTI configuration without a domain", { [TOOL_LTI]: { ...tool[TOOL_LTI], domain: undefined } }],
      ["a domain with a protocol", { [TOOL_LTI]: { ...tool[TOOL_LTI], domain: "https://client.example.org" } }],
      ["no target_link_uri", { [TOOL_LTI]: { ...tool[TOOL_LTI], target_link_uri: undefined } }],
      ["no claims", { [TOOL_LTI]: { ...tool[TOOL_LTI], claims: undefined } }],
      ["no messages", { [TOOL_LTI]: { ...tool[TOOL_LTI], messages: undefined } }],
      ["a message without a type", { [TOOL_LTI]: { ...tool[TOOL_LTI], messages: [{}] } }],
      ["custom parameters that hold a number", { [TOOL_LTI]: { ...tool[TOOL_LTI], custom_parameters: { a: 1 } } }],
      ["a translation that is a number", { "client_name#ja": 5 }],
    ]);
    expectRefusesOtherTypes(readToolConfiguration);
  });

  it("is written only with translations and extensions that are named as the specification names them", () => {
    const read = readToolConfiguration(tool);
    expect(() => writeToolConfiguration({ ...read, localized: new Map([["client_name", "x"]]) })).toThrow(DataError);
    expect(() => writeToolConfiguration({ ...read, localized: new Map([["scope#ja", "x"]]) })).toThrow(DataError);
    expect(() =>
      writeToolConfiguration({ ...read, lti: { ...read.lti, localized: new Map([["label#ja", "x"]]) } }),
    ).toThrow(DataError);
    expect(() => writeToolConfiguration({ ...read, lti: { ...read.lti, extensions: { vendor: 1 } } })).toThrow(
      DataError,
    );
    expect(() =>
      writeToolConfiguration({ ...read, lti: { ...read.lti, messages: [{ type: "x", extensions: { vendor: 1 } }] } }),
    ).toThrow(DataError);
  });
});

describe("the acknowledgment of a platform", () => {
  const result = {
    client_id: "709sdfnjkds12",
    registration_client_uri: "https://server.example.com/connect/register?client_id=709sdfnjkds12",
    registration_access_token: "tok",
    ...tool,
  };

  it("is read with the client and where to read the registration, and written as it is read", () => {
    const read = readToolRegistrationResult(result);
    expect(read).toMatchObject({
      clientId: "709sdfnjkds12",
      registrationClientUri: result.registration_client_uri,
      registrationAccessToken: "tok",
      clientName: "Virtual Garden",
    });
    expect(writeToolRegistrationResult(read)).toEqual(result);
  });

  it("does not hold the grant types and response types to the rules of a request, because the example of the specification misspells implicit", () => {
    const echoed = { ...result, grant_types: ["implict", "client_credentials"], response_types: ["id_token"] };
    expect(readToolRegistrationResult(echoed).grantTypes).toEqual(["implict", "client_credentials"]);
    expect(() => readToolConfiguration(echoed)).toThrow(DataError);
  });

  // Dynamic Registration 1.0 section 2.2 makes the addresses of the registration optional and has them be URLs, and Moodle answers a
  // registration with `"logo_uri": ""`; an empty address says there is none, so both readers take it as absent.
  it("takes an empty address of a logo, a client, terms or a policy as absent, in an answer and in a request", () => {
    const empty = { logo_uri: "", client_uri: "", tos_uri: "", policy_uri: "" };
    for (const read of [readToolRegistrationResult, readToolConfiguration]) {
      const value = read({ ...result, ...empty });
      expect(value.logoUri).toBeUndefined();
      expect(value.clientUri).toBeUndefined();
      expect(value.tosUri).toBeUndefined();
      expect(value.policyUri).toBeUndefined();
      expect(writeToolConfiguration(value)).not.toHaveProperty("logo_uri");
    }
  });

  it("is refused without a client or with an address that is http", () => {
    expectRefusals(readToolRegistrationResult, result, [
      ["no client_id", { client_id: undefined }],
      ["an empty client_id", { client_id: "" }],
      ["a registration_client_uri that is http", { registration_client_uri: "http://x.example/" }],
      ["an empty registration_access_token", { registration_access_token: "" }],
      ["an application type that is not web", { application_type: "native" }],
    ]);
    expectRefusesOtherTypes(readToolRegistrationResult);
  });
});

describe("the configurations of Dynamic Registration", () => {
  const text = fc.string({ minLength: 1, maxLength: 8 });
  const url = text.map((path) => `https://example.com/${encodeURIComponent(path)}`);
  const some = <TValue>(value: fc.Arbitrary<TValue>) => fc.option(value, { nil: undefined });
  const list = (value: fc.Arbitrary<string>) => some(fc.array(value, { maxLength: 3 }));
  const record = some(fc.dictionary(text, text, { minKeys: 1, maxKeys: 2 }));
  const extensions = some(fc.dictionary(url, plainJson, { minKeys: 1, maxKeys: 2 }));
  const localized = (name: string) =>
    some(
      fc
        .dictionary(text, text, { minKeys: 1, maxKeys: 2 })
        .map(
          (entries) =>
            new Map(Object.entries(entries).map(([tag, value]) => [`${name}#${tag.replace("#", "_")}`, value])),
        ),
    );
  const message = fc.record({
    type: text,
    targetLinkUri: some(url),
    label: some(text),
    iconUri: some(url),
    customParameters: record,
    placements: list(text),
    roles: list(text),
    supportedTypes: list(text),
    supportedMediaTypes: list(text),
    localized: localized("label"),
    extensions,
  });
  const lti = fc.record({
    domain: text.filter((domain) => !domain.includes("://")),
    secondaryDomains: list(text.filter((domain) => !domain.includes("://"))),
    deploymentId: some(text),
    targetLinkUri: url,
    customParameters: record,
    description: some(text),
    messages: fc.array(message, { maxLength: 2 }),
    claims: fc.array(text, { maxLength: 3 }),
    localized: localized("description"),
    extensions,
  });
  const tools = fc.record({
    applicationType: fc.constant("web" as const),
    responseTypes: fc.constant(["id_token"]),
    grantTypes: fc.constant(["implicit", "client_credentials"]),
    initiateLoginUri: url,
    redirectUris: fc.array(url, { minLength: 1, maxLength: 3 }),
    clientName: text,
    jwksUri: url,
    logoUri: some(url),
    tokenEndpointAuthMethod: fc.constant("private_key_jwt" as const),
    contacts: list(text),
    clientUri: some(url),
    tosUri: some(url),
    policyUri: some(url),
    scope: some(text),
    lti,
    localized: localized("client_name"),
  });
  const platforms = fc.record({
    issuer: fc.constant("https://server.example.com"),
    authorizationEndpoint: url,
    registrationEndpoint: url,
    jwksUri: url,
    tokenEndpoint: url,
    tokenEndpointAuthMethodsSupported: fc.constant(["private_key_jwt"]),
    tokenEndpointAuthSigningAlgValuesSupported: fc.constant(["RS256"]),
    scopesSupported: fc.constant(["openid"]),
    responseTypesSupported: fc.constant(["id_token"]),
    idTokenSigningAlgValuesSupported: fc.constant(["RS256"]),
    claimsSupported: fc.array(text, { maxLength: 3 }),
    subjectTypesSupported: fc.array(text, { maxLength: 2 }),
    authorizationServer: some(url),
    lti: fc.record({
      productFamilyCode: text,
      version: some(text),
      messagesSupported: fc.array(fc.record({ type: text, placements: list(text) }), { maxLength: 2 }),
      variables: list(text),
      extensions,
    }),
  });

  it("read back what was written, for any platform, tool and acknowledgment", () => {
    fc.assert(
      fc.property(
        platforms,
        tools,
        text,
        (platformValue: PlatformConfiguration, toolValue: ToolConfiguration, clientId) => {
          const acknowledged: ToolRegistrationResult = {
            ...toolValue,
            clientId,
            registrationClientUri: undefined,
            registrationAccessToken: undefined,
          };
          const round = <TValue>(value: TValue) => JSON.parse(JSON.stringify(value));
          expect(readPlatformConfiguration(round(writePlatformConfiguration(platformValue)))).toEqual(platformValue);
          expect(readToolConfiguration(round(writeToolConfiguration(toolValue)))).toEqual(toolValue);
          expect(readToolRegistrationResult(round(writeToolRegistrationResult(acknowledged)))).toEqual(acknowledged);
        },
      ),
      FUZZ,
    );
  });

  it("return a value or throw a DataError for any JSON, and for the examples with any value replaced", () => {
    fuzzJson(readPlatformConfiguration, [platform]);
    fuzzJson(readToolConfiguration, [tool]);
    fuzzJson(readToolRegistrationResult, [{ client_id: "c", ...tool }]);
  });
});
