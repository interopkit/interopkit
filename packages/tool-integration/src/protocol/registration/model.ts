import type { JsonValue } from "@interopkit/core/checks";

/** A message type that a platform supports, and where it supports it (Dynamic Registration 1.0 section 2.1.2). */
export interface MessageSupported {
  /** The message type. */
  readonly type: string;
  /** The places where the platform explicitly supports links of this type; it may support others. */
  readonly placements?: readonly string[];
}

/** What a platform says of its LTI capabilities (Dynamic Registration 1.0 section 2.1.2, `lti-platform-configuration`). */
export interface PlatformLtiConfiguration {
  /** The vendor's product identifier. */
  readonly productFamilyCode: string;
  /** The version of the software of the platform, which the example of the specification leaves out. */
  readonly version?: string;
  /** The message types the platform supports. */
  readonly messagesSupported: readonly MessageSupported[];
  /** The variables that the platform can substitute. */
  readonly variables?: readonly string[];
  /** Properties that a vendor added, by the URL that names each. */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** The OpenID configuration of a platform, as a tool discovers it (Dynamic Registration 1.0 section 2.1.1). */
export interface PlatformConfiguration {
  /** The issuer of the platform. */
  readonly issuer: string;
  /** The address of the authorization endpoint. */
  readonly authorizationEndpoint: string;
  /** The address of the registration endpoint. */
  readonly registrationEndpoint: string;
  /** The address of the key set of the platform. */
  readonly jwksUri: string;
  /** The address of the endpoint that a tool asks for access tokens. */
  readonly tokenEndpoint: string;
  /** The client authentication methods of the token endpoint; includes `private_key_jwt`. */
  readonly tokenEndpointAuthMethodsSupported: readonly string[];
  /** The algorithms that sign a client assertion; includes `RS256`. */
  readonly tokenEndpointAuthSigningAlgValuesSupported: readonly string[];
  /** The scopes the platform supports; includes `openid`. */
  readonly scopesSupported: readonly string[];
  /** The response types the platform supports; includes `id_token`. */
  readonly responseTypesSupported: readonly string[];
  /** The algorithms that sign an `id_token`; includes `RS256`. */
  readonly idTokenSigningAlgValuesSupported: readonly string[];
  /** The OpenID claims the platform supports. */
  readonly claimsSupported: readonly string[];
  /** The subject identifier types: `public` or `pairwise`. */
  readonly subjectTypesSupported: readonly string[];
  /** The audience of a client assertion when it is not the token endpoint. */
  readonly authorizationServer?: string;
  /** The LTI capabilities. */
  readonly lti: PlatformLtiConfiguration;
}

/** A message that a tool supports (Dynamic Registration 1.0 section 2.2.3). */
export interface ToolMessageConfiguration {
  /** The message type. */
  readonly type: string;
  /** The address to launch for this message; the tool's own `targetLinkUri` when absent. */
  readonly targetLinkUri?: string;
  /** A label for the link. */
  readonly label?: string;
  /** An icon for the link. */
  readonly iconUri?: string;
  /** The custom properties of every launch of this message; they win over the tool's. */
  readonly customParameters?: Readonly<Record<string, string>>;
  /** Where the platform should add links for this message. */
  readonly placements?: readonly string[];
  /** The roles that may launch this message; one is enough. */
  readonly roles?: readonly string[];
  /** The content item types a Deep Linking message wants to select (Dynamic Registration 1.0 section 2.2.4.2). */
  readonly supportedTypes?: readonly string[];
  /** The media types a Deep Linking message wants to select. */
  readonly supportedMediaTypes?: readonly string[];
  /** Translations of the label, by the name of the property with the language tag, such as `label#ja`. */
  readonly localized?: ReadonlyMap<string, string>;
  /** Properties that a vendor added, by the URL that names each. */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** What a tool says of its LTI use (Dynamic Registration 1.0 section 2.2.2, `lti-tool-configuration`). */
export interface ToolLtiConfiguration {
  /** The primary domain of the tool, without a protocol. */
  readonly domain: string;
  /** Other domains the tool covers. */
  readonly secondaryDomains?: readonly string[];
  /** The deployment, when the platform combines registration and deployment. */
  readonly deploymentId?: string;
  /** The default address to launch. */
  readonly targetLinkUri: string;
  /** The custom properties of every launch of the tool. */
  readonly customParameters?: Readonly<Record<string, string>>;
  /** A short description in plain text. */
  readonly description?: string;
  /** The messages the tool supports. */
  readonly messages: readonly ToolMessageConfiguration[];
  /** The claims the tool wants in each `id_token`. */
  readonly claims: readonly string[];
  /** Translations of the description, such as `description#ja`. */
  readonly localized?: ReadonlyMap<string, string>;
  /** Properties that a vendor added, by the URL that names each. */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** The registration that a tool asks of a platform (Dynamic Registration 1.0 section 2.2.1). */
export interface ToolConfiguration {
  /** The kind of application; `web`. */
  readonly applicationType: "web";
  /** The response types; includes `id_token`. */
  readonly responseTypes: readonly string[];
  /** The grant types; includes `client_credentials` and `implicit`. */
  readonly grantTypes: readonly string[];
  /** The address with which the platform starts a launch. */
  readonly initiateLoginUri: string;
  /** The addresses to which the platform posts an `id_token`. */
  readonly redirectUris: readonly string[];
  /** The name of the tool, for the user. */
  readonly clientName: string;
  /** The address of the key set of the tool. */
  readonly jwksUri: string;
  /** The address of a logo. */
  readonly logoUri?: string;
  /** How the tool authenticates at the token endpoint; `private_key_jwt`. */
  readonly tokenEndpointAuthMethod: "private_key_jwt";
  /** Contacts, such as email addresses. */
  readonly contacts?: readonly string[];
  /** The address of the home page of the tool. */
  readonly clientUri?: string;
  /** The address of the terms of service. */
  readonly tosUri?: string;
  /** The address of the privacy policy. */
  readonly policyUri?: string;
  /** The scopes the tool asks for, space-separated. */
  readonly scope?: string;
  /** What the tool says of its LTI use. */
  readonly lti: ToolLtiConfiguration;
  /** Translations of the name and the addresses, such as `client_name#ja`. */
  readonly localized?: ReadonlyMap<string, string>;
}

/** The configuration that a platform acknowledges a registration with (Dynamic Registration 1.0 section 2.3). */
export interface ToolRegistrationResult extends ToolConfiguration {
  /** The identifier of the tool at the platform. */
  readonly clientId: string;
  /** The address at which the tool reads and updates the registration. */
  readonly registrationClientUri?: string;
  /** The token that protects `registrationClientUri`, when the platform gives one. */
  readonly registrationAccessToken?: string;
}
