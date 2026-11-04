import { type CallOptions, type Clock, DataError, SYSTEM_CLOCK } from "@interopkit/core";
import {
  abortSignalSchema,
  guardSchema,
  isRecord,
  MAX_JSON_TOKENS,
  methodsSchema,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
  type Schema,
  strictRecord,
} from "@interopkit/core/checks";
import type { HttpRequest } from "@interopkit/core/http";
import * as v from "valibot";
import type { JwksCache, MessageSupported } from "../protocol/index.js";
import { functionSchema } from "../protocol/internal.js";
import { checkPlatformConfig, type PlatformConfig } from "./config.js";
import type { MessageInput } from "./messages/input.js";
import type {
  AssessmentControl,
  GradebookStore,
  GroupStore,
  LaunchStore,
  PlatformServices,
  PreferencesStore,
  RegistrationStore,
  RosterStore,
  Substitution,
} from "./ports.js";
import type { ToolRegistration } from "./registration.js";

/** What every function of the platform role needs: what the platform is, and the time. */
export interface PlatformOptions {
  /** The identity, the origins and the keys of the platform. */
  readonly config: PlatformConfig;
  /**
   * The source of the current time.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
}

/** The options of `prepareToolLaunch`. */
export interface PlatformLoginOptions extends PlatformOptions, CallOptions {
  /** Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. */
  readonly registration: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>;
  /** Confirms that the message is the caller's, and throws otherwise, before anything is kept or signed. */
  readonly check: (message: MessageInput, options?: CallOptions) => Promise<void>;
  /** Where the platform keeps the message until the tool's authentication request. */
  readonly launches: LaunchStore;
}

/** What the launch of a tool is, as `checkLaunch` sees it before the message is taken. */
export interface LaunchToCheck {
  /** The client identifier of the tool. */
  readonly clientId: string;
  /** The deployment of the launch. */
  readonly deploymentId: string;
  /** The `sub` of the launch; absent in an anonymous launch. */
  readonly principal?: string;
  /**
   * The tool's authentication request as the browser sent it, whose cookies tell the host whose session it is, so that one set
   * of options serves every request.
   */
  readonly request: HttpRequest;
}

/**
 * What the OpenID configuration of the platform says beyond what the library derives from the options (Dynamic Registration 1.0
 * section 2.1): the endpoints, the algorithms, the scopes of the services whose stores are given, the variables and the product
 * of `config.instance` come from the options.
 */
export interface PlatformDiscovery {
  /**
   * The message types that the platform launches, each with the placements where it adds links of that type.
   *
   * @defaultValue the five message types of `MessageInput`, without placements
   */
  readonly messagesSupported?: readonly MessageSupported[];
  /**
   * The OpenID claims of a user that the platform's messages carry.
   *
   * @defaultValue `["iss", "sub", "name", "given_name", "family_name", "middle_name", "email", "email_verified", "picture", "locale"]`
   */
  readonly claimsSupported?: readonly string[];
  /**
   * The kinds of `sub`: `public` when a user has one `sub` for every tool, `pairwise` when each tool sees another.
   *
   * @defaultValue `["public"]`
   */
  readonly subjectTypesSupported?: readonly string[];
}

/** The options of `handlePlatformRequest`. */
export interface PlatformRequestOptions extends PlatformOptions, CallOptions {
  /**
   * Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. It is called on
   * every authentication request and token request, so that a removed tool loses access at once.
   */
  readonly registration: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>;
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
   * A last check of the launch before its message is taken from the `LaunchStore`, such as that the session of the browser
   * whose `request` it is belongs to the `principal` that started it; `false` refuses it with `launch-refused`, and the message
   * stays.
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
  /**
   * Accepts a registration request without a registration token (Dynamic Registration 1.0 section 3.5 allows it), so that
   * anyone may ask for a registration; the `RegistrationStore` then caps the registrations that wait for review.
   *
   * @defaultValue `false`: a registration needs a token of `buildRegistrationInitiation`, used once
   */
  readonly openRegistration?: boolean;
  /**
   * What the OpenID configuration says of the platform beyond what the library derives.
   *
   * @defaultValue the defaults of each property
   */
  readonly discovery?: PlatformDiscovery;
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
  readonly registration: (clientId: string, options?: CallOptions) => Promise<ToolRegistration | undefined>;
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

/**
 * The schema of a store whose methods are the capabilities that it has: every required method, each optional one that it gives,
 * and at least one method in all.
 *
 * @param required - The methods that the store must have.
 * @param optional - The methods that the store may have, each a function when it is given.
 */
function storeSchema<TStore extends object>(
  required: readonly (keyof TStore & string)[],
  optional: readonly (keyof TStore & string)[],
): Schema<TStore> {
  const names = [...required, ...optional];
  const listed = (list: readonly string[]) =>
    `${list.slice(0, -1).join(", ")}${list.length > 1 ? " or " : ""}${list.at(-1)}`;
  const expected =
    required.length === 0
      ? `an object with at least one of the functions ${listed(optional)}, and only functions by those names`
      : `an object with the function${required.length > 1 ? "s" : ""} ${required.join(", ")}, and ${listed(optional)} only as a function`;
  return guardSchema(
    (value): value is TStore =>
      isRecord(value) &&
      required.every((name) => typeof value[name] === "function") &&
      optional.every((name) => value[name] === undefined || typeof value[name] === "function") &&
      names.some((name) => typeof value[name] === "function"),
    expected,
  );
}
// `checkPlatformConfig` throws a `DataError` that names what is wrong with the configuration.
const configSchema = v.custom<PlatformConfig>((config) => {
  checkPlatformConfig(config);
  return true;
});
const launchStoreSchema = methodsSchema<LaunchStore>("put", "take");

const loginOptionsSchema = strictRecord({
  config: configSchema,
  clock: v.optional(methodsSchema<Clock>("now")),
  registration: functionSchema<PlatformLoginOptions["registration"]>(),
  check: functionSchema<PlatformLoginOptions["check"]>(),
  launches: launchStoreSchema,
  signal: v.optional(abortSignalSchema),
});

const requestOptionsSchema = strictRecord({
  config: configSchema,
  clock: v.optional(methodsSchema<Clock>("now")),
  registration: functionSchema<PlatformRequestOptions["registration"]>(),
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
        storeSchema<GradebookStore>(
          [],
          ["lineItems", "lineItem", "createLineItem", "updateLineItem", "deleteLineItem", "results", "keepScore"],
        ),
      ),
      roster: v.optional(methodsSchema<RosterStore>("members")),
      groups: v.optional(storeSchema<GroupStore>(["groups"], ["groupSets"])),
      preferences: v.optional(methodsSchema<PreferencesStore>("record")),
      control: v.optional(methodsSchema<AssessmentControl>("control")),
      registrations: v.optional(storeSchema<RegistrationStore>(["register"], ["get", "update"])),
    }),
  ),
  pageSize: v.optional(positiveIntegerSchema),
  maxPageSize: v.optional(positiveIntegerSchema),
  maxBodyBytes: v.optional(positiveIntegerSchema),
  sessionDataLifetimeSeconds: v.optional(positiveIntegerSchema),
  deepLinkingLifetimeSeconds: v.optional(positiveIntegerSchema),
  openRegistration: v.optional(v.boolean()),
  discovery: v.optional(
    strictRecord({
      messagesSupported: v.optional(
        v.array(strictRecord({ type: nonEmptyStringSchema, placements: v.optional(v.array(nonEmptyStringSchema)) })),
      ),
      claimsSupported: v.optional(v.array(nonEmptyStringSchema)),
      subjectTypesSupported: v.optional(v.pipe(v.array(v.picklist(["public", "pairwise"])), v.minLength(1))),
    }),
  ),
  signal: v.optional(abortSignalSchema),
});

