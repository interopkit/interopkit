import { DataError } from "@interopkit/core";
import {
  DEFAULT_MAX_FINDINGS,
  describe,
  describeRefusal,
  type FindingSink,
  type Issue,
  isRecord,
} from "@interopkit/core/checks";
import type { Statement } from "../model/index.js";
import { error } from "./finding.js";
import { inspectStatement, issueSink } from "./inspect.js";
import { type ReadOptions, type RuleSet, readSettings } from "./options.js";
import { item } from "./path.js";

/**
 * Reads a Statement into the model: checks every property against the tables of the standard and the rules between them for
 * the role and the version, and returns a copy.
 *
 * @remarks
 * The result shares nothing with the input. A single Activity of `contextActivities` is returned as a list of one, as an LRS
 * returns it (4.2.4.2). A Statement with an error is not returned, and warnings are not reported: `validateStatement` lists
 * the findings, with their severity. A property that occurs twice in the text is not a property of a value: read the text
 * with `parseStatementJson`. The check stops after `maxFindings` errors, and the error says that there may be more.
 *
 * @param value - The Statement, such as the parsed text of a request.
 * @param options - Whose rules apply, of which version, and the most errors to count.
 * @returns The Statement.
 * @throws `DataError` that names the path of the first error and counts the others, when the value has an error, or when the
 * options are not an object with a `role` of `"lrs"` or `"provider"`, a `version` of `"2.0.0"` or `"1.0.3"` and a `maxFindings`
 * that is a positive integer.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function readStatement(value: unknown, options?: ReadOptions): Statement {
  const { rules, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, true);
  const statement = inspectStatement(value, rules, sink);
  const errors = sink.list();
  if (statement === undefined || errors.length > 0) {
    throw new DataError(describeRefusal("The statement", errors, "validateStatement"));
  }
  return statement;
}

/**
 * Judges a Statement: lists what is wrong with it, or departs from the standard, for the rules of an LRS or of a Learning
 * Record Provider, in a version.
 *
 * @remarks
 * The findings are those that `readStatement` bases its refusal on, the warnings among them. A value that is not a Statement
 * gives findings and does not throw. When the shape is wrong, the findings are about the shape alone: the rules between
 * properties are judged once it is right. The list holds at most `maxFindings` findings, and a last finding with the rule
 * `findings-stopped` says that the check stopped there and that there may be more.
 *
 * @param value - The Statement: parsed text, or a Statement in the model.
 * @param options - Whose rules apply, of which version, and the most findings to list.
 * @returns The findings, errors and warnings. An empty list means that the Statement is sound.
 * @throws `DataError` when the options are not an object with a `role` of `"lrs"` or `"provider"`, a `version` of `"2.0.0"` or
 * `"1.0.3"` and a `maxFindings` that is a positive integer.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function validateStatement(value: unknown, options?: ReadOptions): readonly Issue[] {
  const { rules, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, false);
  inspectStatement(value, rules, sink);
  return sink.list();
}

/**
 * Reads a Statement of either version as an LRS reads it: by the rules of 2.0, or else of 1.0.3, whose Timestamps may have forms
 * of ISO 8601 that RFC 3339 does not.
 *
 * @throws `DataError` of the rules of 2.0, when neither version takes the value.
 */
export function readEitherVersion(value: unknown): Statement {
  const sink = issueSink(DEFAULT_MAX_FINDINGS, true);
  const statement = inspectStatement(value, { role: "lrs", version: "2.0.0" }, sink);
  const errors = sink.list();
  if (statement !== undefined && errors.length === 0) return statement;
  const other = issueSink(DEFAULT_MAX_FINDINGS, true);
  const earlier = inspectStatement(value, { role: "lrs", version: "1.0.3" }, other);
  if (earlier !== undefined && other.list().length === 0) return earlier;
  throw new DataError(describeRefusal("The statement", errors, "validateStatement"));
}

/** Writes the path of a finding about the Statement at an index of a batch. */
function inBatch(index: number, path: string): string {
  return path === "" ? item("", index) : `${item("", index)}.${path}`;
}

/** Finds the Statements of a batch that repeat the id of an earlier one: an LRS rejects the batch (4.1.6.1). */
function duplicateIds(batch: readonly unknown[], sink: FindingSink<Issue>): void {
  const first = new Map<string, number>();
  for (const [index, entry] of batch.entries()) {
    if (sink.stopped) return;
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    // The case of a UUID does not make it another UUID (2.5).
    const id = entry.id.toLowerCase();
    const earlier = first.get(id);
    if (earlier === undefined) {
      first.set(id, index);
    } else {
      sink.add([
        error(
          inBatch(index, "id"),
          "duplicate-id",
          `expected an id that no earlier Statement of the batch has, found ${describe(entry.id)} again from ${item("", earlier)}.`,
        ),
      ]);
    }
  }
}

/**
 * Judges a batch of Statements into a sink, and returns the Statements whose shape is right, in order: when the sink holds no
 * error, one for each entry. The batch is read once, whether the caller wants every finding or the errors alone.
 */
export function inspectBatch(value: unknown, rules: RuleSet, sink: FindingSink<Issue>): readonly Statement[] {
  if (!Array.isArray(value)) {
    sink.add([error("", "wrong-type", `expected an array of Statements, found ${describe(value)}.`)]);
    return [];
  }
  const statements: Statement[] = [];
  for (const [index, entry] of value.entries()) {
    if (sink.stopped) break;
    const read = inspectStatement(
      entry,
      rules,
      sink.within((issue) => ({ ...issue, path: inBatch(index, issue.path) })),
    );
    if (read !== undefined) statements.push(read);
  }
  duplicateIds(value, sink);
  return statements;
}

/**
 * Judges a batch of Statements: each one as `validateStatement` does, and the batch as a whole, which an LRS rejects when two
 * Statements have the same id (4.1.6.1).
 *
 * @remarks
 * The list holds at most `maxFindings` findings for the whole batch, and a last finding with the rule `findings-stopped` says
 * that the check stopped there and that there may be more.
 *
 * @param value - The batch: an array of Statements, such as the parsed text of a request.
 * @param options - Whose rules apply, of which version, and the most findings to list.
 * @returns The findings, each with its path from the batch: `[0].actor`. A value that is not an array gives one finding.
 * @throws `DataError` when the options are not an object with a `role` of `"lrs"` or `"provider"`, a `version` of `"2.0.0"` or
 * `"1.0.3"` and a `maxFindings` that is a positive integer.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function validateStatements(value: unknown, options?: ReadOptions): readonly Issue[] {
  const { rules, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, false);
  inspectBatch(value, rules, sink);
  return sink.list();
}
