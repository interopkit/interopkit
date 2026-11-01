import type * as oauth from "oauth4webapi";
import { ServiceError } from "../errors.js";
import { splitScope } from "./scope.js";
import { MILLISECONDS_PER_SECOND } from "./time.js";

/** A token that grants access to an API, and when it stops doing so. */
export interface AccessToken {
  /** The token, to send as `Authorization: Bearer`. */
  readonly accessToken: string;
  /** Epoch milliseconds; absent when the server gave no `expires_in`. */
  readonly expiresAt?: number;
  /**
   * The token that gets a new access token.
   *
   * @defaultValue none
   */
  readonly refreshToken?: string;
  /** The scopes that the token grants: those the server names, else those that were asked for. */
  readonly scopes: readonly string[];
}

/**
 * Reads the answer of a token endpoint into an `AccessToken`.
 *
 * @param response - The answer, which oauth4webapi has validated.
 * @param asked - The scopes that the request named, which the token has when the server names none (RFC 6749 section 5.1).
 * @param now - The time of the answer, in epoch milliseconds, which `expires_in` counts from.
 * @param what - Names the service in the error message.
 * @throws `ServiceError` when the token is not a bearer token, which only works together with proofs that this does not make.
 */
export function readAccessToken(
  response: oauth.TokenEndpointResponse,
  asked: readonly string[],
  now: number,
  what: string,
): AccessToken {
  if (response.token_type !== "bearer") {
    // No body: the answer holds the token.
    throw new ServiceError(
      `${what} issued a ${response.token_type} token, and only bearer tokens are supported.`,
      200,
      "",
    );
  }
  const named = splitScope(response.scope);
  return {
    accessToken: response.access_token,
    ...(response.expires_in === undefined
      ? {}
      : { expiresAt: now + Math.round(response.expires_in * MILLISECONDS_PER_SECOND) }),
    ...(response.refresh_token === undefined ? {} : { refreshToken: response.refresh_token }),
    scopes: response.scope === undefined ? [...asked] : named,
  };
}