/** The algorithm that Dynamic Registration 1.0 section 2.1.1 requires among those that sign an `id_token`. */
const REGISTRATION_ALGORITHM = "RS256";

/**
 * Checks what Dynamic Registration needs of the platform: an issuer on the platform's origin, below which its OpenID
 * configuration lies (section 3.4), a signer of RS256, which section 2.1.1 requires among the algorithms of an `id_token`, and the
 * product family code of `config.instance`, which the configuration names (section 2.1.2).
 */
function checkRegistrationConfig(config: PlatformConfig): void {
  if (new URL(config.issuer).origin !== config.origin) {
    throw new DataError(
      `Dynamic Registration needs the issuer of the platform on its origin ${config.origin}, below which the OpenID configuration lies, found ${config.issuer}.`,
    );
  }
  if (config.keys.signer.algorithm !== REGISTRATION_ALGORITHM) {
    throw new DataError(
      `Dynamic Registration needs a platform that signs with ${REGISTRATION_ALGORITHM}, which its OpenID configuration must name, found ${config.keys.signer.algorithm}.`,
    );
  }
  if (config.instance?.productFamilyCode === undefined) {
    throw new DataError(
      "Dynamic Registration needs the productFamilyCode of config.instance, which the OpenID configuration names.",
    );
  }
}

/** The options of `buildRegistrationInitiation`. */
export interface RegistrationInitiationOptions extends PlatformOptions {
  /**
   * How long the registration token is valid, in seconds: the time that the tool's administrator may take on the tool's pages
   * before it registers.
   *
   * @defaultValue `3600`
   */
  readonly ttlSeconds?: number;
}

const initiationOptionsSchema = strictRecord({
  config: configSchema,
  clock: v.optional(methodsSchema<Clock>("now")),
  ttlSeconds: v.optional(positiveIntegerSchema),
});

/**
 * Checks the options of `buildRegistrationInitiation`, and that the platform can serve Dynamic Registration.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readInitiationOptions(options: unknown): RegistrationInitiationOptions {
  const read = parseWith(initiationOptionsSchema, options, "The options");
  checkRegistrationConfig(read.config);
  return read;
}

/**
 * Checks the options of `prepareToolLaunch`.
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
  if (read.services?.registrations !== undefined) checkRegistrationConfig(read.config);
  return {
    ...read,
    clock: read.clock ?? SYSTEM_CLOCK,
    pageSize: read.pageSize ?? DEFAULT_PAGE_SIZE,
    maxPageSize: read.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE,
    maxBodyBytes: read.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    sessionDataLifetimeSeconds: read.sessionDataLifetimeSeconds ?? DEFAULT_SESSION_DATA_LIFETIME_SECONDS,
    deepLinkingLifetimeSeconds: read.deepLinkingLifetimeSeconds ?? DEFAULT_DEEP_LINKING_LIFETIME_SECONDS,
    openRegistration: read.openRegistration ?? false,
    discovery: read.discovery ?? {},
  };
}

const toolMessageOptionsSchema = strictRecord({
  config: configSchema,
  clock: v.optional(methodsSchema<Clock>("now")),
  registration: functionSchema<ToolMessageOptions["registration"]>(),
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
    clock: read.clock ?? SYSTEM_CLOCK,
    maxFormBytes: read.maxFormBytes ?? defaultMaxFormBytes,
    maxTokens: read.maxTokens ?? MAX_JSON_TOKENS,
    maxContentItems: read.maxContentItems ?? DEFAULT_MAX_CONTENT_ITEMS,
  };
}
