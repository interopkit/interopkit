// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { DataError } from "@interopkit/core";
import { describe, looseRecord, parseWith } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  extensionsOf,
  HTTPS_URL,
  IDENTIFIER,
  NON_EMPTY_STRING,
  OPTIONAL_TEXT,
  STRING,
  STRING_ARRAY,
  STRING_RECORD,
} from "../claims/index.js";
import type {
  MessageSupported,
  PlatformConfiguration,
  PlatformLtiConfiguration,
  ToolConfiguration,
  ToolLtiConfiguration,
  ToolMessageConfiguration,
  ToolRegistrationResult,
} from "./model.js";

const PLATFORM_LTI = "https://purl.imsglobal.org/spec/lti-platform-configuration";
const TOOL_LTI = "https://purl.imsglobal.org/spec/lti-tool-configuration";

/** A list that must hold a value (Dynamic Registration 1.0 section 2: "must contain"). */
function including(name: string, ...required: string[]) {
  return v.pipe(
    STRING_ARRAY,
    v.check(
      (list) => required.every((value) => list.includes(value)),
      `expected ${name} to include ${required.map((value) => JSON.stringify(value)).join(" and ")}`,
    ),
  );
}

/** The translations of the properties in `names`: the members `name#tag` whose value is a string, as a map. */
function localizedOf(source: object, names: readonly string[]): ReadonlyMap<string, string> | undefined {
  const found = new Map<string, string>();
  for (const [member, value] of Object.entries(source)) {
    const [name, tag] = member.split("#");
    if (tag === undefined || tag === "" || name === undefined || !names.includes(name)) continue;
    if (typeof value !== "string") {
      throw new DataError(`The translation ${describe(member)} must be a string, found ${describe(value)}.`);
    }
    found.set(member, value);
  }
  return found.size === 0 ? undefined : found;
}

const messageSupportedSchema = v.pipe(
  looseRecord({ type: NON_EMPTY_STRING, placements: v.optional(STRING_ARRAY) }),
  v.transform((claim): MessageSupported => ({ type: claim.type, placements: claim.placements })),
);

const platformLtiSchema = v.pipe(
  looseRecord({
    product_family_code: STRING,
    version: v.optional(STRING),
    messages_supported: v.array(messageSupportedSchema),
    variables: v.optional(STRING_ARRAY),
  }),
  v.transform(
    (claim): PlatformLtiConfiguration => ({
      productFamilyCode: claim.product_family_code,
      version: claim.version,
      messagesSupported: claim.messages_supported,
      variables: claim.variables,
      extensions: extensionsOf(claim),
    }),
  ),
);

const issuerSchema = v.pipe(
  HTTPS_URL,
  v.check(
    (issuer) => new URL(issuer).search === "" && new URL(issuer).hash === "",
    (issue) => `expected an issuer without a query or a fragment, found ${issue.received}`,
  ),
);

const platformConfigurationSchema = v.pipe(
  looseRecord({
    issuer: issuerSchema,
    authorization_endpoint: HTTPS_URL,
    registration_endpoint: HTTPS_URL,
    jwks_uri: HTTPS_URL,
    token_endpoint: HTTPS_URL,
    token_endpoint_auth_methods_supported: including("token_endpoint_auth_methods_supported", "private_key_jwt"),
    token_endpoint_auth_signing_alg_values_supported: including(
      "token_endpoint_auth_signing_alg_values_supported",
      "RS256",
    ),
    scopes_supported: including("scopes_supported", "openid"),
    response_types_supported: including("response_types_supported", "id_token"),
    id_token_signing_alg_values_supported: including("id_token_signing_alg_values_supported", "RS256"),
    claims_supported: STRING_ARRAY,
    subject_types_supported: STRING_ARRAY,
    authorization_server: v.optional(HTTPS_URL),
    [PLATFORM_LTI]: platformLtiSchema,
  }),
  v.transform(
    (claim): PlatformConfiguration => ({
      issuer: claim.issuer,
      authorizationEndpoint: claim.authorization_endpoint,
      registrationEndpoint: claim.registration_endpoint,
      jwksUri: claim.jwks_uri,
      tokenEndpoint: claim.token_endpoint,
      tokenEndpointAuthMethodsSupported: claim.token_endpoint_auth_methods_supported,
      tokenEndpointAuthSigningAlgValuesSupported: claim.token_endpoint_auth_signing_alg_values_supported,
      scopesSupported: claim.scopes_supported,
      responseTypesSupported: claim.response_types_supported,
      idTokenSigningAlgValuesSupported: claim.id_token_signing_alg_values_supported,
      claimsSupported: claim.claims_supported,
      subjectTypesSupported: claim.subject_types_supported,
      authorizationServer: claim.authorization_server,
      lti: claim[PLATFORM_LTI],
    }),
  ),
);

const MESSAGE_LOCALIZED = ["label"];
const toolMessageSchema = v.pipe(
  looseRecord({
    type: NON_EMPTY_STRING,
    target_link_uri: v.optional(HTTPS_URL),
    label: v.optional(STRING),
    icon_uri: v.optional(HTTPS_URL),
    custom_parameters: v.optional(STRING_RECORD),
    placements: v.optional(STRING_ARRAY),
    roles: v.optional(STRING_ARRAY),
    supported_types: v.optional(STRING_ARRAY),
    supported_media_types: v.optional(STRING_ARRAY),
  }),
  v.transform(
    (claim): ToolMessageConfiguration => ({
      type: claim.type,
      targetLinkUri: claim.target_link_uri,
      label: claim.label,
      iconUri: claim.icon_uri,
      customParameters: claim.custom_parameters,
      placements: claim.placements,
      roles: claim.roles,
      supportedTypes: claim.supported_types,
      supportedMediaTypes: claim.supported_media_types,
      localized: localizedOf(claim, MESSAGE_LOCALIZED),
      extensions: extensionsOf(claim),
    }),
  ),
);

