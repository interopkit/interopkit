import { DataError } from "@interopkit/core";
import { describe, type FindingSink, isRecord, refusalOf } from "@interopkit/core/checks";
import type { Statement, StatementIssue } from "../model/index.js";
import { error } from "./finding.js";
import { inspectStatement, issueSink } from "./inspect.js";
import { type ReadOptions, readSettings } from "./options.js";
import { item } from "./path.js";

/**
 * Reads a Statement into the model: checks every property against the tables of the standard and the rules between them for
 * the role, and returns a copy.
 *
 * @remarks
 * The result shares nothing with the input. A single Activity of `contextActivities` is returned as a list of one, as an LRS
 * returns it (4.2.4.2). A Statement with an error is not returned, and warnings are not reported: `validateStatement` lists
 * the findings, with their severity. A property that occurs twice in the text is not a property of a value: read the text
 * with `readStatementJson`. The check stops after `maxFindings` errors, and the error says that there may be more.
 *
 * @param value - The Statement, such as the parsed text of a request.
 * @param options - Whose rules apply, and the most errors to count.
 * @returns The Statement.
 * @throws `DataError` that names the path of the first error and counts the others, when the value has an error, or when the
 * options are not an object with a `role` of `"lrs"` or `"provider"` and a `maxFindings` that is a positive integer.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function readStatement(value: unknown, options?: ReadOptions): Statement {
  const { role, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, true);
  const statement = inspectStatement(value, role, sink);
  const errors = sink.list();
  if (statement === undefined || errors.length > 0) {
    throw new DataError(refusalOf("The statement", errors, "validateStatement"));
  }
  return statement;
}

/**
 * Judges a Statement: lists what is wrong with it, or departs from the standard, for the rules of an LRS or of a Learning
 * Record Provider.
 *
 * @remarks
 * The findings are those that `readStatement` bases its refusal on, the warnings among them. A value that is not a Statement
 * gives findings and does not throw. When the shape is wrong, the findings are about the shape alone: the rules between
 * properties are judged once it is right. The list holds at most `maxFindings` findings, and a last finding with the rule
 * `findings-stopped` says that the check stopped there and that there may be more.
 *
 * @param value - The Statement: parsed text, or a Statement in the model.
 * @param options - Whose rules apply, and the most findings to list.
 * @returns The findings, errors and warnings. An empty list means that the Statement is sound.
 * @throws `DataError` when the options are not an object with a `role` of `"lrs"` or `"provider"` and a `maxFindings` that is
 * a positive integer.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function validateStatement(value: unknown, options?: ReadOptions): readonly StatementIssue[] {
  const { role, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, false);
  inspectStatement(value, role, sink);
  return sink.list();
}

/** Writes the path of a finding about the Statement at an index of a batch. */
function inBatch(index: number, path: string): string {
  return path === "" ? item("", index) : `${item("", index)}.${path}`;
}

/** Finds the Statements of a batch that repeat the id of an earlier one: an LRS rejects the batch (4.1.6.1). */
function duplicateIds(batch: readonly unknown[], sink: FindingSink<StatementIssue>): void {
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
 * Judges a batch of Statements: each one as `validateStatement` does, and the batch as a whole, which an LRS rejects when two
 * Statements have the same id (4.1.6.1).
 *
 * @remarks
 * The list holds at most `maxFindings` findings for the whole batch, and a last finding with the rule `findings-stopped` says
 * that the check stopped there and that there may be more.
 *
 * @param value - The batch: an array of Statements, such as the parsed text of a request.
 * @param options - Whose rules apply, and the most findings to list.
 * @returns The findings, each with its path from the batch: `[0].actor`. A value that is not an array gives one finding.
 * @throws `DataError` when the options are not an object with a `role` of `"lrs"` or `"provider"` and a `maxFindings` that is
 * a positive integer.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function validateStatements(value: unknown, options?: ReadOptions): readonly StatementIssue[] {
  const { role, maxFindings } = readSettings(options);
  if (!Array.isArray(value)) {
    return [error("", "wrong-type", `expected an array of Statements, found ${describe(value)}.`)];
  }
  const sink = issueSink(maxFindings, false);
  for (const [index, entry] of value.entries()) {
    if (sink.stopped) break;
    inspectStatement(
      entry,
      role,
      sink.within((issue) => ({ ...issue, path: inBatch(index, issue.path) })),
    );
  }
  duplicateIds(value, sink);
  return sink.list();
}
