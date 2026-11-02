// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { DataError } from "@interopkit/core";
import { describe, type JsonValue } from "@interopkit/core/checks";
import { compact, type Members, writeExtensions } from "../claims/index.js";
import type {
  PlatformConfiguration,
  ToolConfiguration,
  ToolLtiConfiguration,
  ToolMessageConfiguration,
  ToolRegistrationResult,
} from "./model.js";

const PLATFORM_LTI = "https://purl.imsglobal.org/spec/lti-platform-configuration";
const TOOL_LTI = "https://purl.imsglobal.org/spec/lti-tool-configuration";
const MESSAGE_MEMBERS = [
  "type",
  "target_link_uri",
  "label",
  "icon_uri",
  "custom_parameters",
  "placements",
  "roles",
  "supported_types",
  "supported_media_types",
];
const LTI_MEMBERS = [
  "domain",
  "secondary_domains",
  "deployment_id",
  "target_link_uri",
  "custom_parameters",
  "description",
  "messages",
  "claims",
];
const PLATFORM_LTI_MEMBERS = ["product_family_code", "version", "messages_supported", "variables"];

/** Writes the translations, whose names carry a language tag after `#`. */
function writeLocalized(localized: ReadonlyMap<string, string> | undefined, names: readonly string[]): Members {
  for (const member of localized?.keys() ?? []) {
    const [name, tag] = member.split("#");
    if (tag === undefined || tag === "" || name === undefined || !names.includes(name)) {
      throw new DataError(
        `The name of a translation must be a property of its object, a "#" and a language tag, such as "${names[0]}#ja", found ${describe(member)}.`,
      );
    }
  }
  return Object.fromEntries(localized ?? []);
}

function writeMessage(message: ToolMessageConfiguration): Record<string, JsonValue> {
  return compact({
    type: message.type,
    target_link_uri: message.targetLinkUri,
    label: message.label,
    icon_uri: message.iconUri,
    custom_parameters: message.customParameters && Object.fromEntries(message.customParameters),
    placements: message.placements && [...message.placements],
    roles: message.roles && [...message.roles],
    supported_types: message.supportedTypes && [...message.supportedTypes],
    supported_media_types: message.supportedMediaTypes && [...message.supportedMediaTypes],
    ...writeLocalized(message.localized, ["label"]),
    ...writeExtensions(message.extensions, MESSAGE_MEMBERS),
  });
}

function writeToolLti(lti: ToolLtiConfiguration): Record<string, JsonValue> {
  return compact({
    domain: lti.domain,
    secondary_domains: lti.secondaryDomains && [...lti.secondaryDomains],
    deployment_id: lti.deploymentId,
    target_link_uri: lti.targetLinkUri,
    custom_parameters: lti.customParameters && Object.fromEntries(lti.customParameters),
    description: lti.description,
    messages: lti.messages.map(writeMessage),
    claims: [...lti.claims],
    ...writeLocalized(lti.localized, ["description"]),
    ...writeExtensions(lti.extensions, LTI_MEMBERS),
  });
}

/** Writes the registration that a tool asks for, as `readToolConfiguration` reads it. @throws `DataError` when a translation or an extension is misnamed. */
export function writeToolConfiguration(tool: ToolConfiguration): Record<string, JsonValue> {
  return compact({
    application_type: tool.applicationType,
    response_types: [...tool.responseTypes],
    grant_types: [...tool.grantTypes],
    initiate_login_uri: tool.initiateLoginUri,
    redirect_uris: [...tool.redirectUris],
    client_name: tool.clientName,
    jwks_uri: tool.jwksUri,
    logo_uri: tool.logoUri,
    token_endpoint_auth_method: tool.tokenEndpointAuthMethod,
    contacts: tool.contacts && [...tool.contacts],
    client_uri: tool.clientUri,
    tos_uri: tool.tosUri,
    policy_uri: tool.policyUri,
    scope: tool.scope,
    [TOOL_LTI]: writeToolLti(tool.lti),
    ...writeLocalized(tool.localized, ["client_name", "logo_uri", "client_uri", "tos_uri", "policy_uri"]),
  });
}

/** Writes the acknowledgment of a registration, as `readToolRegistrationResult` reads it. @throws `DataError` as `writeToolConfiguration` does. */
export function writeToolRegistrationResult(result: ToolRegistrationResult): Record<string, JsonValue> {
  return compact({
    client_id: result.clientId,
    registration_client_uri: result.registrationClientUri,
    registration_access_token: result.registrationAccessToken,
    ...writeToolConfiguration(result),
  });
}

/** Writes the OpenID configuration of a platform, as `readPlatformConfiguration` reads it. @throws `DataError` when an extension is misnamed. */
export function writePlatformConfiguration(platform: PlatformConfiguration): Record<string, JsonValue> {
  const { lti } = platform;
  return compact({
    issuer: platform.issuer,
    authorization_endpoint: platform.authorizationEndpoint,
    token_endpoint: platform.tokenEndpoint,
    token_endpoint_auth_methods_supported: [...platform.tokenEndpointAuthMethodsSupported],
    token_endpoint_auth_signing_alg_values_supported: [...platform.tokenEndpointAuthSigningAlgValuesSupported],
    jwks_uri: platform.jwksUri,
    registration_endpoint: platform.registrationEndpoint,
    scopes_supported: [...platform.scopesSupported],
    response_types_supported: [...platform.responseTypesSupported],
    subject_types_supported: [...platform.subjectTypesSupported],
    id_token_signing_alg_values_supported: [...platform.idTokenSigningAlgValuesSupported],
    claims_supported: [...platform.claimsSupported],
    authorization_server: platform.authorizationServer,
    [PLATFORM_LTI]: compact({
      product_family_code: lti.productFamilyCode,
      version: lti.version,
      messages_supported: lti.messagesSupported.map((message) =>
        compact({ type: message.type, placements: message.placements && [...message.placements] }),
      ),
      variables: lti.variables && [...lti.variables],
      ...writeExtensions(lti.extensions, PLATFORM_LTI_MEMBERS),
    }),
  });
}
