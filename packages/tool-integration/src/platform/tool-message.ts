import { type Clock, DataError, readClock } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { type HttpRequest, readForm } from "@interopkit/core/http";
import { LtiError } from "../errors.js";
import {
  CLOCK_SKEW_SECONDS,
  type Claims,
  type JwksCache,
  MILLISECONDS,
  NON_EMPTY_STRING,
  NUMBER,
  required,
  STRING,
  unverifiedClaims,
  verifyJwt,
} from "../protocol/internal.js";
import type { ToolMessageSettings } from "./options.js";
import { readToolRegistration, type ToolRegistration, toolKeySet } from "./registration.js";

/** The form parameter that carries the signed message of a tool (Security Framework section 5.2.2). */
const MESSAGE_PARAMETER = "JWT";
const MESSAGE_OWNER = "The message of the tool";
// RFC 7523 section 3 lets the receiver refuse a token whose expiry is unreasonably far; the platform remembers the single-use
// identifier of a token until then. Security Framework section 4.1.1 has a token of the tool expire "typically five minutes"
// after `iat`.
const MAX_LIFETIME_SECONDS = 3600;

/** What a check of a token of a tool needs: the platform's tool key sets and its clock. */
interface ToolJwtContext {
  /** The cache of the key sets of tools. */
  readonly jwks: JwksCache;
  /** The source of the current time. */
  readonly clock: Clock;
  /** The signal of the call, which ends the wait for a key set. */
  readonly signal?: AbortSignal | undefined;
}

/** What a token of a tool must say about itself, beside being issued by the tool and signed with an algorithm and a key of its registration. */
interface ToolJwtExpectation {
  /** The party that the token is for: its `aud` claim must hold it. */
  readonly audience: string;
  /**
   * The parties besides `audience` that `aud` may hold.
   *
   * @defaultValue none
   */
  readonly trustedAudiences?: readonly string[];
  /**
   * The party that `azp` must name when it is present.
   *
   * @defaultValue not checked
   */
  readonly authorizedParty?: string;
  /**
   * The `sub` of the token.
   *
   * @defaultValue not checked
   */
  readonly subject?: string;
  /** The claims that must be present beside `iss` and `aud`. */
  readonly requiredClaims: string[];
  /**
   * The most JSON tokens of the payload.
   *
   * @defaultValue the limit of the Security Framework reader
   */
  readonly maxTokens?: number;
}

/** Returns the `iss` of a token whose signature has not been verified yet: the client identifier of the tool that signed it. */
export function issuerOf(token: string, owner: string, maxTokens?: number): string {
  return required(unverifiedClaims(token, maxTokens), "iss", owner, STRING);
}

/**
 * Returns the registration that the host's lookup gave for a client.
 *
 * @throws `LtiError` (`client-unknown`) when the host has no tool with the client identifier.
 * @throws `DataError` when the lookup gave something that is not a registration, or the registration of another client.
 */
export function toolFrom(asked: unknown, clientId: string): ToolRegistration {
  const registration = readToolRegistration(asked, clientId);
  if (registration === undefined) {
    throw new LtiError(`The platform has no tool with the client identifier ${describe(clientId)}.`, "client-unknown");
  }
  return registration;
}

/**
 * Verifies a token that a tool signed (Security Framework sections 4.1.1 and 5.2.3): an algorithm of its registration, a key of
 * its key set, the signature, `iss` as its client identifier, and the audiences, the authorized party, the subject, the times and
 * the claims that `expected` names.
 *
 * @throws `LtiError` with the reason of the failed check, as `verifyJwt` does.
 */
export function verifyToolJwt(
  token: string,
  registration: ToolRegistration,
  expected: ToolJwtExpectation,
  context: ToolJwtContext,
): Promise<Claims> {
  return verifyJwt(
    token,
    toolKeySet(registration, context.jwks, { signal: context.signal }),
    {
      issuer: registration.clientId,
      ...expected,
      ...(registration.algorithms === undefined ? {} : { algorithms: registration.algorithms }),
    },
    readClock(context.clock),
  );
}

/**
 * Returns the expiry of a verified token, which must come within an hour.
 *
 * @throws `LtiError` (`assertion-lifetime`) when it expires later.
 */
export function checkLifetime(claims: Claims, nowMilliseconds: number, owner: string): number {
  const exp = required(claims, "exp", owner, NUMBER);
  if (exp - nowMilliseconds / MILLISECONDS > MAX_LIFETIME_SECONDS) {
    throw new LtiError(`The token must expire within ${MAX_LIFETIME_SECONDS} seconds.`, "assertion-lifetime");
  }
  return exp;
}

