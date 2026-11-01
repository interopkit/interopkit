// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 metadata and requests are snake_case.

import * as oauth from "oauth4webapi";
import { checkArray, checkHttpsUrl, checkNonEmptyString, checkRecord, describe } from "../checks.js";
import { DataError, ServiceError } from "../errors.js";
import type { ClientAuthentication, OAuthClient } from "./client.js";
import { checkOAuthCallOptions, exchange, type OAuthCallOptions } from "./request.js";
import { checkScopes } from "./scope.js";
import { type AuthorizationServer, checkAuthorizationServer, libraryServer } from "./server.js";
import { MILLISECONDS_PER_SECOND } from "./time.js";

const REGISTERED_METHODS: readonly string[] = ["client_secret_basic", "client_secret_post", "none"];

/** The grant types that this module carries out (RFC 6749 sections 4.1, 4.4 and 6). */
export const GRANT_TYPES = ["authorization_code", "refresh_token", "client_credentials"] as const;

/** The name of a grant type that a client can register for. */
export type GrantType = (typeof GRANT_TYPES)[number];

/** The grants of a registration that names none: the ones that Open Badges 3.0 allows, which every server that registers a browser client offers. */
const DEFAULT_GRANTS: readonly GrantType[] = ["authorization_code", "refresh_token"];

/** What a client tells a server about itself when it registers (RFC 7591 section 2). */
export interface ClientMetadata {
  /** Where the server may send the browser back to after the user authorizes, absolute URLs. */
  readonly redirectUris: readonly string[];
  /** The name that the server shows to the user. */
  readonly clientName: string;
  /** The home page of the client, an `https` URL. */
  readonly clientUri: string;
  /** The scopes that the client will ask for. */
  readonly scopes: readonly string[];
  /**
   * The grants that the client will use. A server may refuse a registration that asks for a grant it does not offer: Open
   * Badges 3.0 allows `authorization_code` and `refresh_token` only (7.1.1.2), and LTI tools use `client_credentials`.
   * `refresh_token` needs `authorization_code`, and a public client (`none`) has no credentials for `client_credentials`.
   *
   * @defaultValue `["authorization_code", "refresh_token"]`
   */
  readonly grantTypes?: readonly GrantType[];
  /**
   * The logo that the server shows, an `https` URL.
   *
   * @defaultValue none
   */
  readonly logoUri?: string;
  /**
   * The terms of service, an `https` URL.
   *
   * @defaultValue none
   */
  readonly tosUri?: string;
  /**
   * The privacy policy, an `https` URL.
   *
   * @defaultValue none
   */
  readonly policyUri?: string;
  /**
   * An identifier of the software, the same for every instance of it.
   *
   * @defaultValue none
   */
  readonly softwareId?: string;
  /**
   * The version of the software.
   *
   * @defaultValue none
   */
  readonly softwareVersion?: string;
  /**
   * How the client will authenticate. `private_key_jwt` is not offered: it needs the client's public keys, which this
   * metadata does not carry.
   *
   * @defaultValue `"client_secret_basic"`
   */
  readonly tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post" | "none";
}

/** A client that the server registered: what to call it and how it authenticates, and what the server gave for managing it. */
export interface RegisteredClient extends OAuthClient {
  /**
   * The token that manages the registration (RFC 7592).
   *
   * @defaultValue none
   */
  readonly registrationAccessToken?: string;
  /**
   * Epoch milliseconds at which the client secret expires; absent when it does not.
   *
   * @defaultValue none
   */
  readonly clientSecretExpiresAt?: number;
}

/** Checks the metadata that the host passes in. */
function checkMetadata(value: unknown): asserts value is ClientMetadata {
  checkRecord(value, "The client metadata must be an object");
  checkArray(value.redirectUris, "The redirectUris of the client metadata must be an array");
  if (value.redirectUris.length === 0)
    throw new DataError("The redirectUris of the client metadata must have at least one URI.");
  for (const uri of value.redirectUris) {
    if (typeof uri !== "string" || !URL.canParse(uri)) {
      throw new DataError(`A redirect URI of the client metadata must be an absolute URL, found ${describe(uri)}.`);
    }
  }
  checkNonEmptyString(value.clientName, "The clientName of the client metadata");
  checkHttpsUrl(value.clientUri, "The clientUri of the client metadata");
  checkScopes(value.scopes);
  for (const name of ["logoUri", "tosUri", "policyUri"] as const) {
    if (value[name] !== undefined) checkHttpsUrl(value[name], `The ${name} of the client metadata`);
  }
  for (const name of ["softwareId", "softwareVersion"] as const) {
    if (value[name] !== undefined) checkNonEmptyString(value[name], `The ${name} of the client metadata`);
  }
  const method = value.tokenEndpointAuthMethod;
  if (method !== undefined && !(typeof method === "string" && REGISTERED_METHODS.includes(method))) {
    throw new DataError(
      `The tokenEndpointAuthMethod of the client metadata must be ${REGISTERED_METHODS.join(", ")}, found ${describe(method)}.`,
    );
  }
  if (value.grantTypes !== undefined) checkGrantTypes(value.grantTypes, method);
}

