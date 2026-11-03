import { callPort, DataError, readClock, ServiceError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { buildJsonResponse, type HttpRequest, type HttpResponse, readForm } from "@interopkit/core/http";
import { LtiError } from "../errors.js";
import {
  CLAIM,
  CLIENT_CREDENTIALS_GRANT,
  IDENTIFIER,
  JWT_BEARER_ASSERTION_TYPE,
  NON_EMPTY_STRING,
  optional,
  required,
  toSeconds,
} from "../protocol/internal.js";
import { methodNotAllowed, NO_STORE, refusal, serverError } from "./answers.js";
import { endpointsOf } from "./config.js";
import type { PlatformSettings } from "./options.js";
import type { ToolRegistration } from "./registration.js";
import { offeredScopes } from "./services/routes.js";
import { sealAccess } from "./tokens.js";
import { checkLifetime, issuerOf, spentUntil, toolFrom, verifyToolJwt } from "./tool-message.js";

// Security Framework sections 4.1.1 and 7.1.1: the recommended lifetime of an access token is one hour.
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const OWNER = "The client assertion";

/** The error codes of RFC 6749 section 5.2 that the endpoint answers with, by the reason of the check that failed. */
const OAUTH_ERRORS: ReadonlyMap<string, string> = new Map([
  ["unsupported-grant-type", "unsupported_grant_type"],
  ["request-invalid", "invalid_request"],
  ["scope-invalid", "invalid_scope"],
]);

/** What a port that failed leaves the route to answer: 500, with nothing of the cause. */
const FAILED = Symbol("failed");

/** What a token request asks for: the assertion, the scopes and the client that it names beside the assertion, if any. */
interface TokenRequest {
  readonly assertion: string;
  readonly scopes: readonly string[];
  readonly clientId?: string | undefined;
}

/** Reads the form of the request: the grant, the assertion type, the assertion, the scopes and the client. */
function readRequest(request: HttpRequest): TokenRequest {
  let form: ReadonlyMap<string, string>;
  try {
    form = readForm(request);
  } catch (error) {
    if (error instanceof DataError) throw new LtiError(error.message, "request-invalid");
    throw error;
  }
  if (form.get("grant_type") !== CLIENT_CREDENTIALS_GRANT) {
    throw new LtiError(`The grant_type must be ${CLIENT_CREDENTIALS_GRANT}.`, "unsupported-grant-type");
  }
  if (form.get("client_assertion_type") !== JWT_BEARER_ASSERTION_TYPE) {
    throw new LtiError(`The client_assertion_type must be ${JWT_BEARER_ASSERTION_TYPE}.`, "request-invalid");
  }
  const assertion = form.get("client_assertion");
  if (assertion === undefined || assertion === "") {
    throw new LtiError("The token request must have a client_assertion.", "request-invalid");
  }
  // A scope named twice is one scope (RFC 6749 section 3.3), and the token names it once.
  const scopes = [...new Set((form.get("scope") ?? "").split(" ").filter((scope) => scope !== ""))];
  if (scopes.length === 0) throw new LtiError("The token request must have a scope.", "scope-invalid");
  return { assertion, scopes, clientId: form.get("client_id") };
}

/** A verified assertion: the tool, and the deployment that it named. */
interface Verified {
  readonly registration: ToolRegistration;
  readonly deployment?: string;
}

/**
 * Finds the tool that an assertion names as its issuer. A `client_id` of the request must name the same client (RFC 7521
 * section 4.2).
 */
async function findTool(
  { assertion, clientId: named }: TokenRequest,
  settings: PlatformSettings,
): Promise<ToolRegistration | typeof FAILED> {
  const clientId = issuerOf(assertion, OWNER);
  if (named !== undefined && named !== clientId) {
    throw new LtiError(
      `The client_id of the request, ${describe(named)}, is not the issuer of its assertion.`,
      "client-mismatch",
    );
  }
  const { signal } = settings;
  const asked = await callPort(() => settings.client(clientId, { signal }), signal);
  return asked === undefined ? FAILED : toolFrom(asked.value, clientId);
}

/**
 * Verifies the client assertion (Security Framework sections 4.1.1 and 5.2.2, LTI 1.3 Core section 6.2, RFC 7523 section 3): the
 * tool named by `iss` signed it with an algorithm of its registration and a key of its key set; `iss` and `sub` are its client
 * identifier; `aud` holds the token URL and no other party than the platform's issuer; it carries no `message_type`, so that a
 * message of the tool never passes as an assertion; it has not expired and does not expire in too long; the deployment it names,
 * if any, is the tool's; and its non-empty `jti` is one that `once` has not seen. The `jti` is remembered until the expiry,
 * rounded up to a whole second, plus the clock-skew leeway of 60 seconds, as long as the assertion verifies.
 */
async function verifyAssertion(asked: TokenRequest, settings: PlatformSettings): Promise<Verified | typeof FAILED> {
  const { assertion } = asked;
  const registration = await findTool(asked, settings);
  if (registration === FAILED) return FAILED;
  const { clientId } = registration;
  const nowMilliseconds = readClock(settings.clock);
  const { signal } = settings;
  const claims = await verifyToolJwt(
    assertion,
    registration,
    {
      audience: endpointsOf(settings.config).token,
      trustedAudiences: [settings.config.issuer],
      subject: clientId,
      requiredClaims: ["exp"],
    },
    settings,
  );
  if (claims[CLAIM.messageType] !== undefined) {
    throw new LtiError("A client assertion must not be a message of the tool: it has a message_type.", "claim-invalid");
  }
  const exp = checkLifetime(claims, nowMilliseconds, OWNER);
  const deployment = optional(claims, CLAIM.deploymentId, OWNER, IDENTIFIER);
  if (deployment !== undefined && !registration.deploymentIds.includes(deployment)) {
    throw new LtiError(
      `The assertion names the deployment ${describe(deployment)}, which is not one of the deployments of the tool.`,
      "deployment-unknown",
    );
  }
  const jti = required(claims, "jti", OWNER, NON_EMPTY_STRING);
  // An abort before `once` leaves the assertion unspent, since `callPort` checks the signal first. Once it is spent, a later
  // abort fails closed: the tool asks again.
  const recorded = await callPort(
    () => settings.once(`assertion:${clientId}:${jti}`, spentUntil(exp), { signal }),
    signal,
  );
  if (recorded === undefined) return FAILED;
  if (typeof recorded.value !== "boolean") {
    throw new DataError(`The option once must resolve with a boolean, found ${describe(recorded.value)}.`);
  }
  if (!recorded.value) throw new LtiError("The jti of the assertion has been used.", "assertion-replayed");
  return deployment === undefined ? { registration } : { registration, deployment };
}

/**
 * Answers a token request: the route `/token` of `handlePlatformRequest`, the OAuth 2.0 client-credentials grant with a JWT
 * assertion (Security Framework section 4.1.1, LTI 1.3 Core section 6.2).
 *
 * @remarks
 * The token grants the scopes that the request asks for, the registration grants and a service of the platform offers, which
 * it does when its store is given; `invalid_scope` answers only when none remains (Security Framework sections 4.1 and 7.1.4). It is sealed with the hint key,
 * holds the client, the deployment of the assertion when it named one, the scopes and the expiry, and lasts one hour. A request
 * that fails a check gets status 400 with the error code of RFC 6749 section 5.2 (`invalid_request`, `unsupported_grant_type`,
 * `invalid_scope`, and `invalid_client` for an assertion that fails). The checks, in order: the method, the size, the form,
 * `grant_type`, `client_assertion_type`, the scopes, the tool, a `client_id` of the request that names it, its algorithms, its key
 * and the signature, `sub`, `aud`, the times, the `message_type`, the deployment, the single use of the `jti`, and the scopes
 * that remain.
 */
export async function answerToken(request: HttpRequest, settings: PlatformSettings): Promise<HttpResponse> {
  if (request.method !== "POST") return methodNotAllowed(request.method, "POST");
  if (request.body.byteLength > settings.maxBodyBytes) {
    return refusal(
      400,
      "invalid_request",
      `The token request has ${request.body.byteLength} bytes, above the limit of ${settings.maxBodyBytes} bytes.`,
    );
  }
  try {
    const asked = readRequest(request);
    const verified = await verifyAssertion(asked, settings);
    if (verified === FAILED) return serverError();
    const { registration, deployment } = verified;
    const offered = offeredScopes(settings);
    const granted = asked.scopes.filter((scope) => registration.scopes.includes(scope) && offered.includes(scope));
    if (granted.length === 0) {
      throw new LtiError("The platform grants the tool none of the scopes of the request.", "scope-invalid");
    }
    const exp = toSeconds(readClock(settings.clock)) + ACCESS_TOKEN_TTL_SECONDS;
    const access = {
      client: registration.clientId,
      ...(deployment === undefined ? {} : { deployment }),
      scopes: granted,
      exp,
    };
    const body = Object.fromEntries([
      ["access_token", await sealAccess(access, settings.config.hintKey)],
      ["token_type", "Bearer"],
      ["expires_in", ACCESS_TOKEN_TTL_SECONDS],
      ["scope", granted.join(" ")],
    ]);
    return buildJsonResponse(200, body, NO_STORE);
  } catch (error) {
    if (error instanceof LtiError)
      return refusal(400, OAUTH_ERRORS.get(error.reason) ?? "invalid_client", error.message);
    // The key set of the tool could not be fetched: the platform cannot tell whether the assertion is good.
    if (error instanceof ServiceError) return serverError();
    throw error;
  }
}
