import { DataError } from "@interopkit/core";
import { copyJson, DEFAULT_MAX_FINDINGS, findingsOf, type Schema, safeParseBounded } from "@interopkit/core/checks";
import type { CredentialIssue } from "../model/index.js";
import { issueSink, parseJson } from "../read/internal.js";
import { refuseWith } from "./refusal.js";

/**
 * Reads the input of a builder: JSON that nests at most 64 levels, with the properties of the input and no others.
 *
 * @throws `DataError` that names every fault.
 */
export function readInput<TInput>(schema: Schema<TInput>, input: unknown, label: string): TInput {
  const copy = copyJson(input, "");
  if ("problem" in copy) throw new DataError(`${label} is invalid: ${copy.problem}.`);
  const sink = issueSink(DEFAULT_MAX_FINDINGS, true);
  const result = safeParseBounded(schema, copy.value, sink.room);
  if (!result.success) {
    sink.add(findingsOf(result.issues).map((finding) => ({ ...finding, severity: "error" as const })));
    throw refuseWith(label, sink.list());
  }
  return result.output;
}

/**
 * Checks what a builder wrote with the schema of its class and the rules that judge its value, and returns it as a copy.
 *
 * @param schema - The schema of the class.
 * @param written - What the builder wrote.
 * @param label - Names what is refused, such as `The credential`.
 * @param judge - Lists the faults that the rules find in a value whose shape is right.
 * @throws `DataError` that names every fault.
 */
export function finish<TValue>(
  schema: Schema<TValue>,
  written: unknown,
  label: string,
  judge: (value: TValue) => readonly CredentialIssue[] = () => [],
): TValue {
  const sink = issueSink(DEFAULT_MAX_FINDINGS, true);
  const value = parseJson(schema, written, sink);
  if (value !== undefined) sink.add(judge(value));
  const errors = sink.list();
  if (value === undefined || errors.length > 0) throw refuseWith(label, errors);
  return value;
}
