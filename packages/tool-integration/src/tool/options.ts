import { type CallOptions, type Clock, checkClock } from "@interopkit/core";
import {
  checkAbortSignal,
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  describe,
} from "@interopkit/core/checks";
import { LtiError } from "../errors.js";
import type { LtiDeployment } from "../protocol/index.js";
import { callOptionsOf, checkJwksCache, type JwksCache } from "../protocol/internal.js";
import { checkPlatformRegistration, type PlatformRegistration } from "./registration.js";
import { checkLtiStore, type LtiStore } from "./store.js";

/** What every function of the tool role needs: where its registrations are, and the time. */
export interface ToolOptions extends CallOptions {
  /**
   * Looks up the registration for the issuer of a platform and, when the platform names one, the client identifier of
   * the tool at that platform. Returns `undefined` when the tool has none. It receives the `signal` of the call.
   */
  readonly registration: (
    issuer: string,
    clientId: string | undefined,
    options?: CallOptions,
  ) => Promise<PlatformRegistration | undefined>;
  /**
   * The source of the current time.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
}

/** The options of `handleLogin`. */
export interface LtiLoginOptions extends ToolOptions {
  /** Where the tool keeps the logins in progress. */
  readonly store: LtiStore;
}

/**
 * The options of `handleLaunch`.
 *
 * @typeParam TOther - The message types beyond the modeled ones that the tool accepts.
 */
export interface LtiLaunchOptions<TOther extends string = never> extends ToolOptions {
  /** Where the tool keeps the logins in progress. */
  readonly store: LtiStore;
  /** The cache of the platforms' key sets, from `createJwksCache`. */
  readonly jwks: JwksCache;
  /**
   * The values of the `version` claim that the tool accepts.
   *
   * @defaultValue `["1.3.0"]`
   */
  readonly versions?: readonly string[];
  /**
   * The message types beyond the five that the package models, which the launch returns as an `OtherMessage`, such as a
   * message of a specification that the package does not implement.
   *
   * @defaultValue none
   */
  readonly otherMessageTypes?: readonly TOther[];
  /**
   * The most bytes of the form that the platform posts, measured before it is decoded.
   *
   * @defaultValue `65536`
   */
  readonly maxFormBytes?: number;
  /**
   * Returns the shared secret of LTI 1.1 for an `oauth_consumer_key`, so that the launch can check the
   * `oauth_consumer_key_sign` of the migration claim. Returns `undefined` when the tool has none for the key. It receives the
   * `signal` of the call.
   *
   * @defaultValue none, and then the migration claim is never verified
   */
  readonly legacySecret?: (consumerKey: string, options?: CallOptions) => Promise<string | undefined>;
}

/**
 * Checks the options that every function needs.
 *
 * @throws `DataError` when they are not an object with a function `registration` and a `clock`.
 */
export function checkToolOptions(options: unknown): asserts options is ToolOptions {
  checkRecord(options, "The options must be an object");
  checkFunction(options.registration, "The option registration must be a function");
  checkClock(options.clock);
  if (options.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
}

/**
 * Checks the options of `handleLogin`.
 *
 * @throws `DataError` when they are not.
 */
export function checkLoginOptions(options: unknown): asserts options is LtiLoginOptions {
  checkRecord(options, "The options must be an object");
  checkToolOptions(options);
  checkLtiStore(options.store);
}

/** Checks a list of non-empty strings that an option holds. */
function checkStrings(value: unknown, name: string): void {
  checkArray(value, `The option ${name} must be an array`);
  for (const item of value) checkNonEmptyString(item, `An entry of the option ${name}`);
}

/**
 * Checks the options of `handleLaunch`.
 *
 * @throws `DataError` when they are not.
 */
export function checkLaunchOptions(options: unknown): asserts options is LtiLaunchOptions<string> {
  checkRecord(options, "The options must be an object");
  checkToolOptions(options);
  checkLtiStore(options.store);
  checkJwksCache(options.jwks);
  if (options.versions !== undefined) checkStrings(options.versions, "versions");
  if (options.otherMessageTypes !== undefined) checkStrings(options.otherMessageTypes, "otherMessageTypes");
  if (options.maxFormBytes !== undefined) checkPositiveInteger(options.maxFormBytes, "The option maxFormBytes");
  if (options.legacySecret !== undefined) {
    checkFunction(options.legacySecret, "The option legacySecret must be a function");
  }
}

/**
 * Finds the registration of a platform with the host's lookup and checks it.
 *
 * @throws `LtiError` (`platform-unknown`) when the tool has none for the issuer and the client identifier.
 * @throws `DataError` when the lookup returns something that is not a registration.
 */
export async function findRegistration(
  options: ToolOptions,
  issuer: string,
  clientId: string | undefined,
): Promise<PlatformRegistration> {
  const registration = await options.registration(issuer, clientId, callOptionsOf(options));
  if (registration === undefined) {
    throw new LtiError(`The tool has no registration for the platform ${describe(issuer)}.`, "platform-unknown");
  }
  checkPlatformRegistration(registration);
  if (registration.issuer !== issuer || (clientId !== undefined && registration.clientId !== clientId)) {
    throw new LtiError(
      `The registration does not match the platform ${describe(issuer)} and the client ${describe(clientId)}.`,
      "platform-unknown",
    );
  }
  return registration;
}

/**
 * Finds the registration for a deployment that an earlier launch returned.
 *
 * @throws `LtiError` (`platform-unknown`) when the tool has no registration for the platform and the client, and
 * (`deployment-unknown`) when the registration no longer lists the deployment.
 */
export async function findDeployment(options: ToolOptions, deployment: LtiDeployment): Promise<PlatformRegistration> {
  const registration = await findRegistration(options, deployment.issuer, deployment.clientId);
  if (!registration.deploymentIds.includes(deployment.deploymentId)) {
    throw new LtiError(
      `The deployment ${describe(deployment.deploymentId)} is not one of the deployments of the registration.`,
      "deployment-unknown",
    );
  }
  return registration;
}
