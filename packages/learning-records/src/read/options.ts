import { parseWith, strictRecord } from "@interopkit/core/checks";
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
}

const optionsSchema = strictRecord({ role: v.optional(v.picklist(RULE_ROLES)) });

/** Checks the options of a read and returns the role that they ask for. */
export function readRole(options: unknown): RuleRole {
  return parseWith(optionsSchema, options === undefined ? {} : options, "The options object").role ?? "lrs";
}
