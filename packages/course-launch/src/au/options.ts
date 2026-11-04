import { type CallOptions, type Clock, DEFAULT_TIMEOUT_MS, type Fetch, SYSTEM_CLOCK } from "@interopkit/core";
import {
  abortSignalSchema,
  guardSchema,
  isAbsoluteUri,
  isUuid,
  methodsSchema,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
  readCallOptions,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";

/** The verbs of cmi5 that an assignable unit sends. */
export type AuVerb = "initialized" | "completed" | "passed" | "failed" | "terminated";

/** What a unit keeps of its session for a reload of its page: its token and what it sent. */
export interface AuResume {
  /** The registration of the launch, which a resume must match. */
  readonly registration: string;
  /** The activity id of the launch, which a resume must match. */
  readonly activityId: string;
  /** The authorization token that the fetch URL gave. */
  readonly token: string;
  /**
   * The time of the initialized statement of the session, in milliseconds.
   *
   * @defaultValue none: not initialized
   */
  readonly initializedAt?: number;
  /** The verbs of cmi5 that the unit sent in the session, in order. */
  readonly sent: readonly AuVerb[];
  /** Whether the LMS answered 401, so that the session counts as ended. */
  readonly ended: boolean;
}

/** The options of `startAuSession`. */
export interface AuOptions extends CallOptions {
  /** The `fetch` that makes the requests to the fetch URL and the LRS. */
  readonly fetch: Fetch;
  /**
   * The time of the unit, which times its statements and their durations.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * The state of a session before a reload of the page, which `AuSession.resume` gave: the session goes on without a second
   * POST to the fetch URL.
   *
   * @defaultValue none: a new session
   */
  readonly resume?: AuResume;
  /**
   * The https origins of the LMSs that the unit trusts with its learner: the endpoint and the fetch URL of a launch must be on
   * one of them.
   *
   * @defaultValue any https origin
   */
  readonly trustedOrigins?: readonly string[];
  /**
   * The most time in milliseconds that one request may take.
   *
   * @defaultValue 10,000
   */
  readonly timeoutMs?: number;
}

/** The options of the runtime with their defaults. */
export interface AuSettings {
  readonly fetch: Fetch;
  readonly clock: Clock;
  readonly resume: AuResume | undefined;
  readonly trustedOrigins: readonly string[] | undefined;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
}

const AU_VERBS: readonly AuVerb[] = ["initialized", "completed", "passed", "failed", "terminated"];

const resumeSchema = strictRecord({
  registration: v.pipe(
    v.string(),
    v.check(isUuid, (issue) => `expected a UUID, found ${issue.received}`),
  ),
  activityId: v.pipe(
    v.string(),
    v.check(isAbsoluteUri, (issue) => `expected an IRI, found ${issue.received}`),
  ),
  token: nonEmptyStringSchema,
  initializedAt: v.optional(v.pipe(v.number(), v.safeInteger())),
  sent: v.array(v.picklist(AU_VERBS)),
  ended: v.boolean(),
});

const optionsSchema = strictRecord({
  fetch: guardSchema((value): value is Fetch => typeof value === "function", "a function"),
  clock: v.optional(methodsSchema<Clock>("now")),
  resume: v.optional(resumeSchema),
  trustedOrigins: v.optional(
    v.array(
      v.pipe(
        v.string(),
        v.check(
          (text) => URL.canParse(text) && new URL(text).origin === text && text.startsWith("https://"),
          (issue) => `expected an https origin such as https://lms.example.org, found ${issue.received}`,
        ),
      ),
    ),
  ),
  timeoutMs: v.optional(positiveIntegerSchema),
  signal: v.optional(abortSignalSchema),
});

/**
 * Checks the options of the runtime and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readAuOptions(options: unknown): AuSettings {
  const read = parseWith(optionsSchema, options, "The options of the assignable unit");
  return {
    fetch: read.fetch,
    clock: read.clock ?? SYSTEM_CLOCK,
    resume: read.resume,
    trustedOrigins: read.trustedOrigins,
    timeoutMs: read.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: read.signal,
  };
}

/** The signal of a call: its own, or that of the options of the session. */
export function signalOf(settings: AuSettings, options: CallOptions | undefined): CallOptions {
  const signal = readCallOptions(options).signal ?? settings.signal;
  return signal === undefined ? {} : { signal };
}
