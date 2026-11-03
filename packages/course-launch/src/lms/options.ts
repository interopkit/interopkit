import { type CallOptions, type Clock, DataError, InteropkitError, SYSTEM_CLOCK } from "@interopkit/core";
import {
  abortSignalSchema,
  guardSchema,
  httpsUrlSchema,
  isUuid,
  methodsSchema,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import type { Actor } from "@interopkit/learning-records";
import type { LrsClient } from "@interopkit/learning-records/client";
import * as v from "valibot";
import { checkXapiPart } from "../rules/internal.js";
import type { Cmi5Store } from "./records.js";

/** The options of the LMS role: its store, the client of its own writes, its addresses and its limits. */
export interface LmsOptions extends CallOptions {
  /** Where the courses, registrations and sessions are kept. */
  readonly store: Cmi5Store;
  /**
   * The client of xAPI 1.0.3 with the LMS's own credential, which writes the launch data and the launched, abandoned, waived and
   * satisfied statements. In one process its `fetch` calls the host's `handleLrsRequest` with the options that
   * `extendLrsOptions` returns.
   */
  readonly records: LrsClient;
  /** The https address that assignable units send xAPI to, ending in a slash: the LRS of the host. */
  readonly endpoint: string;
  /** The https address of the host's route for `handleFetchRequest`. */
  readonly fetchEndpoint: string;
  /** The `authority` of the statements of assignable units. */
  readonly authority: Actor;
  /**
   * The time of the LMS.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * Makes the ids of registrations and sessions: UUIDs.
   *
   * @defaultValue `crypto.randomUUID`
   */
  readonly newId?: () => string;
  /**
   * How long the fetch URL of a launch may be used, in seconds.
   *
   * @defaultValue 600
   */
  readonly fetchLifetimeSeconds?: number;
  /**
   * How long a session and its authorization token last after the launch, in seconds.
   *
   * @defaultValue 86,400
   */
  readonly maxSessionSeconds?: number;
  /**
   * Whether assignable units may write the preferences of the learner, or only read them.
   *
   * @defaultValue `"writable"`
   */
  readonly learnerPreferences?: "writable" | "read-only";
  /**
   * The most tries of a write of a record that another write changed first.
   *
   * @defaultValue 3
   */
  readonly conflictRetries?: number;
}

/** The options of the LMS role with their defaults. */
export interface LmsSettings {
  readonly store: Cmi5Store;
  readonly records: LrsClient;
  /** The endpoint, ending in a slash. */
  readonly endpoint: string;
  readonly fetchEndpoint: string;
  readonly authority: Actor;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly fetchLifetimeMs: number;
  readonly maxSessionMs: number;
  readonly learnerPreferences: "writable" | "read-only";
  readonly conflictRetries: number;
  readonly signal: AbortSignal | undefined;
}

/** The lifetime of a fetch URL: ten minutes, time for a browser to open the unit and post to it. */
const DEFAULT_FETCH_LIFETIME_SECONDS = 600;

/** The lifetime of a session: one day, longer than a learner keeps a unit open. */
const DEFAULT_MAX_SESSION_SECONDS = 86_400;

/** The tries of a write that loses a race: as the LRS of `learning-records` retries the merge of a document. */
const DEFAULT_CONFLICT_RETRIES = 3;

/** Milliseconds in a second. */
const MS_PER_SECOND = 1000;

const isFunction = <T>(value: unknown): value is T => typeof value === "function";

const optionsSchema = strictRecord({
  store: methodsSchema<Cmi5Store>("course", "registration", "putRegistration", "session", "putSession"),
  records: methodsSchema<LrsClient>("sendStatement", "putDocument", "getDocument"),
  endpoint: v.pipe(
    httpsUrlSchema,
    v.check(
      (url) => url.endsWith("/"),
      (issue) => `expected an https address that ends in a slash, found ${issue.received}`,
    ),
  ),
  fetchEndpoint: v.pipe(
    httpsUrlSchema,
    v.check(
      (url) => !url.includes("#"),
      (issue) => `expected an https address without a fragment, found ${issue.received}`,
    ),
  ),
  authority: v.unknown(),
  clock: v.optional(methodsSchema<Clock>("now")),
  newId: v.optional(guardSchema(isFunction<() => string>, "a function")),
  fetchLifetimeSeconds: v.optional(positiveIntegerSchema),
  maxSessionSeconds: v.optional(positiveIntegerSchema),
  learnerPreferences: v.optional(v.picklist(["writable", "read-only"])),
  conflictRetries: v.optional(positiveIntegerSchema),
  signal: v.optional(abortSignalSchema),
});

/**
 * Checks the options of the LMS role and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readLmsOptions(options: unknown): LmsSettings {
  const read = parseWith(optionsSchema, options, "The options of the LMS");
  checkXapiPart("actor", read.authority, "The option authority");
  return {
    store: read.store,
    records: read.records,
    endpoint: read.endpoint,
    fetchEndpoint: read.fetchEndpoint,
    // The rules of xAPI took it as an Actor.
    authority: read.authority as Actor,
    clock: read.clock ?? SYSTEM_CLOCK,
    newId: read.newId ?? (() => crypto.randomUUID()),
    fetchLifetimeMs: (read.fetchLifetimeSeconds ?? DEFAULT_FETCH_LIFETIME_SECONDS) * MS_PER_SECOND,
    maxSessionMs: (read.maxSessionSeconds ?? DEFAULT_MAX_SESSION_SECONDS) * MS_PER_SECOND,
    learnerPreferences: read.learnerPreferences ?? "writable",
    conflictRetries: read.conflictRetries ?? DEFAULT_CONFLICT_RETRIES,
    signal: read.signal,
  };
}

/** Reads the options of a call of the LMS: the options of the LMS and a signal that may replace theirs. */
export function signalOf(settings: LmsSettings): CallOptions {
  return settings.signal === undefined ? {} : { signal: settings.signal };
}

/**
 * Makes a new id with the host's `newId`.
 *
 * @throws `DataError` when it makes something other than a UUID.
 */
export function newIdOf(settings: LmsSettings): string {
  const id = settings.newId();
  if (typeof id !== "string" || !isUuid(id)) {
    throw new DataError(`The option newId must make a UUID, found ${JSON.stringify(id)}.`);
  }
  return id.toLowerCase();
}

/**
 * Runs a change of records that may lose a race, again after each conflict, up to the retries of the options.
 *
 * @param attempt - Reads the records, makes the change and writes it; returns the result, or `"conflict"` to run again.
 * @param what - Names the change in the message of the error.
 * @throws `InteropkitError` when every try met a conflict.
 */
export async function withRetries<T>(
  settings: LmsSettings,
  what: string,
  attempt: () => Promise<T | "conflict">,
): Promise<T> {
  for (let tries = 0; tries <= settings.conflictRetries; tries += 1) {
    const outcome = await attempt();
    if (outcome !== "conflict") return outcome;
  }
  throw new InteropkitError(
    `The store kept changing while the LMS ${what}: ${settings.conflictRetries + 1} tries met a conflict.`,
  );
}