const DOMAIN = v.pipe(
  STRING,
  v.check((domain) => domain !== "" && !domain.includes("://"), "expected a domain without a protocol"),
);
const LTI_LOCALIZED = ["description"];
const toolLtiSchema = v.pipe(
  looseRecord({
    domain: DOMAIN,
    secondary_domains: v.optional(v.array(DOMAIN)),
    deployment_id: v.optional(IDENTIFIER),
    target_link_uri: HTTPS_URL,
    custom_parameters: v.optional(STRING_RECORD),
    description: OPTIONAL_TEXT,
    messages: v.array(toolMessageSchema),
    claims: STRING_ARRAY,
  }),
  v.transform(
    (claim): ToolLtiConfiguration => ({
      domain: claim.domain,
      secondaryDomains: claim.secondary_domains,
      deploymentId: claim.deployment_id,
      targetLinkUri: claim.target_link_uri,
      customParameters: claim.custom_parameters,
      description: claim.description,
      messages: claim.messages,
      claims: claim.claims,
      localized: localizedOf(claim, LTI_LOCALIZED),
      extensions: extensionsOf(claim),
    }),
  ),
);

const TOOL_LOCALIZED = ["client_name", "logo_uri", "client_uri", "tos_uri", "policy_uri"];

/** The properties of a tool's registration, with the rules of section 2.2.1 on the grants and responses applied when `strict`. */
function toolEntries(strict: boolean) {
  return {
    application_type: v.literal("web"),
    response_types: strict ? including("response_types", "id_token") : STRING_ARRAY,
    grant_types: strict ? including("grant_types", "client_credentials", "implicit") : STRING_ARRAY,
    initiate_login_uri: HTTPS_URL,
    redirect_uris: v.pipe(v.array(HTTPS_URL), v.minLength(1)),
    client_name: NON_EMPTY_STRING,
    jwks_uri: HTTPS_URL,
    logo_uri: v.optional(HTTPS_URL),
    token_endpoint_auth_method: v.literal("private_key_jwt"),
    contacts: v.optional(STRING_ARRAY),
    client_uri: v.optional(HTTPS_URL),
    tos_uri: v.optional(HTTPS_URL),
    policy_uri: v.optional(HTTPS_URL),
    scope: v.optional(STRING),
    [TOOL_LTI]: toolLtiSchema,
  };
}

/** Builds the model of a registration from its members. */
function toolConfigurationOf(
  claim: v.InferOutput<ReturnType<typeof looseRecord<ReturnType<typeof toolEntries>>>>,
): ToolConfiguration {
  return {
    applicationType: claim.application_type,
    responseTypes: claim.response_types,
    grantTypes: claim.grant_types,
    initiateLoginUri: claim.initiate_login_uri,
    redirectUris: claim.redirect_uris,
    clientName: claim.client_name,
    jwksUri: claim.jwks_uri,
    logoUri: claim.logo_uri,
    tokenEndpointAuthMethod: claim.token_endpoint_auth_method,
    contacts: claim.contacts,
    clientUri: claim.client_uri,
    tosUri: claim.tos_uri,
    policyUri: claim.policy_uri,
    scope: claim.scope,
    lti: claim[TOOL_LTI],
    localized: localizedOf(claim, TOOL_LOCALIZED),
  };
}

const toolConfigurationSchema = v.pipe(looseRecord(toolEntries(true)), v.transform(toolConfigurationOf));

const toolRegistrationResultSchema = v.pipe(
  looseRecord({
    client_id: IDENTIFIER,
    registration_client_uri: v.optional(HTTPS_URL),
    registration_access_token: v.optional(NON_EMPTY_STRING),
    ...toolEntries(false),
  }),
  v.transform(
    (claim): ToolRegistrationResult => ({
      ...toolConfigurationOf(claim),
      clientId: claim.client_id,
      registrationClientUri: claim.registration_client_uri,
      registrationAccessToken: claim.registration_access_token,
    }),
  ),
);

/**
 * Reads the OpenID configuration of a platform into the model, with the rules of Dynamic Registration 1.0 section 2.1: the
 * endpoints are https addresses, the issuer has no query or fragment, and the lists include what LTI requires of them.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` that names the path of the first invalid member.
 */
export function readPlatformConfiguration(value: unknown): PlatformConfiguration {
  return parseWith(platformConfigurationSchema, value, "The platform configuration");
}

/**
 * Reads the registration that a tool asks for, with the rules of Dynamic Registration 1.0 section 2.2.1: `web`, the grant types
 * `client_credentials` and `implicit`, the response type `id_token`, `private_key_jwt`, and https addresses.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` that names the path of the first invalid member.
 */
export function readToolConfiguration(value: unknown): ToolConfiguration {
  return parseWith(toolConfigurationSchema, value, "The tool configuration");
}

/**
 * Reads the configuration that a platform acknowledges a registration with. It does not hold the grant types and response
 * types to the rules of a request, because the platform states what it granted, and the example of the specification
 * misspells `implicit`.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` that names the path of the first invalid member.
 */
export function readToolRegistrationResult(value: unknown): ToolRegistrationResult {
  return parseWith(toolRegistrationResultSchema, value, "The registration");
}
