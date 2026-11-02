import { type CallOptions, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, type Fetch } from "@interopkit/core";
import {
  abortSignalSchema,
  guardSchema,
  httpsUrlSchema,
  MAX_JSON_TOKENS,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";

/** The options of `discoverPlatform`: the `fetch` that calls the platform, and the limits of a call. */
export interface DiscoverPlatformOptions extends CallOptions {
  /** The `fetch` that calls the platform. */
  readonly fetch: Fetch;
  /**
   * The most time that the call may take, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * The most bytes of an answer; a larger one is a `ServiceError` that names this option.
   *
   * @defaultValue `65536`
   */
  readonly maxBytes?: number;
  /**
   * The most JSON tokens of an answer, counted before it is parsed.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
}

/** The options of `registerTool`. */
export interface RegisterToolOptions extends DiscoverPlatformOptions {
  /**
   * Origins besides the issuer's at which the registration endpoint, and the client configuration endpoint of the answer, may be:
   * the registration token goes there, and Dynamic Registration does not fix the origin of either.
   *
   * @defaultValue none: only the origin of the issuer
   */
  readonly registrationOrigins?: readonly string[];
}

/** The options of a step of Dynamic Registration with their defaults filled in. */
export interface RegistrationSettings {
  readonly fetch: Fetch;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxTokens: number;
  readonly registrationOrigins: readonly string[];
  readonly signal?: AbortSignal | undefined;
}

const originSchema = v.pipe(
  httpsUrlSchema,
  v.check(
    (text) => new URL(text).origin === text,
    (issue) => `expected an https origin such as "https://lms.example.edu", found ${issue.received}`,
  ),
);

const optionsSchema = strictRecord({
  fetch: guardSchema((value): value is Fetch => typeof value === "function", "a function"),
  timeoutMs: v.optional(positiveIntegerSchema),
  maxBytes: v.optional(positiveIntegerSchema),
  maxTokens: v.optional(positiveIntegerSchema),
  registrationOrigins: v.optional(v.array(originSchema)),
  signal: v.optional(abortSignalSchema),
});

/**
 * Checks the options of a step of Dynamic Registration and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readRegistrationOptions(options: unknown): RegistrationSettings {
  const read = parseWith(optionsSchema, options, "The options");
  return {
    fetch: read.fetch,
    timeoutMs: read.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: read.maxBytes ?? DEFAULT_MAX_BYTES,
    maxTokens: read.maxTokens ?? MAX_JSON_TOKENS,
    registrationOrigins: read.registrationOrigins ?? [],
    signal: read.signal,
  };
}
