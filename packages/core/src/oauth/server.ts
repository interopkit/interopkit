// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 metadata and requests are snake_case.

import type * as oauth from "oauth4webapi";
import { checkHttpsUrl, checkNonEmptyString, checkRecord } from "../checks.js";
import { DataError } from "../errors.js";

/** The authorization server that a client talks to: the addresses of its endpoints, and how it names itself in assertions. */
export interface AuthorizationServer {
  /** The address of the token endpoint, an `https` URL. */
  readonly tokenEndpoint: string;
  /**
   * The address of the authorization endpoint, which `authorizationRequest` needs.
   *
   * @defaultValue none
   */
  readonly authorizationEndpoint?: string;
  /**
   * The address of the registration endpoint (RFC 7591), which `registerClient` needs.
   *
   * @defaultValue none
   */
  readonly registrationEndpoint?: string;
  /**
   * The address of the revocation endpoint (RFC 7009), which `revokeToken` needs.
   *
   * @defaultValue none
   */
  readonly revocationEndpoint?: string;
  /**
   * The `aud` of a JWT client assertion.
   *
   * @defaultValue `tokenEndpoint`
   */
  readonly audience?: string;
  /**
   * The issuer identifier of the server, an `https` URL. A callback that carries an `iss` (RFC 9207) is accepted only when it
   * equals this, which defeats a mix-up between authorization servers.
   *
   * @defaultValue none, and then the `iss` of a callback is not checked
   */
  readonly issuer?: string;
}

/** The endpoints of a server that an operation may need. */
export type EndpointName = "authorizationEndpoint" | "registrationEndpoint" | "revocationEndpoint";

/**
 * Checks a server, as a host passes it from JavaScript.
 *
 * @param needs - The endpoint that the operation calls besides the token endpoint, which then must be there.
 * @throws `DataError` when an address is not an `https` URL, `audience` is not a non-empty string, or the needed endpoint is missing.
 */
export function checkAuthorizationServer(value: unknown, needs?: EndpointName): asserts value is AuthorizationServer {
  checkRecord(value, "The authorization server must be an object");
  checkHttpsUrl(value.tokenEndpoint, "The tokenEndpoint of the authorization server");
  for (const name of ["authorizationEndpoint", "registrationEndpoint", "revocationEndpoint", "issuer"] as const) {
    if (value[name] !== undefined) checkHttpsUrl(value[name], `The ${name} of the authorization server`);
  }
  if (value.audience !== undefined) checkNonEmptyString(value.audience, "The audience of the authorization server");
  if (needs !== undefined && value[needs] === undefined) {
    throw new DataError(`The authorization server must have a ${needs} for this call, found none.`);
  }
}

/** Describes the server to oauth4webapi, which wants an issuer even where it does not use one. */
export function libraryServer(server: AuthorizationServer): oauth.AuthorizationServer {
  return {
    issuer: server.issuer ?? server.tokenEndpoint,
    token_endpoint: server.tokenEndpoint,
    ...(server.authorizationEndpoint === undefined ? {} : { authorization_endpoint: server.authorizationEndpoint }),
    ...(server.registrationEndpoint === undefined ? {} : { registration_endpoint: server.registrationEndpoint }),
    ...(server.revocationEndpoint === undefined ? {} : { revocation_endpoint: server.revocationEndpoint }),
  };
}
