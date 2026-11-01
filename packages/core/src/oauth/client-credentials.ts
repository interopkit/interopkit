import * as oauth from "oauth4webapi";
import { readClock } from "../clock.js";
import { type AccessToken, readAccessToken } from "./access-token.js";
import { checkOAuthClient, clientAuthentication, libraryClient, type OAuthClient } from "./client.js";
import { checkOAuthCallOptions, exchange, type OAuthCallOptions } from "./request.js";
import { checkScopes } from "./scope.js";
import { type AuthorizationServer, checkAuthorizationServer, libraryServer } from "./server.js";

/**
 * Gets an access token for the client itself with the client credentials grant (RFC 6749 section 4.4).
 *
 * @remarks
 * With `private_key_jwt` this is the token request of the LTI Security Framework 1.1 section 4.1: the assertion has
 * `iss` and `sub` of the client, `aud` of the token endpoint (or `server.audience`), `iat`, `exp` and a fresh `jti`.
 *
 * @param server - The authorization server.
 * @param client - The client and how it authenticates.
 * @param scopes - The scopes to ask for. None leaves the choice to the server.
 * @param options - The `fetch`, the deadline, the signal and the clock.
 * @returns The token. `scopes` are those the server names, else those asked for.
 * @throws `DataError` when an argument is not valid.
 * @throws `ServiceError` when the server does not answer, answers with an error status, or refuses the grant: the message
 * names the OAuth `error` and `body` holds the answer.
 * @throws The `reason` of the signal when it aborts.
 */
export async function clientCredentialsToken(
  server: AuthorizationServer,
  client: OAuthClient,
  scopes: readonly string[],
  options: OAuthCallOptions,
): Promise<AccessToken> {
  checkAuthorizationServer(server);
  checkOAuthClient(client);
  checkScopes(scopes);
  checkOAuthCallOptions(options);
  const what = `The token endpoint ${server.tokenEndpoint}`;
  return exchange(options, what, async (through) => {
    const library = libraryServer(server);
    const caller = libraryClient(client);
    const response = await oauth.clientCredentialsGrantRequest(
      library,
      caller,
      clientAuthentication(server, client, options),
      scopes.length === 0 ? {} : { scope: scopes.join(" ") },
      through,
    );
    return readAccessToken(
      await oauth.processClientCredentialsResponse(library, caller, response),
      scopes,
      readClock(options.clock),
      what,
    );
  });
}
