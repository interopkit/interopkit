/**
 * The models of the Open Badges and CLR APIs: the answers of getCredentials, the status of an answer and the service description.
 *
 * @module
 */

import type { StatusInfo } from "@interopkit/core";
import type { AchievementCredential } from "./credentials.js";
import type { StatusCodeMinorValue } from "./vocabularies.js";

/** The APIs that exchange credentials: the Open Badges API (`"badges"`) and the CLR Standard API (`"clr"`). */
export const CREDENTIAL_APIS = ["badges", "clr"] as const;

/** The name of an API that exchanges credentials. */
export type CredentialApi = (typeof CREDENTIAL_APIS)[number];

/** The answer to getCredentials of the Open Badges API (OB B.2.1). */
export interface GetOpenBadgeCredentialsResponse {
  /** The credentials of the page. */
  readonly credential?: readonly AchievementCredential[];
  /**
   * OpenBadgeCredentials that have been signed with the VC-JWT Proof Format MUST be in the `compactJwsString` array.
   */
  readonly compactJwsString?: readonly string[];
}

/**
 * The status that an API returns with an answer that is not a success (OB B.3.1): the `imsx_StatusInfo` of `@interopkit/core`
 * with the codes of OB B.3.6.
 */
export type ImsxStatusInfo = StatusInfo<StatusCodeMinorValue>;

/** The OpenAPI document that describes an API and where clients register (OB B.4.1). */
export interface ServiceDescriptionDocument {
  /**
   * This string MUST be the semantic version number of the OpenAPI Specification version that the OpenAPI document
   * uses.
   */
  readonly openapi: string;
  /** Information about the API. */
  readonly info: OpenApiInfo;
  /** The components of the API: its security schemes. */
  readonly components: OpenApiComponents;
}

/** The object provides metadata about the API. */
export interface OpenApiInfo {
  /** A fully qualified URL to the [=resource server=]'s terms of service. */
  readonly termsOfService: string;
  /** The name of the [=resource server=]. */
  readonly title: string;
  /** The version of the API. */
  readonly version: string;
  /** An image representing the [=resource server=]. */
  readonly "x-imssf-image"?: string;
  /** A fully qualified URL to the [=resource server=]'s privacy policy. */
  readonly "x-imssf-privacyPolicyUrl": string;
}

/** Holds a set of reusable objects for different aspects of the OAS. */
export interface OpenApiComponents {
  /** The security schemes that the API supports. */
  readonly securitySchemes: OpenApiSecuritySchemes;
}

/** The Map of security scheme objects supported by this specification. */
export interface OpenApiSecuritySchemes {
  /** The OAuth2ACG. */
  readonly OAuth2ACG?: OpenApiOAuth2SecurityScheme;
}

/** Defines an OAuth2 security scheme that can be used by the operations. */
export interface OpenApiOAuth2SecurityScheme {
  /** MUST be the string `oauth2`. */
  readonly type: string;
  /** A short description for the security scheme. */
  readonly description?: string;
  /** A fully qualified URL to the Client Registration endpoint. */
  readonly "x-imssf-registrationUrl": string;
}
