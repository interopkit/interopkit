/**
 * The models of the Open Badges and CLR APIs: the answers of getCredentials, the status of an answer and the service description.
 *
 * @module
 */

import type { AchievementCredential } from "./credentials.js";
import type { StatusCodeMajor, StatusCodeMinorValue, StatusSeverity } from "./vocabularies.js";

/** The answer to getCredentials of the Open Badges API (OB B.2.1). */
export interface GetOpenBadgeCredentialsResponse {
  /** The credentials of the page. */
  readonly credential?: readonly AchievementCredential[];
  /**
   * OpenBadgeCredentials that have been signed with the VC-JWT Proof Format MUST be in the `compactJwsString` array.
   */
  readonly compactJwsString?: readonly string[];
}

/** The status that an API returns with an answer that is not a success (OB B.3.1). */
export interface ImsxStatusInfo {
  /** The code major value (from the corresponding enumerated vocabulary). */
  readonly imsx_codeMajor: StatusCodeMajor;
  /** The severity value (from the corresponding enumerated vocabulary). */
  readonly imsx_severity: StatusSeverity;
  /** A human readable description supplied by the entity creating the status code information. */
  readonly imsx_description?: string;
  /** The details of the outcome. */
  readonly imsx_codeMinor?: ImsxCodeMinor;
}

/**
 * This is the container for the set of code minor status codes reported in the responses from the Service Provider.
 */
export interface ImsxCodeMinor {
  /** The details. */
  readonly imsx_codeMinorField: readonly ImsxCodeMinorField[];
}

/** This is the container for a single code minor status code. */
export interface ImsxCodeMinorField {
  /** This should contain the identity of the system that has produced the code minor status code report. */
  readonly imsx_codeMinorFieldName: string;
  /** The code minor status code (this is a value from the corresponding enumerated vocabulary). */
  readonly imsx_codeMinorFieldValue: StatusCodeMinorValue;
}

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
