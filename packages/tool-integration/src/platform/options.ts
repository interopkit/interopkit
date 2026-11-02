import type { CallOptions, Clock } from "@interopkit/core";
import {
  abortSignalSchema,
  guardSchema,
  MAX_JSON_TOKENS,
  methodsSchema,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import type { JwksCache } from "../protocol/index.js";
import { checkPlatformConfig, type PlatformConfig } from "./config.js";
import type { MessageInput } from "./messages/input.js";
import type {
  AssessmentControl,
  GradebookStore,
  GroupStore,
  LaunchStore,
  PlatformServices,
  PreferencesStore,
  RosterStore,
  Substitution,
} from "./ports.js";
import type { ToolRegistration } from "./registration.js";

/** What every function of the platform role needs: what the platform is, and the time. */
export interface PlatformOptions {
  /** The identity, the origins and the keys of the platform. */
  readonly config: PlatformConfig;
  /** The source of the current time. */
  readonly clock: Clock;
}

/** The options of `ltiPlatformLogin` and `ltiPlatformFrame`. */
export interface PlatformLoginOptions extends PlatformOptions, CallOptions {
  /** Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. */
  readonly registration: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>;
  /** Confirms that the message is the caller's, and throws otherwise, before anything is kept or signed. */
  readonly check: (message: MessageInput, options?: CallOptions) => Promise<void>;
  /** Where the platform keeps the message until the tool's authentication request. */
  readonly launches: LaunchStore;
  /**
   * The name of the frame that shows the storage page, which the tool's `lti_storage_target` names.
   *
   * @defaultValue `"lti-storage"`
   */
  readonly storageTarget?: string;
}

/** What the launch of a tool is, as `checkLaunch` sees it before the message is taken. */
export interface LaunchToCheck {
  /** The client identifier of the tool. */
  readonly clientId: string;
  /** The deployment of the launch. */
  readonly deploymentId: string;
  /** The `sub` of the launch; absent in an anonymous launch. */
  readonly principal?: string;
}

/** The options of `handlePlatformRequest`. */
export interface PlatformRequestOptions extends PlatformOptions, CallOptions {
  /**
   * Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. It is called on
   * every authentication request and token request, so that a removed tool loses access at once.
   */
  readonly client: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>;
  /** Where the platform keeps the messages of the logins in progress. */
  readonly launches: LaunchStore;
  /**
   * Records that an identifier is used until a time (milliseconds since 1970-01-01T00:00:00Z), and returns `false` when it
   * was used already. It is atomic across processes. The `jti` of a client assertion is recorded until its expiry, rounded up
   * to a whole second, plus the clock-skew leeway of 60 seconds, because the assertion verifies until then.
   */
  readonly once: (id: string, expiresAt: number, options?: CallOptions) => Promise<boolean>;
  /** The cache of the key sets of tools, from `createJwksCache`. */
  readonly jwks: JwksCache;
  /**
   * A last check of the launch before its message is taken from the `LaunchStore`, such as that the user's session is still
   * the one that started it; `false` refuses it with `launch-refused`, and the message stays.
   *
   * @defaultValue none
   */
  readonly checkLaunch?: (launch: LaunchToCheck, options?: CallOptions) => Promise<boolean>;
  /**
   * The variables of custom properties that the host resolves beyond those that the message answers.
   *
   * @defaultValue none
   */
  readonly substitution?: Substitution;
  /**
   * Returns the LTI 1.1 secret of an `oauth_consumer_key`, which signs the `oauth_consumer_key_sign` of the migration claim
   * and is dropped. Returns `undefined` for a key it has no secret for.
   *
   * @defaultValue none, and the migration claim goes unsigned
   */
  readonly migrationSecret?: (consumerKey: string, options?: CallOptions) => Promise<string | undefined>;
  /**
   * The stores of the services of the platform, one for each service; a service without its store is neither offered in a
   * claim, nor granted at the token endpoint, nor routed.
   *
   * @defaultValue none
   */
  readonly services?: PlatformServices;
  /**
   * The items of a page of a service when the request names no `limit`.
   *
   * @defaultValue `100`
   */
  readonly pageSize?: number;
  /**
   * The most items of a page of a service: a larger `limit` is lowered to it.
   *
   * @defaultValue `1000`
   */
  readonly maxPageSize?: number;
  /**
   * The name of the frame of the tool, the only one that the storage page answers.
   *
   * @defaultValue `"lti-tool"`
   */
  readonly toolFrame?: string;
  /**
   * The most bytes of the body of a request, measured before it is parsed.
   *
   * @defaultValue `65536`
   */
  readonly maxBodyBytes?: number;
  /**
   * How long the session data of a Start Proctoring message is valid, in seconds.
   *
   * @defaultValue `3600`
   */
  readonly sessionDataLifetimeSeconds?: number;
  /**
   * How long the data of a Deep Linking request is valid, in seconds: the time that the tool's picker may take to answer.
   *
   * @defaultValue `86400`
   */
  readonly deepLinkingLifetimeSeconds?: number;
}

/** The options of `handlePlatformRequest` with their defaults filled in. */
export interface PlatformSettings
  extends Required<
    Omit<PlatformRequestOptions, "checkLaunch" | "substitution" | "migrationSecret" | "services" | "signal">
  > {
  readonly services?: PlatformServices;
  readonly checkLaunch?: PlatformRequestOptions["checkLaunch"];
  readonly substitution?: PlatformRequestOptions["substitution"];
  readonly migrationSecret?: PlatformRequestOptions["migrationSecret"];
  readonly signal?: AbortSignal;
}

/**
 * The options of `readDeepLinkingResponse` and `readStartAssessment`: the platform, and the ports and limits that checking a
 * message of a tool needs.
 */
export interface ToolMessageOptions extends PlatformOptions, CallOptions {
  /**
   * Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. It is called for
   * each message, so that a removed tool is refused at once.
   */
  readonly client: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>;
  /** The cache of the key sets of tools, from `createJwksCache`. */
  readonly jwks: JwksCache;
  /**
   * Records that an identifier is used until a time (milliseconds since 1970-01-01T00:00:00Z), and returns `false` when it
   * was used already. It is atomic across processes. The `nonce` of a message is recorded until its expiry, rounded up to a
   * whole second, plus the clock-skew leeway of 60 seconds.
   */
  readonly once: (id: string, expiresAt: number, options?: CallOptions) => Promise<boolean>;
  /**
   * The most bytes of the form that the tool posts, measured before it is decoded.
   *
   * @defaultValue `1048576` for a Deep Linking response, which may list many items, and `65536` for a Start Assessment message
   */
  readonly maxFormBytes?: number;
  /**
   * The most JSON tokens of the message, counted before it is parsed.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
  /**
   * The most content items of a Deep Linking response.
   *
   * @defaultValue `100`
   */
  readonly maxContentItems?: number;
}

/** The options of `readDeepLinkingResponse` and `readStartAssessment` with their defaults filled in. */
export interface ToolMessageSettings extends Required<Omit<ToolMessageOptions, "signal">> {
  readonly signal?: AbortSignal;
}

/** The name of the frame of the tool, which the storage page answers, when the host names none. */
const DEFAULT_TOOL_FRAME = "lti-tool";
/**
 * The most bytes of a body: the form of an authentication request or a token request is a few kilobytes, and a JSON body of a
 * service, such as a line item or a score, less.
 */
const DEFAULT_MAX_BODY_BYTES = 65_536;
/** The items of a page of a service when the request names no `limit`: the `limit` that the tool role sends by default. */
const DEFAULT_PAGE_SIZE = 100;
/** The most items of a page of a service, which bounds the work of one request. */
const DEFAULT_MAX_PAGE_SIZE = 1000;
/** The most content items of a Deep Linking response: a selection of a person, far more than a page of choices. */
const DEFAULT_MAX_CONTENT_ITEMS = 100;
/** How long the session data of a proctored attempt is valid, in seconds: the hour that the attempt may take to start. */
const DEFAULT_SESSION_DATA_LIFETIME_SECONDS = 3600;
/** How long the data of a Deep Linking request is valid, in seconds: a day for the person who picks the content. */
const DEFAULT_DEEP_LINKING_LIFETIME_SECONDS = 86_400;

const isFunction = <T>(value: unknown): value is T => typeof value === "function";
const functionSchema = <T>() => guardSchema(isFunction<T>, "a function");
// `checkPlatformConfig` throws a `DataError` that names what is wrong with the configuration.
const configSchema = v.custom<PlatformConfig>((config) => {
  checkPlatformConfig(config);
  return true;
});
const launchStoreSchema = methodsSchema<LaunchStore>("put", "take");

const loginOptionsSchema = strictRecord({
  config: configSchema,
  clock: methodsSchema<Clock>("now"),
  registration: functionSchema<PlatformLoginOptions["registration"]>(),
  check: functionSchema<PlatformLoginOptions["check"]>(),
  launches: launchStoreSchema,
  storageTarget: v.optional(nonEmptyStringSchema),
  signal: v.optional(abortSignalSchema),
});

const requestOptionsSchema = strictRecord({
  config: configSchema,
  clock: methodsSchema<Clock>("now"),
  client: functionSchema<PlatformRequestOptions["client"]>(),
  launches: launchStoreSchema,
  once: functionSchema<PlatformRequestOptions["once"]>(),
  jwks: methodsSchema<JwksCache>("keySet"),
  checkLaunch: v.optional(functionSchema<NonNullable<PlatformRequestOptions["checkLaunch"]>>()),
  substitution: v.optional(
    v.pipe(
      methodsSchema<Substitution>("resolve"),
      v.check(
        (substitution) =>
          Array.isArray(substitution.names) && substitution.names.every((name) => typeof name === "string"),
        "expected names to be an array of strings",
      ),
    ),
  ),
  migrationSecret: v.optional(functionSchema<NonNullable<PlatformRequestOptions["migrationSecret"]>>()),
  services: v.optional(
    strictRecord({
      gradebook: v.optional(
        methodsSchema<GradebookStore>(
          "lineItems",
          "lineItem",
          "createLineItem",
          "updateLineItem",
          "deleteLineItem",
          "results",
          "keepScore",
        ),
      ),
      roster: v.optional(methodsSchema<RosterStore>("members")),
      groups: v.optional(methodsSchema<GroupStore>("groups", "groupSets")),
      preferences: v.optional(methodsSchema<PreferencesStore>("record")),
      control: v.optional(methodsSchema<AssessmentControl>("control")),
    }),
  ),
  pageSize: v.optional(positiveIntegerSchema),
  maxPageSize: v.optional(positiveIntegerSchema),
  toolFrame: v.optional(nonEmptyStringSchema),
  maxBodyBytes: v.optional(positiveIntegerSchema),
  sessionDataLifetimeSeconds: v.optional(positiveIntegerSchema),
  deepLinkingLifetimeSeconds: v.optional(positiveIntegerSchema),
  signal: v.optional(abortSignalSchema),
});

/**
 * Checks the options of `ltiPlatformLogin` and `ltiPlatformFrame`.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function checkLoginOptions(options: unknown): asserts options is PlatformLoginOptions {
  parseWith(loginOptionsSchema, options, "The options");
}

/**
 * Checks the options of `handlePlatformRequest` and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readRequestOptions(options: unknown): PlatformSettings {
  const read = parseWith(requestOptionsSchema, options, "The options");
  return {
    ...read,
    toolFrame: read.toolFrame ?? DEFAULT_TOOL_FRAME,
    pageSize: read.pageSize ?? DEFAULT_PAGE_SIZE,
    maxPageSize: read.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE,
    maxBodyBytes: read.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    sessionDataLifetimeSeconds: read.sessionDataLifetimeSeconds ?? DEFAULT_SESSION_DATA_LIFETIME_SECONDS,
    deepLinkingLifetimeSeconds: read.deepLinkingLifetimeSeconds ?? DEFAULT_DEEP_LINKING_LIFETIME_SECONDS,
  };
}

const toolMessageOptionsSchema = strictRecord({
  config: configSchema,
  clock: methodsSchema<Clock>("now"),
  client: functionSchema<ToolMessageOptions["client"]>(),
  jwks: methodsSchema<JwksCache>("keySet"),
  once: functionSchema<ToolMessageOptions["once"]>(),
  maxFormBytes: v.optional(positiveIntegerSchema),
  maxTokens: v.optional(positiveIntegerSchema),
  maxContentItems: v.optional(positiveIntegerSchema),
  signal: v.optional(abortSignalSchema),
});

/**
 * Checks the options of `readDeepLinkingResponse` and `readStartAssessment`, and fills in their defaults.
 *
 * @param defaultMaxFormBytes - The `maxFormBytes` of the message that is read, when the host names none.
 * @throws `DataError` that names the option and what it must be.
 */
export function readToolMessageOptions(options: unknown, defaultMaxFormBytes: number): ToolMessageSettings {
  const read = parseWith(toolMessageOptionsSchema, options, "The options");
  return {
    ...read,
    maxFormBytes: read.maxFormBytes ?? defaultMaxFormBytes,
    maxTokens: read.maxTokens ?? MAX_JSON_TOKENS,
    maxContentItems: read.maxContentItems ?? DEFAULT_MAX_CONTENT_ITEMS,
  };
}
