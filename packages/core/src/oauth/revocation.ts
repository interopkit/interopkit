import * as oauth from "oauth4webapi";
import { checkNonEmptyString } from "../checks.js";
import { checkOAuthClient, clientAuthentication, libraryClient, type OAuthClient } from "./client.js";
import { checkOAuthCallOptions, exchange, type OAuthCallOptions } from "./request.js";
import { type AuthorizationServer, checkAuthorizationServer, libraryServer } from "./server.js";

/**
 * Revokes an access token or a refresh token (RFC 7009).
 *
 * @remarks
 * Revoking a token that is already revoked, or that the server does not know, succeeds: the server answers 200 for both, so
 * a repeat is safe.
 *
 * @param server - The authorization server, which needs a `revocationEndpoint`.
 * @param client - The client and how it authenticates.
 * @param token - The token to revoke.
 * @param options - The `fetch`, the deadline, the signal and the clock.
 * @throws `DataError` when an argument is not valid, or the server has no revocation endpoint.
 * @throws `ServiceError` when the server does not answer, answers with an error status, or refuses the request, such as with `unsupported_token_type`.
 * @throws The `reason` of the signal when it aborts.
 */
export async function revokeToken(
  server: AuthorizationServer,
  client: OAuthClient,
  token: string,
  options: OAuthCallOptions,
): Promise<void> {
  checkAuthorizationServer(server, "revocationEndpoint");
  checkOAuthClient(client);
  checkNonEmptyString(token, "The token");
  checkOAuthCallOptions(options);
  await exchange(options, `The revocation endpoint ${server.revocationEndpoint}`, async (through) => {
    const response = await oauth.revocationRequest(
      libraryServer(server),
      libraryClient(client),
      clientAuthentication(server, client, options),
      token,
      through,
    );
    await oauth.processRevocationResponse(response);
  });
}
