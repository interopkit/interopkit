import { DEFAULT_MAX_FINDINGS, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { RULE_ROLES, type RuleRole } from "../model/index.js";

/** The options of `readStatement`, `validateStatement` and `validateStatements`. */
export interface ReadOptions {
  /**
   * Whose rules apply. An `lrs` refuses what the standard says an LRS shall reject (4.2). A `provider` also holds the
   * Statement to what a Learning Record Provider shall and should do (5.2): times in UTC, no property that the LRS sets, and
   * the other recommendations as warnings.
   *
   * @defaultValue `"lrs"`
   */
  readonly role?: RuleRole;
  /**
   * The most findings that the call lists, or that `readStatement` counts errors up to before it stops. The check stops at
   * the first finding beyond the limit and ends the list with a finding that says so: a value that is wrong in a million
   * places costs the memory of the limit.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
}

const optionsSchema = strictRecord({
  role: v.optional(v.picklist(RULE_ROLES)),
  maxFindings: v.optional(positiveIntegerSchema),
});

/** The role and the limit of findings that the options of a read ask for. */
export interface ReadSettings {
  readonly role: RuleRole;
  readonly maxFindings: number;
}

/** Checks the options of a read and returns what they ask for. */
export function readSettings(options: unknown): ReadSettings {
  const checked = parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
  return { role: checked.role ?? "lrs", maxFindings: checked.maxFindings ?? DEFAULT_MAX_FINDINGS };
}
