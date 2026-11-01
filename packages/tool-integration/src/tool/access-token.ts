// biome-ignore-all lint/style/useNamingConvention: The names of the OAuth parameters are those of RFC 6749.

import { callService, DataError, DEFAULT_TIMEOUT_MS, readClock } from "@interopkit/core";
import {
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  describe,
  looseRecord,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
} from "@interopkit/core/checks";
import { SignJWT } from "jose";
import * as v from "valibot";
import {
  CLAIM,
  CLIENT_CREDENTIALS_GRANT,
  JWT_BEARER_ASSERTION_TYPE,
  MILLISECONDS,
  randomToken,
  rs256Header,
  toSeconds,
} from "../protocol/internal.js";
import type { LtiDeployment } from "./launch-model.js";
import { type AccessTokenOptions, checkToolOptions, findDeployment } from "./options.js";

// Security Framework section 4.1.1: the assertion expires "typically five minutes after the iat timestamp".
const ASSERTION_TTL_SECONDS = 300;

/** An access token for the services of a platform. */
export interface AccessToken {
  /** The token. A request to a service carries it as `Authorization: Bearer <value>`. */
  readonly value: string;
  /**
   * The time in milliseconds since 1970-01-01T00:00:00Z at which the token expires; request a new one after it. Absent when
   * the platform did not say (RFC 6749 section 5.1 only recommends `expires_in`): use the token until a service refuses it.
   */
  readonly expiresAt?: number | undefined;
  /** The scopes that the platform granted: all of those requested, or a subset (Security Framework section 4.1). */
  readonly scopes: readonly string[];
}

const tokenResponseSchema = looseRecord({
  access_token: nonEmptyStringSchema,
  token_type: v.pipe(
    v.string(),
    v.check(
      (type) => type.toLowerCase() === "bearer",
      (issue) => `expected "Bearer", found ${issue.received}`,
    ),
  ),
  expires_in: v.optional(positiveIntegerSchema),
  // RFC 6749 section 5.1: the response names the scope when it differs from the request.
  scope: v.optional(nonEmptyStringSchema),
});

/**
 * Reads the token response of RFC 6749 section 5.1 and Security Framework section 4.1.
 *
 * @throws `DataError` when the body is not a token response.
 */
export function readTokenResponse(body: string, requested: readonly string[], now: number): AccessToken {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new DataError("The token response must be JSON.");
  }
  const {
    access_token: value,
    expires_in: expiresIn,
    scope,
  } = parseWith(tokenResponseSchema, payload, "The token response");
  return {
    value,
    expiresAt: expiresIn === undefined ? undefined : now + expiresIn * MILLISECONDS,
    scopes: scope === undefined ? [...requested] : scope.split(" "),
  };
}

/** Checks the scopes the host asks for. */
function checkScopes(scopes: unknown): asserts scopes is readonly string[] {
  checkArray(scopes, "The scopes must be an array");
  if (scopes.length === 0) throw new DataError("The scopes must have at least one scope.");
  for (const scope of scopes) {
    if (typeof scope !== "string" || scope === "" || scope.includes(" ")) {
      throw new DataError(`A scope must be a non-empty string without spaces, found ${describe(scope)}.`);
    }
  }
}

/**
 * Requests an access token for the services of a platform with the OAuth 2.0 client-credentials grant and a JWT
 * assertion (Security Framework section 4.1.1, LTI 1.3 Core section 6.2, RFC 7523).
 *
 * @remarks
 * The assertion has `iss` and `sub` equal to the client identifier, `aud` equal to the token endpoint (or the `audience` of the
 * registration), `iat`, `exp`,
 * a `jti` and the deployment (LTI 1.3 Core section 6.2.1), and is signed with the key of the registration (RS256). The request
 * is a form POST to the token endpoint of the registration. The tool may reuse the token until `expiresAt`.
 *
 * @param deployment - The platform, client and deployment of the launch that the token is for.
 * @param scopes - The scopes to ask for, such as the AGS scopes that the launch's `ags.scopes` offers.
 * @param options - The registrations of the tool, its `fetch` and its clock.
 * @returns The token, and the time it expires when the platform says.
 * @throws `DataError` when an argument has the wrong type, or the platform's answer is not a token response.
 * @throws `LtiError` (`platform-unknown`, `deployment-unknown`) when the registration is gone or no longer lists the
 * deployment.
 * @throws `ServiceError` when the token endpoint does not answer with a success; `status` is `0` when it did not answer.
 * @throws The `reason` of `options.signal` when it aborts. The request may have reached the platform; each request has a
 * new `jti`, so a repeat is safe.
 */
export async function ltiAccessToken(
  deployment: LtiDeployment,
  scopes: readonly string[],
  options: AccessTokenOptions,
): Promise<AccessToken> {
  checkToolOptions(options);
  checkRecord(deployment, "The deployment must be an object");
  checkNonEmptyString(deployment.issuer, "The issuer of the deployment");
  checkNonEmptyString(deployment.clientId, "The client identifier of the deployment");
  checkNonEmptyString(deployment.deploymentId, "The deployment of the deployment");
  checkScopes(scopes);
  const { fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  checkFunction(fetch, "The option fetch must be a function");
  checkPositiveInteger(timeoutMs, "The option timeoutMs");
  const registration = await findDeployment(options, deployment);
  const iat = toSeconds(readClock(options.clock));
  const assertion = await new SignJWT({ [CLAIM.deploymentId]: deployment.deploymentId })
    .setProtectedHeader(rs256Header(registration.keyId))
    .setIssuer(registration.clientId)
    .setSubject(registration.clientId)
    .setAudience(registration.audience ?? registration.accessTokenUrl)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ASSERTION_TTL_SECONDS)
    .setJti(randomToken())
    .sign(registration.signingKey);
  const body = await callService(
    { fetch, timeoutMs, signal: options.signal },
    `The token endpoint ${registration.accessTokenUrl}`,
    registration.accessTokenUrl,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams([
        ["grant_type", CLIENT_CREDENTIALS_GRANT],
        ["client_assertion_type", JWT_BEARER_ASSERTION_TYPE],
        ["client_assertion", assertion],
        ["scope", scopes.join(" ")],
      ]).toString(),
    },
  );
  return readTokenResponse(body, scopes, readClock(options.clock));
}
