import { DataError } from "@interopkit/core";
import {
  checkProperties,
  checkRecord,
  DEFAULT_MAX_FINDINGS,
  formatDateTime,
  type Issue,
  isDateTime,
  parseDateTime,
  parseWith,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import {
  type Actor,
  type Attachment,
  type Context,
  type Result,
  type Statement,
  type StatementObject,
  type Verb,
  XAPI_VERSIONS,
  type XapiVersion,
} from "../model/index.js";
import { STATEMENT_VERSIONS } from "../model/internal.js";
import { inspectStatement, issueSink } from "../read/internal.js";

/** The properties that a Statement is built from. */
const INPUT_PROPERTIES = ["id", "actor", "verb", "object", "timestamp", "result", "context", "attachments"] as const;

/**
 * The properties that a built Statement needs although a Statement may lack them, and why: a resend repeats the id, and the time
 * is that of the event, where an LRS would set the time it stored the Statement.
 */
const REQUIRED = [
  ["id", "so that a resend repeats it"],
  ["timestamp", "so that it holds the time of the event and not the time that an LRS stored it"],
] as const;

/** What a Learning Record Provider gives to make a Statement. */
export interface StatementInput {
  /** The id, a UUID. A provider gives one so that a resend repeats it; `deriveStatementId` makes one from what the event is. */
  readonly id: string;
  /** Whom the Statement is about. */
  readonly actor: Actor;
  /** The action that the Actor took. */
  readonly verb: Verb;
  /** What the Actor acted on. */
  readonly object: StatementObject;
  /** When the events described occurred: an RFC 3339 date and time with any offset, which is written in UTC. */
  readonly timestamp: string;
  /**
   * A measured outcome.
   *
   * @defaultValue none
   */
  readonly result?: Result;
  /**
   * Context that gives the Statement more meaning.
   *
   * @defaultValue none
   */
  readonly context?: Context;
  /**
   * Headers of the Attachments of the Statement.
   *
   * @defaultValue none
   */
  readonly attachments?: readonly Attachment[];
}

/** The options of `buildStatement` and `buildVoidingStatement`. */
export interface BuildOptions {
  /**
   * The version of xAPI whose provider rules the Statement follows and whose `version` it carries: `2.0.0`, or `1.0.3`, whose
   * Statements carry `1.0.0` and have no `contextAgents` or `contextGroups`.
   *
   * @defaultValue `"2.0.0"`
   */
  readonly version?: XapiVersion;
}

const optionsSchema = strictRecord({ version: v.optional(v.picklist(XAPI_VERSIONS)) });

/** Checks the options of a builder and returns the version they ask for. */
export function versionOf(options: unknown): XapiVersion {
  return parseWith(optionsSchema, options === undefined ? {} : options, "The options object").version ?? "2.0.0";
}

/** Writes the sentence of the `DataError` for a Statement that cannot be built: every error, each with its path. */
function sentenceOf(errors: readonly Issue[]): string {
  const list = errors.map(({ path, message }) => `At ${path}: ${message}`);
  return `The statement is invalid. ${list.join(" ")}`;
}

/** Returns the time in UTC when it is a time, and what was given otherwise, for the reader to refuse with its sentence. */
function inUtc(timestamp: unknown): unknown {
  return typeof timestamp === "string" && isDateTime(timestamp) ? formatDateTime(parseDateTime(timestamp)) : timestamp;
}

/**
 * Builds the Statement of an event: copies the input, writes the `timestamp` in UTC and the `version`, and checks the result
 * against the rules of a Learning Record Provider of the version.
 *
 * @remarks
 * A resend repeats the `id`, so it is required, and so is the `timestamp`, the time of the event: an LRS would write the time
 * it stored the Statement. The result shares nothing with the input. A warning of the provider rules does
 * not keep a Statement from being built: `validateStatement` with `role: "provider"` lists them. The `version` is written
 * although a provider should not send one: 2.0.0, so that a system of xAPI 1.0.x does not read the Statement as 1.0.0, or
 * 1.0.0 for 1.0.3, which is the only value a provider of 1.0.x may write.
 *
 * @param input - The event.
 * @param options - The version.
 * @returns The Statement.
 * @throws `DataError` that names every error with its path, when the input has a property that a Statement is not built from,
 * or the Statement breaks a rule of a provider of the version, or has no `id` or no `timestamp`, or when the options are not an object with a
 * `version` of `"2.0.0"` or `"1.0.3"`.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 * @see {@link https://github.com/adlnet/xAPI-Spec/blob/1.0.3/xAPI-Data.md | xAPI 1.0.3, Data}
 */
export function buildStatement(input: StatementInput, options?: BuildOptions): Statement {
  const version = versionOf(options);
  checkRecord(input, "A statement input must be an object");
  checkProperties(input, "A statement input", INPUT_PROPERTIES);
  const sink = issueSink(DEFAULT_MAX_FINDINGS, true);
  const value = inspectStatement(
    { ...input, timestamp: inUtc(input.timestamp), version: STATEMENT_VERSIONS[version] },
    { role: "provider", version },
    sink,
  );
  const errors = sink.list();
  for (const [name, why] of REQUIRED) {
    if (input[name] === undefined) {
      errors.push({
        path: name,
        rule: "missing-property",
        message: `missing the property ${JSON.stringify(name)}, which a built Statement needs ${why}.`,
        severity: "error",
      });
    }
  }
  if (value === undefined || errors.length > 0) throw new DataError(sentenceOf(errors));
  return value;
}
