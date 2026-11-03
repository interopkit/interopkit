import type { CallOptions, Clock, Fetch } from "@interopkit/core";
import { type AccessToken, requestClientCredentialsToken } from "@interopkit/core/oauth";
import { CLAIM } from "../protocol/internal.js";
import type { PlatformRegistration } from "./registration.js";

/** What a token request needs beside the registration: the `fetch`, the deadline, the clock and the caller's signal. */
export interface TokenCall extends CallOptions {
  /** The `fetch` that calls the token endpoint. */
  readonly fetch: Fetch;
  /** The most time that the call may take, in milliseconds. */
  readonly timeoutMs: number;
  /**
   * Gives the `iat` and `exp` of the assertion and the expiry of the token.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
}

/**
 * Requests an access token for the services of a platform: the client credentials grant with a JWT assertion that the
 * registration's signer signs (Security Framework section 4.1.1, LTI 1.3 Core section 6.2, RFC 7523).
 *
 * @remarks
 * The assertion has `iss` and `sub` of the client, `aud` of the registration's `audience` or token endpoint, `iat`, `exp` five
 * minutes later, a fresh `jti`, and the deployment claim of LTI 1.3 Core section 6.2.1, so that the platform can scope the
 * token to the deployment.
 *
 * @param registration - The registration of the platform.
 * @param deploymentId - The deployment that the token is for.
 * @param scopes - The scopes to ask for.
 * @param call - The `fetch`, the deadline, the clock and the signal.
 * @returns The token, with the scopes that the platform granted, or those asked for when it names none.
 * @throws `ServiceError` when the token endpoint does not answer with a token.
 */
export function requestServiceToken(
  registration: PlatformRegistration,
  deploymentId: string,
  scopes: readonly string[],
  call: TokenCall,
): Promise<AccessToken> {
  const { accessTokenUrl, audience, clientId, signer } = registration;
  return requestClientCredentialsToken(
    { tokenEndpoint: accessTokenUrl, ...(audience === undefined ? {} : { audience }) },
    { clientId, authentication: { method: "private_key_jwt", signer, claims: { [CLAIM.deploymentId]: deploymentId } } },
    scopes,
    call,
  );
}
