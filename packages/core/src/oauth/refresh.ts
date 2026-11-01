import * as oauth from "oauth4webapi";
import { checkNonEmptyString } from "../checks.js";
import { readClock } from "../clock.js";
import { type AccessToken, readAccessToken } from "./access-token.js";
import { checkOAuthClient, clientAuthentication, libraryClient, type OAuthClient } from "./client.js";
import { checkOAuthCallOptions, exchange, type OAuthCallOptions } from "./request.js";
import { type AuthorizationServer, checkAuthorizationServer, libraryServer } from "./server.js";

/**
 * Gets a new access token with a refresh token (RFC 6749 section 6).
 *
 * @remarks
 * A server may issue a new refresh token or keep the old one: the result has `refreshToken` only when the server sent one, and
 * the host then keeps the one it has. `scopes` are those the server names, and none when it names none, since the refresh
 * request asks for no scopes. A refresh token that is used twice may be refused by the server: the host authorizes again.
 *
 * @param server - The authorization server.
 * @param client - The client and how it authenticates.
 * @param refreshToken - The refresh token.
 * @param options - The `fetch`, the deadline, the signal and the clock.
 * @returns The new token.
 * @throws `DataError` when an argument is not valid.
 * @throws `ServiceError` when the server does not answer, answers with an error status, or refuses the grant, such as with `invalid_grant`.
 * @throws The `reason` of the signal when it aborts.
 */
export async function refreshAccessToken(
  server: AuthorizationServer,
  client: OAuthClient,
  refreshToken: string,
  options: OAuthCallOptions,
): Promise<AccessToken> {
  checkAuthorizationServer(server);
  checkOAuthClient(client);
  checkNonEmptyString(refreshToken, "The refresh token");
  checkOAuthCallOptions(options);
  const what = `The token endpoint ${server.tokenEndpoint}`;
  return exchange(options, what, async (through) => {
    const library = libraryServer(server);
    const caller = libraryClient(client);
    const response = await oauth.refreshTokenGrantRequest(
      library,
      caller,
      clientAuthentication(server, client, options),
      refreshToken,
      through,
    );
    return readAccessToken(
      await oauth.processRefreshTokenResponse(library, caller, response),
      [],
      readClock(options.clock),
      what,
    );
  });
}
