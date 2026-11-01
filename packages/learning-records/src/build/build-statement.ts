import { DataError } from "@interopkit/core";
import { checkProperties, checkRecord, isDateTime } from "@interopkit/core/checks";
import {
  type Actor,
  type Attachment,
  type Context,
  formatTimestamp,
  type Result,
  type Statement,
  type StatementIssue,
  type StatementObject,
  type Verb,
} from "../model/index.js";
import { errorsOf, inspectStatement } from "../read/internal.js";

/** The version that a Statement of this package carries. */
const STATEMENT_VERSION = "2.0.0";

/** The properties that a Statement is built from. */
const INPUT_PROPERTIES = ["id", "actor", "verb", "object", "timestamp", "result", "context", "attachments"] as const;

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

/** Writes the sentence of the `DataError` for a Statement that cannot be built: every error, each with its path. */
function sentenceOf(errors: readonly StatementIssue[]): string {
  const list = errors.map(({ path, message }) => `At ${path}: ${message}`);
  return `The statement is invalid. ${list.join(" ")}`;
}

/** Returns the time in UTC when it is a time, and what was given otherwise, for the reader to refuse with its sentence. */
function inUtc(timestamp: unknown): unknown {
  return typeof timestamp === "string" && isDateTime(timestamp) ? formatTimestamp(timestamp) : timestamp;
}

/**
 * Builds the Statement of an event: copies the input, writes the `timestamp` in UTC and the `version`, and checks the result
 * against the rules of a Learning Record Provider.
 *
 * @remarks
 * A resend repeats the `id`, so it is required. The result shares nothing with the input. A warning of the provider rules does
 * not keep a Statement from being built: `validateStatement` with `role: "provider"` lists them. The `version` is written
 * although a provider should not send one, so that a system of xAPI 1.0.x does not read the Statement as 1.0.0.
 *
 * @param input - The event.
 * @returns The Statement.
 * @throws `DataError` that names every error with its path, when the input has a property that a Statement is not built from,
 * or the Statement breaks a rule of a provider, or has no `id`.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function buildStatement(input: StatementInput): Statement {
  checkRecord(input, "A statement input must be an object");
  checkProperties(input, "A statement input", INPUT_PROPERTIES);
  const { value, issues } = inspectStatement(
    { ...input, timestamp: inUtc(input.timestamp), version: STATEMENT_VERSION },
    "provider",
  );
  const errors = [...errorsOf(issues)];
  if (input.id === undefined) {
    errors.push({
      path: "id",
      rule: "missing-property",
      message: 'missing the property "id", which a built Statement needs so that a resend repeats it.',
      severity: "error",
    });
  }
  if (value === undefined || errors.length > 0) throw new DataError(sentenceOf(errors));
  return value;
}