/** Checks the grant types that the host asks for, against each other and against how the client authenticates. */
function checkGrantTypes(grants: unknown, method: unknown): void {
  checkArray(grants, "The grantTypes of the client metadata must be an array");
  const known: readonly unknown[] = GRANT_TYPES;
  const unlisted = grants.find((grant) => !known.includes(grant));
  if (grants.length === 0 || unlisted !== undefined) {
    throw new DataError(
      `The grantTypes of the client metadata must list at least one of ${GRANT_TYPES.join(", ")}, found ${describe(unlisted ?? grants)}.`,
    );
  }
  if (new Set(grants).size !== grants.length) {
    throw new DataError("The grantTypes of the client metadata must not list a grant twice.");
  }
  if (grants.includes("refresh_token") && !grants.includes("authorization_code")) {
    throw new DataError("The grantTypes of the client metadata list refresh_token without authorization_code.");
  }
  if (grants.includes("client_credentials") && method === "none") {
    throw new DataError(
      "A public client (tokenEndpointAuthMethod none) has no credentials for the client_credentials grant.",
    );
  }
}

/** The request body of RFC 7591 section 3.1, in the names of that RFC. */
function registrationRequest(metadata: ClientMetadata): Record<string, string | string[]> {
  const method = metadata.tokenEndpointAuthMethod ?? "client_secret_basic";
  const grants = metadata.grantTypes ?? DEFAULT_GRANTS;
  return {
    redirect_uris: [...metadata.redirectUris],
    client_name: metadata.clientName,
    client_uri: metadata.clientUri,
    scope: metadata.scopes.join(" "),
    ...(metadata.logoUri === undefined ? {} : { logo_uri: metadata.logoUri }),
    ...(metadata.tosUri === undefined ? {} : { tos_uri: metadata.tosUri }),
    ...(metadata.policyUri === undefined ? {} : { policy_uri: metadata.policyUri }),
    ...(metadata.softwareId === undefined ? {} : { software_id: metadata.softwareId }),
    ...(metadata.softwareVersion === undefined ? {} : { software_version: metadata.softwareVersion }),
    token_endpoint_auth_method: method,
    grant_types: [...grants],
    // Only the authorization code grant sends the browser to the server and back with a code.
    response_types: grants.includes("authorization_code") ? ["code"] : [],
  };
}

/** Reads the registered client from the server's answer. */
function readRegisteredClient(
  answer: Awaited<ReturnType<typeof oauth.processDynamicClientRegistrationResponse>>,
  asked: NonNullable<ClientMetadata["tokenEndpointAuthMethod"]>,
  what: string,
): RegisteredClient {
  const method = answer.token_endpoint_auth_method ?? asked;
  const secret = answer.client_secret;
  let authentication: ClientAuthentication;
  if (method === "none") {
    authentication = { method };
  } else if ((method === "client_secret_basic" || method === "client_secret_post") && typeof secret === "string") {
    authentication = { method, clientSecret: secret };
  } else {
    throw new ServiceError(
      `${what} registered the client for ${describe(method)} without a secret that this can use.`,
      201,
      "",
    );
  }
  const expiresAt = answer.client_secret_expires_at;
  return {
    clientId: answer.client_id,
    authentication,
    ...(typeof answer.registration_access_token === "string"
      ? { registrationAccessToken: answer.registration_access_token }
      : {}),
    // 0 means that the secret does not expire (RFC 7591 section 3.2.1).
    ...(typeof expiresAt === "number" && expiresAt > 0
      ? { clientSecretExpiresAt: expiresAt * MILLISECONDS_PER_SECOND }
      : {}),
  };
}

/**
 * Registers a client with an authorization server (RFC 7591).
 *
 * @remarks
 * The request carries the metadata and asks for the authorization code, refresh token and client credentials grants (all but the
 * last for a public client) and the `code` response type. The result holds the identifier and the secret that the server issued, as an `OAuthClient` that the
 * other calls take. The host stores it: the secret is shown once.
 *
 * @param server - The authorization server, which needs a `registrationEndpoint`.
 * @param metadata - What the client tells the server about itself.
 * @param options - The `fetch`, the deadline, the signal and the clock.
 * @returns The registered client.
 * @throws `DataError` when an argument is not valid, or the server has no registration endpoint.
 * @throws `ServiceError` when the server does not answer, answers with an error status, refuses the metadata, such as with
 * `invalid_redirect_uri`, or registers the client for a method that this cannot use.
 * @throws The `reason` of the signal when it aborts.
 */
export async function registerClient(
  server: AuthorizationServer,
  metadata: ClientMetadata,
  options: OAuthCallOptions,
): Promise<RegisteredClient> {
  checkAuthorizationServer(server, "registrationEndpoint");
  checkMetadata(metadata);
  checkOAuthCallOptions(options);
  const what = `The registration endpoint ${server.registrationEndpoint}`;
  return exchange(options, what, async (through) => {
    const response = await oauth.dynamicClientRegistrationRequest(
      libraryServer(server),
      registrationRequest(metadata),
      through,
    );
    const answer = await oauth.processDynamicClientRegistrationResponse(response);
    return readRegisteredClient(answer, metadata.tokenEndpointAuthMethod ?? "client_secret_basic", what);
  });
}
