import { type CallOptions, type Clock, checkClock } from "@interopkit/core";
import { checkAbortSignal, checkFunction, checkNonEmptyString, checkRecord } from "@interopkit/core/checks";
import type { HttpRequest } from "@interopkit/core/http";
import { LtiError } from "../errors.js";
import { callOptionsOf, checkJwksCache, type JwksCache } from "../protocol/internal.js";
import type { AgsScore } from "./ags-score.js";
import { checkPlatformConfig, type PlatformConfig } from "./config.js";
import { checkToolRegistration, type ToolRegistration } from "./registration.js";
import type { ToolLaunch } from "./tool-launch.js";

/** What every handler of the platform role needs: what the platform is, and the time. */
export interface PlatformOptions {
  /** The identity, the origins and the keys of the platform. */
  readonly config: PlatformConfig;
  /** The source of the current time. */
  readonly clock: Clock;
}

/** The options of `ltiPlatformLogin` and `ltiPlatformFrame`. */
export interface PlatformLoginOptions extends PlatformOptions, CallOptions {
  /** Looks up the registration of the tool that a launch is for, or returns `undefined` when there is none. */
  readonly registration: (launch: ToolLaunch, options?: CallOptions) => Promise<ToolRegistration | undefined>;
  /** Confirms that the launch is the caller's, and throws otherwise; nothing launches without it. */
  readonly check: (launch: ToolLaunch, options?: CallOptions) => Promise<void>;
  /**
   * The name of the frame that shows the storage page, which the tool's `lti_storage_target` names.
   *
   * @defaultValue `"lti-storage"`
   */
  readonly storageTarget?: string;
}

/** The options of `ltiPlatformAuthorize`. */
export interface PlatformAuthorizeOptions extends PlatformOptions, CallOptions {
  /** Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. */
  readonly client: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>;
  /**
   * Records that an identifier is used until a time (milliseconds since 1970-01-01T00:00:00Z), and returns `false` when it
   * was used already. It is atomic across processes.
   */
  readonly once: (id: string, expiresAt: number, options?: CallOptions) => Promise<boolean>;
  /**
   * An extra check of the principal and the resource of the hint, before `once`: it throws when the launch is not the
   * caller's.
   *
   * @defaultValue none
   */
  readonly checkLaunch?: (
    launch: { readonly principal: string; readonly resource: string },
    options?: CallOptions,
  ) => Promise<void>;
}

/** The options of `platformToken`. */
export interface PlatformTokenOptions extends PlatformOptions, CallOptions {
  /** Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. */
  readonly client: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>;
  /** The cache of the key sets of tools, from `createJwksCache`. */
  readonly jwks: JwksCache;
  /**
   * Records that an identifier is used until a time (milliseconds since 1970-01-01T00:00:00Z), and returns `false` when it
   * was used already. The time of an assertion is its expiry, rounded up to a whole second, plus the clock-skew leeway of 60 seconds, because the assertion
   * verifies until then: a store that forgets an identifier at `expiresAt` forgets it only when it can no more be used.
   */
  readonly once: (id: string, expiresAt: number, options?: CallOptions) => Promise<boolean>;
}

/** The options of `agsScores`. */
export interface AgsScoresOptions extends PlatformOptions, CallOptions {
  /**
   * Receives a score that passed every check, with the `resource` of its line item. Ordering by `timestampMs` is the
   * receiver's (AGS 3.4.9).
   */
  readonly onScore: (resource: string, score: AgsScore, options?: CallOptions) => Promise<void>;
}

/** The options of `platformStorage`. */
export interface PlatformStorageOptions extends PlatformOptions {
  /**
   * The name of the frame of the tool, the only one that the storage page answers.
   *
   * @defaultValue `"lti-tool"`
   */
  readonly toolFrame?: string;
}

/**
 * Checks the options that every handler needs.
 *
 * @throws `DataError` when they are not an object with a platform configuration and a `clock`.
 */
export function checkPlatformOptions(options: unknown): asserts options is PlatformOptions {
  checkRecord(options, "The options must be an object");
  checkPlatformConfig(options.config);
  checkClock(options.clock);
}

/** Checks the signal of a call, which a handler passes to the ports of the host. */
function checkSignal(options: Readonly<Record<string, unknown>>): void {
  if (options.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
}

/**
 * Checks the options of `ltiPlatformLogin`.
 *
 * @throws `DataError` when they are not.
 */
export function checkLoginOptions(options: unknown): asserts options is PlatformLoginOptions {
  checkPlatformOptions(options);
  checkRecord(options, "The options must be an object");
  checkFunction(options.registration, "The option registration must be a function");
  checkFunction(options.check, "The option check must be a function");
  if (options.storageTarget !== undefined) checkNonEmptyString(options.storageTarget, "The option storageTarget");
  checkSignal(options);
}

/**
 * Checks the options of `ltiPlatformAuthorize`.
 *
 * @throws `DataError` when they are not.
 */
export function checkAuthorizeOptions(options: unknown): asserts options is PlatformAuthorizeOptions {
  checkPlatformOptions(options);
  checkRecord(options, "The options must be an object");
  checkFunction(options.client, "The option client must be a function");
  checkFunction(options.once, "The option once must be a function");
  if (options.checkLaunch !== undefined)
    checkFunction(options.checkLaunch, "The option checkLaunch must be a function");
  checkSignal(options);
}

/**
 * Checks the options of `platformToken`.
 *
 * @throws `DataError` when they are not.
 */
export function checkTokenOptions(options: unknown): asserts options is PlatformTokenOptions {
  checkPlatformOptions(options);
  checkRecord(options, "The options must be an object");
  checkFunction(options.client, "The option client must be a function");
  checkFunction(options.once, "The option once must be a function");
  checkJwksCache(options.jwks);
  checkSignal(options);
}

/**
 * Checks the options of `agsScores`.
 *
 * @throws `DataError` when they are not.
 */
export function checkScoresOptions(options: unknown): asserts options is AgsScoresOptions {
  checkPlatformOptions(options);
  checkRecord(options, "The options must be an object");
  checkFunction(options.onScore, "The option onScore must be a function");
  checkSignal(options);
}

/**
 * Checks that a request is for the platform's own origin. The tool's frame is same-origin with any platform page on the
 * origin of the frame page, so a handler mounted elsewhere would put that page at risk.
 *
 * @throws `LtiError` (`wrong-origin`) when the request is for another origin.
 */
export function checkRequestOrigin(request: HttpRequest, config: PlatformConfig): void {
  if (new URL(request.url).origin !== config.origin) {
    throw new LtiError(
      `The platform answers only at ${config.origin}, and the request is for ${new URL(request.url).origin}.`,
      "wrong-origin",
    );
  }
}

/**
 * Finds a tool by its client identifier with the host's lookup and checks the registration.
 *
 * @throws `LtiError` (`client-unknown`) when the platform has no such tool.
 * @throws `DataError` when the lookup returns something that is not a registration.
 */
export async function findClient(
  lookup: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>,
  clientId: string,
  options: CallOptions,
): Promise<ToolRegistration> {
  const registration = await lookup(clientId, callOptionsOf(options));
  if (registration === undefined) {
    throw new LtiError(
      `The platform has no tool with the client identifier ${JSON.stringify(clientId)}.`,
      "client-unknown",
    );
  }
  checkToolRegistration(registration);
  if (registration.clientId !== clientId) {
    throw new LtiError(`The registration is not the one of the tool ${JSON.stringify(clientId)}.`, "client-unknown");
  }
  return registration;
}
