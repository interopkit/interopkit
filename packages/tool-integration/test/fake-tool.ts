// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.

import type { HttpRequest } from "@interopkit/core/http";
import { createLocalJWKSet, type JWK, jwtVerify, SignJWT } from "jose";
import { expect } from "vitest";
import type { ToolRegistration } from "../src/platform/index.js";
import { type KeyPair, request, signToken, type TestClock } from "./fixture.js";

/**
 * A conformant LTI 1.3 tool for the tests of the platform role. It is written from the specifications, not from the code
 * under test: Security Framework section 5.1.1 (the login and the authentication request), section 5.1.3 (the validation of the
 * id_token, with jose), section 4.1.1 (the client assertion) and LTI 1.3 Core sections 4.1 and 5 (the parameters and the claims
 * it relies on).
 */

export const TOOL_ORIGIN = "https://tool.example.com";
export const TOOL_CLIENT_ID = "tool-client-1";
export const TOOL_DEPLOYMENT_ID = "deployment-1";
export const TOOL_LOGIN_URL = `${TOOL_ORIGIN}/lti/login`;
export const TOOL_REDIRECT_URI = `${TOOL_ORIGIN}/lti/launch`;
export const TOOL_LAUNCH_URL = `${TOOL_ORIGIN}/lti/tools/drawing`;
export const TOOL_JWKS_URL = `${TOOL_ORIGIN}/.well-known/jwks.json`;

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";

/** The registration that the platform keeps of the tool. */
export function toolRegistration(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    clientId: TOOL_CLIENT_ID,
    deploymentIds: [TOOL_DEPLOYMENT_ID],
    loginUrl: TOOL_LOGIN_URL,
    redirectUris: [TOOL_REDIRECT_URI],
    jwksUrl: TOOL_JWKS_URL,
    scopes: [],
    ...overrides,
  };
}

/** The parameters of a third-party initiated login (Security Framework section 5.1.1.1, LTI 1.3 Core section 4.1). */
export interface Initiation {
  readonly iss: string;
  readonly loginHint: string;
  readonly targetLinkUri: string;
  readonly messageHint: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly storageTarget: string;
}

/** Reads the initiation URL as a tool does: the parameters that the specifications require must be there. */
export function readInitiation(url: string, loginUrl = TOOL_LOGIN_URL): Initiation {
  const parsed = new URL(url);
  expect(`${parsed.origin}${parsed.pathname}`).toBe(loginUrl);
  const parameters = parsed.searchParams;
  const get = (name: string): string => {
    const value = parameters.get(name);
    expect(value, name).toBeTruthy();
    return value ?? "";
  };
  return {
    iss: get("iss"),
    loginHint: get("login_hint"),
    targetLinkUri: get("target_link_uri"),
    messageHint: get("lti_message_hint"),
    clientId: get("client_id"),
    deploymentId: get("lti_deployment_id"),
    storageTarget: get("lti_storage_target"),
  };
}

/**
 * Builds the tool's authentication request (Security Framework section 5.1.1.2) as the parameters of the table there: `scope`,
 * `response_type`, `client_id`, `redirect_uri`, `login_hint`, `state`, `response_mode`, `nonce`, `prompt`, and the
 * `lti_message_hint` that LTI 1.3 Core section 4.1.1 has the tool return unaltered.
 */
export function authenticationParameters(
  initiation: Initiation,
  state = "state-1",
  nonce = "nonce-1",
  redirectUri = TOOL_REDIRECT_URI,
): URLSearchParams {
  return new URLSearchParams([
    ["scope", "openid"],
    ["response_type", "id_token"],
    ["client_id", initiation.clientId],
    ["redirect_uri", redirectUri],
    ["login_hint", initiation.loginHint],
    ["state", state],
    ["response_mode", "form_post"],
    ["nonce", nonce],
    ["prompt", "none"],
    ["lti_message_hint", initiation.messageHint],
  ]);
}

/** The request to the authorization endpoint: a GET with the parameters in the query, or a form POST. */
export function authenticationRequest(
  endpoint: string,
  parameters: URLSearchParams,
  method: "GET" | "POST" = "GET",
): HttpRequest {
  if (method === "GET") return request({ url: `${endpoint}?${parameters}` });
  return request({
    method: "POST",
    url: endpoint,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: parameters.toString(),
  });
}

