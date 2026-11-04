import { DataError } from "@interopkit/core";
import { describe, formatDateTime, parseDateTime } from "@interopkit/core/checks";
import type { Context, Statement, StatementObject, SubStatement } from "../model/index.js";
import { isIsoTimestamp, STATEMENT_VERSIONS, VERSION_PATTERNS } from "../model/internal.js";
import { readEitherVersion } from "../read/internal.js";

/** Writes a time as a Timestamp of 1.0.3: as it is when ISO 8601 takes it, and otherwise in UTC, such as `2024-06-13T18:46:03.250Z`. */
function isoTime(time: string): string {
  // RFC 3339 takes a `t` between the date and the time, a `z`, and `-00:00`, which ISO 8601 does not.
  return isIsoTimestamp(time) ? time : formatDateTime(parseDateTime(time));
}

/** The context without `contextAgents` and `contextGroups`, which 1.0.3 does not have; no context when nothing else is left. */
function contextV1(context: Context | undefined): { readonly context?: Context } {
  if (context === undefined) return {};
  const { contextAgents: _agents, contextGroups: _groups, ...kept } = context;
  return Object.keys(kept).length === 0 ? {} : { context: kept };
}

/** The context and the time of a Statement or a SubStatement in the form of 1.0.3. */
function partsV1(statement: Statement | SubStatement): Pick<Statement, "context" | "timestamp"> {
  const { timestamp } = statement;
  return { ...contextV1(statement.context), ...(timestamp === undefined ? {} : { timestamp: isoTime(timestamp) }) };
}

/** The Object of a Statement in the form of 1.0.3: a SubStatement changes as a Statement does, and the others stay. */
function objectV1(object: StatementObject): StatementObject {
  if (object.objectType !== "SubStatement") return object;
  const { context: _context, timestamp: _timestamp, ...rest } = object;
  return { ...rest, ...partsV1(object) };
}

/**
 * Returns a Statement in the form of a version of xAPI that it may not have been written in: for 1.0.3, without `contextAgents` and `contextGroups`, a
 * SubStatement's included, with its times as ISO 8601 writes them, and with the `version` 1.0.0 when it has another than 1.0.x.
 *
 * @remarks
 * xAPI 2.0 asks an LRS that answers a prior version to be a fully conformant LRS of that version (4.1.7), and says nothing
 * of a Statement that was stored through 2.0 with properties that 1.0.3 does not have. The LRS answers such a Statement on the
 * 1.0.3 route in this form, and a resend on that route is compared with it. A context that held only Agents and Groups is left
 * out, since 1.0.3 asks for no empty object (Data 2.2). A time that ISO 8601 does not take, such as one with a space before the
 * time, is written in UTC. A Statement already in the form comes back unchanged, and the result shares nothing with the input.
 *
 * @param statement - A Statement of 2.0 or of 1.0.3, as an LRS reads it.
 * @param version - The version whose form is returned: `1.0.3`.
 * @returns The Statement in the form of the version.
 * @throws `DataError` when the version is not `1.0.3`, or the Statement is not valid in either version.
 * @see {@link https://github.com/adlnet/xAPI-Spec/blob/1.0.3/xAPI-Data.md | xAPI 1.0.3, Data}
 */
export function convertStatementVersion(statement: Statement, version: "1.0.3"): Statement {
  if (version !== "1.0.3") {
    throw new DataError(`The version must be "1.0.3", the version whose form is returned, found ${describe(version)}.`);
  }
  const read = readEitherVersion(statement);
  const { context: _context, timestamp: _timestamp, object, stored, version: written, ...rest } = read;
  return {
    ...rest,
    ...partsV1(read),
    object: objectV1(object),
    ...(stored === undefined ? {} : { stored: isoTime(stored) }),
    ...(written === undefined
      ? {}
      : { version: VERSION_PATTERNS["1.0.3"].test(written) ? written : STATEMENT_VERSIONS["1.0.3"] }),
  };
}