/**
 * Returns the time in milliseconds until which a single-use identifier of a token is remembered: the expiry, rounded up to a
 * whole second, plus the clock-skew leeway of 60 seconds. The token still verifies until then, so a host's `once` that forgot
 * the identifier earlier would let a captured token in again. `exp` may have a fraction (RFC 7519 section 2), and the check of
 * the signature compares whole seconds.
 */
export function spentUntil(exp: number): number {
  return (Math.ceil(exp) + CLOCK_SKEW_SECONDS) * MILLISECONDS;
}

/** Reads the form that a tool posts and returns its message, the value of the parameter `JWT`. */
function readMessage(request: HttpRequest, settings: ToolMessageSettings): string {
  if (request.method !== "POST") {
    throw new LtiError(
      `A tool posts its message: the method must be POST, found ${describe(request.method)}.`,
      "request-invalid",
    );
  }
  if (request.body.byteLength > settings.maxFormBytes) {
    throw new LtiError(
      `The form of the message has ${request.body.byteLength} bytes, above the limit of ${settings.maxFormBytes} bytes of the option maxFormBytes.`,
      "form-too-large",
    );
  }
  let form: ReadonlyMap<string, string>;
  try {
    form = readForm(request);
  } catch (error) {
    if (error instanceof DataError) throw new LtiError(error.message, "request-invalid");
    throw error;
  }
  const message = form.get(MESSAGE_PARAMETER);
  if (message === undefined || message === "") {
    throw new LtiError(`The form of the message must have the parameter ${MESSAGE_PARAMETER}.`, "request-invalid");
  }
  return message;
}

/** A message of a tool whose signature, issuer, audience and times are verified. */
export interface ReadToolToken {
  /** The tool that signed the message. */
  readonly registration: ToolRegistration;
  /** The claims of the message. */
  readonly claims: Claims;
  /** The `nonce` of the message, which `spendNonce` records. */
  readonly nonce: string;
  /** The expiry of the message, in seconds since 1970-01-01T00:00:00Z. */
  readonly exp: number;
}

/**
 * Reads and verifies the message that a tool posts to the platform (Security Framework section 5.2.3): the method and the form
 * within `maxFormBytes`, the tool that its `iss` names, the signature with an algorithm and a key of the tool's registration, `aud`
 * as the platform's issuer, `azp` when present as the same, `exp`, `iat` and `nonce` present and the expiry within an hour. The
 * caller then reads the claims of its message type, and spends the `nonce` with `spendNonce`.
 *
 * @throws `LtiError` with the reason of the failed check: `request-invalid`, `form-too-large`, `token-malformed`, `client-unknown`,
 * `algorithm-unsupported`, `key-unknown`, `signature-invalid`, `audience-mismatch`, `audience-untrusted`,
 * `authorized-party-mismatch`, `token-expired`, `issued-in-future`, `claim-missing`, `claim-invalid` or `assertion-lifetime`.
 * @throws `DataError` when the host's lookup breaks its contract.
 * @throws `ServiceError` when the key set of the tool cannot be fetched.
 * @throws The error of `client`, and the `reason` of the signal when it aborts.
 */
export async function readToolToken(request: HttpRequest, settings: ToolMessageSettings): Promise<ReadToolToken> {
  const { config, signal } = settings;
  const jwt = readMessage(request, settings);
  const clientId = issuerOf(jwt, MESSAGE_OWNER, settings.maxTokens);
  signal?.throwIfAborted();
  const registration = toolFrom(await settings.client(clientId, { signal }), clientId);
  const claims = await verifyToolJwt(
    jwt,
    registration,
    {
      audience: config.issuer,
      authorizedParty: config.issuer,
      requiredClaims: ["exp", "iat", "nonce"],
      maxTokens: settings.maxTokens,
    },
    settings,
  );
  return {
    registration,
    claims,
    nonce: required(claims, "nonce", MESSAGE_OWNER, NON_EMPTY_STRING),
    exp: checkLifetime(claims, readClock(settings.clock), MESSAGE_OWNER),
  };
}

/**
 * Records the `nonce` of a verified message as used until the message stops verifying, so that the message is read once.
 *
 * @throws `LtiError` (`nonce-replayed`) when `once` has seen it.
 * @throws `DataError` when `once` does not resolve with a boolean.
 * @throws The error of `once`, and the `reason` of the signal when it aborts.
 */
export async function spendNonce(settings: ToolMessageSettings, token: ReadToolToken): Promise<void> {
  const { registration, nonce, exp } = token;
  const { signal } = settings;
  const recorded: unknown = await settings.once(`nonce:${registration.clientId}:${nonce}`, spentUntil(exp), { signal });
  if (typeof recorded !== "boolean") {
    throw new DataError(`The option once must resolve with a boolean, found ${describe(recorded)}.`);
  }
  if (!recorded) throw new LtiError("The nonce of the message has been used.", "nonce-replayed");
}