/** The fields of a key set, as RFC 7517 section 5 gives them. */
export interface KeySetBody {
  readonly keys: readonly JWK[];
}

/**
 * Validates an `id_token` as Security Framework section 5.1.3 and LTI 1.3 Core section 5.3 say a tool must, with jose: the
 * signature against the platform's key set by `kid` with an approved algorithm, `iss`, `aud` (the client id alone), `exp`,
 * `iat`, `nonce`, and the claims that every message has. It returns the claims.
 */
export async function acceptIdToken(
  idToken: string,
  keySet: KeySetBody,
  expected: { issuer: string; nonce: string; clock: TestClock },
): Promise<Record<string, unknown>> {
  const { payload, protectedHeader } = await jwtVerify(idToken, createLocalJWKSet({ keys: [...keySet.keys] }), {
    issuer: expected.issuer,
    audience: TOOL_CLIENT_ID,
    algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
    currentDate: new Date(expected.clock.now()),
  });
  expect(protectedHeader.typ).toBe("JWT");
  expect([payload.aud].flat()).toEqual([TOOL_CLIENT_ID]);
  expect(Number(payload.iat)).toBeLessThanOrEqual(expected.clock.now() / 1000);
  expect(payload.nonce).toBe(expected.nonce);
  expect(payload[`${CLAIM}version`]).toBe("1.3.0");
  expect(typeof payload[`${CLAIM}message_type`]).toBe("string");
  expect(typeof payload[`${CLAIM}deployment_id`]).toBe("string");
  expect(Array.isArray(payload[`${CLAIM}roles`])).toBe(true);
  expect(payload[`${CLAIM}target_link_uri`]).toBeTruthy();
  return payload;
}

/** The options of a client assertion (Security Framework section 4.1.1) that a test may change. */
export interface Assertion {
  readonly iss?: string;
  readonly sub?: string;
  readonly aud?: unknown;
  readonly iat?: number | undefined;
  readonly exp?: number | undefined;
  readonly jti?: string | undefined;
  readonly [claim: string]: unknown;
}

/** The claims of the client assertion that Security Framework section 4.1.1 describes, with `exp` five minutes after `iat`. */
function assertionClaims(tokenUrl: string, clock: TestClock, change: Assertion): Record<string, unknown> {
  const iat = Math.floor(clock.now() / 1000);
  return {
    iss: TOOL_CLIENT_ID,
    sub: TOOL_CLIENT_ID,
    aud: tokenUrl,
    iat,
    exp: iat + 300,
    jti: crypto.randomUUID(),
    ...change,
  };
}

/** Signs a client assertion with an RSA key for RS256; `header` replaces fields of the default header. */
export function clientAssertion(
  tool: KeyPair,
  tokenUrl: string,
  clock: TestClock,
  change: Assertion = {},
  header: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  return signToken(assertionClaims(tokenUrl, clock, change), tool, header);
}

/** A key of a tool for an elliptic curve algorithm, with its `kid`. */
export interface EcKey {
  readonly kid: string;
  readonly algorithm: "ES256" | "ES384" | "ES512";
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
}

/** Generates an elliptic curve key of a tool. */
export async function generateEcKey(kid: string, algorithm: EcKey["algorithm"] = "ES256"): Promise<EcKey> {
  const curve = { ES256: "P-256", ES384: "P-384", ES512: "P-521" }[algorithm];
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: curve }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return { kid, algorithm, privateKey: pair.privateKey, publicKey: pair.publicKey };
}

/** Signs a client assertion with an elliptic curve key, with jose. */
export function ecAssertion(tool: EcKey, tokenUrl: string, clock: TestClock, change: Assertion = {}): Promise<string> {
  return new SignJWT(assertionClaims(tokenUrl, clock, change))
    .setProtectedHeader({ alg: tool.algorithm, kid: tool.kid, typ: "JWT" })
    .sign(tool.privateKey);
}

/** The token request of the client-credentials grant with a JWT assertion (Security Framework section 4.1.1). */
export function tokenRequest(
  tokenUrl: string,
  assertion: string,
  scope: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
): HttpRequest {
  const fields: Record<string, string | undefined> = {
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope,
    ...overrides,
  };
  const form = new URLSearchParams(
    Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return request({
    method: "POST",
    url: tokenUrl,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}
