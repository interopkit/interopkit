// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 error responses are snake_case.

import * as oauth from "oauth4webapi";
import { checkNonEmptyString, checkRecord, describe } from "../checks.js";
import { readClock } from "../clock.js";
import { DataError, ServiceError } from "../errors.js";
import { type AccessToken, readAccessToken } from "./access-token.js";
import { checkOAuthClient, clientAuthentication, libraryClient, type OAuthClient } from "./client.js";
import { checkOAuthCallOptions, exchange, type OAuthCallOptions } from "./request.js";
import { checkScopes, splitScope } from "./scope.js";
import { type AuthorizationServer, checkAuthorizationServer, libraryServer } from "./server.js";

/** What the host keeps in the browser's session between the redirect and the callback. */
export interface PendingAuthorization {
  /** The address to send the user's browser to. */
  readonly url: string;
  /** The `state` that the callback must carry back. */
  readonly state: string;
  /** The PKCE code verifier (RFC 7636), a secret that goes to the token endpoint. */
  readonly codeVerifier: string;
  /** The redirect URI of the request, which the token request repeats. */
  readonly redirectUri: string;
}

/** What `authorizationRequest` asks for. */
export interface AuthorizationRequestParameters {
  /** Where the server sends the browser back to, an absolute URL that the client registered. */
  readonly redirectUri: string;
  /** The scopes to ask for. None leaves the choice to the server. */
  readonly scopes: readonly string[];
}

/**
 * Starts the authorization code flow with PKCE (RFC 6749 section 4.1, RFC 7636): builds the address that the host sends the
 * user's browser to.
 *
 * @remarks
 * The `state` and the code verifier are random, from `crypto.getRandomValues`, and the challenge is S256. The host keeps the
 * result, which holds a secret, in the user's session, and hands it back to `exchangeCode` at the callback.
 *
 * @param server - The authorization server, which needs an `authorizationEndpoint`.
 * @param client - The client.
 * @param request - The redirect URI and the scopes.
 * @returns The address and what the callback needs.
 * @throws `DataError` when an argument is not valid, or the server has no authorization endpoint.
 */
export async function authorizationRequest(
  server: AuthorizationServer,
  client: OAuthClient,
  request: AuthorizationRequestParameters,
): Promise<PendingAuthorization> {
  checkAuthorizationServer(server, "authorizationEndpoint");
  checkOAuthClient(client);
  checkRecord(request, "The authorization request must be an object");
  checkUrl(request.redirectUri, "The redirectUri of the authorization request");
  checkScopes(request.scopes);
  const state = oauth.generateRandomState();
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const url = new URL(server.authorizationEndpoint ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  if (request.scopes.length > 0) url.searchParams.set("scope", request.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.href, state, codeVerifier, redirectUri: request.redirectUri };
}

/** Checks that a value is an absolute URL. */
function checkUrl(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !URL.canParse(value)) {
    throw new DataError(`${label} must be an absolute URL, found ${describe(value)}.`);
  }
}

/** Checks what the host kept, as it comes back from the session. */
function checkPending(value: unknown): asserts value is PendingAuthorization {
  checkRecord(value, "The pending authorization must be an object");
  checkUrl(value.url, "The url of the pending authorization");
  checkNonEmptyString(value.state, "The state of the pending authorization");
  checkNonEmptyString(value.codeVerifier, "The codeVerifier of the pending authorization");
  checkUrl(value.redirectUri, "The redirectUri of the pending authorization");
}

/**
 * Checks the parameters of the callback against the request, and says what is wrong with them: a callback that does not match
 * the request is a `DataError`, and one that carries the server's refusal is a `ServiceError` with the refusal in `body`.
 */
function checkCallback(
  server: AuthorizationServer,
  client: OAuthClient,
  callback: URL,
  pending: PendingAuthorization,
): URLSearchParams {
  const parameters = new URLSearchParams(callback.searchParams);
  // Without an issuer to compare with, the `iss` of the callback cannot be checked.
  if (server.issuer === undefined) parameters.delete("iss");
  let validated: URLSearchParams;
  try {
    validated = oauth.validateAuthResponse(libraryServer(server), libraryClient(client), parameters, pending.state);
  } catch (error) {
    if (error instanceof oauth.AuthorizationResponseError) {
      const body = JSON.stringify({ error: error.error, error_description: error.error_description });
      const description = error.error_description === undefined ? "" : ` (${error.error_description})`;
      // The refusal comes in the redirect, which has no status: 400 stands for it.
      throw new ServiceError(
        `The authorization server refused the authorization: ${error.error}${description}.`,
        400,
        body,
      );
    }
    // What else oauth4webapi finds wrong with the callback: another or no `state` or `iss`, or the tokens of an implicit flow.
    throw new DataError(
      `The callback does not answer the authorization request: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (!validated.get("code"))
    throw new DataError("The callback does not answer the authorization request: it has no code.");
  return validated;
}

/**
 * Finishes the authorization code flow: checks the callback and exchanges its code for an access token (RFC 6749 section 4.1.3).
 *
 * @remarks
 * The callback must carry the `state` of the request, and its `iss` when `server.issuer` is set (RFC 9207). The token request
 * sends the code, the redirect URI and the PKCE code verifier. `scopes` are those the server names, else those of the
 * authorization request. An OpenID Connect token response, with an `id_token`, is not read.
 *
 * @param server - The authorization server.
 * @param client - The client and how it authenticates.
 * @param callbackUrl - The address that the server sent the browser back to, with its query.
 * @param pending - What `authorizationRequest` returned.
 * @param options - The `fetch`, the deadline, the signal and the clock.
 * @returns The token.
 * @throws `DataError` when an argument is not valid, or the callback does not match the request: another `state`, another
 * `iss`, or no code.
 * @throws `ServiceError` with status 400 when the callback carries the server's refusal, such as `access_denied`, and
 * otherwise when the server does not answer, answers with an error status or refuses the code.
 * @throws The `reason` of the signal when it aborts.
 */
export async function exchangeCode(
  server: AuthorizationServer,
  client: OAuthClient,
  callbackUrl: string,
  pending: PendingAuthorization,
  options: OAuthCallOptions,
): Promise<AccessToken> {
  checkAuthorizationServer(server);
  checkOAuthClient(client);
  checkUrl(callbackUrl, "The callback URL");
  checkPending(pending);
  checkOAuthCallOptions(options);
  const parameters = checkCallback(server, client, new URL(callbackUrl), pending);
  const what = `The token endpoint ${server.tokenEndpoint}`;
  return exchange(options, what, async (through) => {
    const library = libraryServer(server);
    const caller = libraryClient(client);
    const response = await oauth.authorizationCodeGrantRequest(
      library,
      caller,
      clientAuthentication(server, client, options),
      parameters,
      pending.redirectUri,
      pending.codeVerifier,
      through,
    );
    const token = await oauth.processAuthorizationCodeResponse(library, caller, response, {
      expectedNonce: oauth.expectNoNonce,
    });
    const asked = splitScope(new URL(pending.url).searchParams.get("scope"));
    return readAccessToken(token, asked, readClock(options.clock), what);
  });
}
