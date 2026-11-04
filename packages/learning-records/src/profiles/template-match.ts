import { isSameJson } from "@interopkit/core/checks";
import type { Statement } from "../model/index.js";
import { type JsonPath, parseJsonPath, selectJsonPath } from "./json-path.js";
import type { RulePresence, StatementTemplate } from "./templates.js";

/** A value of a rule that the selector finds nothing in: no value of `any` or `all` is it, and `included` refuses it. */
const UNMATCHABLE = Symbol("unmatchable");

/** A list of values of a rule, which tells whether a value found is one of them. */
interface ValueSet {
  has(value: unknown): boolean;
}

/** A rule of a template with its paths read and its values ready to compare. */
interface CompiledRule {
  readonly index: number;
  readonly location: JsonPath;
  readonly selector: JsonPath | undefined;
  readonly presence: RulePresence | undefined;
  readonly any: ValueSet | undefined;
  readonly all: ValueSet | undefined;
  readonly none: ValueSet | undefined;
  readonly text: string;
}

/** A Statement Template with its rules ready to apply. */
export interface CompiledTemplate {
  readonly template: StatementTemplate;
  readonly rules: readonly CompiledRule[];
}

/** Builds the set of the values of a rule: strings, numbers and booleans by a hash, objects and arrays by comparison. */
function valueSet(values: readonly unknown[] | undefined): ValueSet | undefined {
  if (values === undefined) return undefined;
  const primitives = new Set(values.filter((value) => typeof value !== "object" || value === null));
  const structured = values.filter((value) => typeof value === "object" && value !== null);
  return {
    has: (value) =>
      typeof value === "object" && value !== null
        ? structured.some((entry) => isSameJson(entry, value))
        : primitives.has(value),
  };
}

/** Readies the rules of a template, whose JSONPaths the reader of the profile has judged. */
export function compileTemplate(template: StatementTemplate): CompiledTemplate {
  return {
    template,
    rules: (template.rules ?? []).map((rule, index) => ({
      index,
      location: parseJsonPath(rule.location),
      selector: rule.selector === undefined ? undefined : parseJsonPath(rule.selector),
      presence: rule.presence,
      any: valueSet(rule.any),
      all: valueSet(rule.all),
      none: valueSet(rule.none),
      text: rule.selector === undefined ? rule.location : `${rule.location} then ${rule.selector}`,
    })),
  };
}

/** The activity types of the Activities of a context of a Statement. */
function contextTypes(statement: Statement, kind: "grouping" | "parent" | "other" | "category"): Set<unknown> {
  const activities = statement.context?.contextActivities?.[kind] ?? [];
  return new Set(activities.map((activity) => activity.definition?.type));
}

/** Tells whether every value of a list is in a set; a list that is not given asks nothing. */
function holdsAll(set: ReadonlySet<unknown>, values: readonly string[] | undefined): boolean {
  return values === undefined || values.every((value) => set.has(value));
}

/** Tells whether a Statement has the Determining Properties of a template: its verb, its activity types and usage types. */
export function hasDeterminingProperties(statement: Statement, template: StatementTemplate): boolean {
  if (template.verb !== undefined && statement.verb.id !== template.verb) return false;
  if (template.objectActivityType !== undefined) {
    const object = statement.object;
    const type =
      object.objectType === undefined || object.objectType === "Activity" ? object.definition?.type : undefined;
    if (type !== template.objectActivityType) return false;
  }
  return (
    holdsAll(contextTypes(statement, "grouping"), template.contextGroupingActivityType) &&
    holdsAll(contextTypes(statement, "parent"), template.contextParentActivityType) &&
    holdsAll(contextTypes(statement, "other"), template.contextOtherActivityType) &&
    holdsAll(contextTypes(statement, "category"), template.contextCategoryActivityType) &&
    holdsAll(new Set((statement.attachments ?? []).map(({ usageType }) => usageType)), template.attachmentUsageType)
  );
}

/** Why a rule is broken: which of its requirements, in a sentence that names the location. */
export interface RuleBreak {
  readonly rule: number;
  readonly requirement: "presence" | "any" | "all" | "none";
  readonly message: string;
}

/** Returns the values of a rule in a Statement: those at its location, or those that its selector finds in each of them. */
function valuesOf(statement: Statement, rule: CompiledRule): unknown[] {
  const found = selectJsonPath(rule.location, statement);
  const { selector } = rule;
  if (selector === undefined) return found;
  return found.flatMap((value) => {
    const selected = selectJsonPath(selector, value);
    return selected.length === 0 ? [UNMATCHABLE] : selected;
  });
}

/** Says what the values of a rule break of its presence, or returns `undefined`. */
function presenceProblem(presence: RulePresence | undefined, values: readonly unknown[]): string | undefined {
  const unmatchable = values.includes(UNMATCHABLE);
  if (presence === "included" && unmatchable) return "expected a value in every place, found a place without one";
  if (presence === "included" && values.length === 0) return "expected a value, found none";
  if (presence === "excluded" && values.some((value) => value !== UNMATCHABLE)) return "expected no value, found one";
  return undefined;
}

/** Says which of `any`, `all` and `none` the values of a rule break, and how, or returns `undefined`. */
function valueProblem(rule: CompiledRule, values: readonly unknown[]): Omit<RuleBreak, "rule"> | undefined {
  const { any, all, none } = rule;
  if (any !== undefined && !values.some((value) => any.has(value))) {
    return { requirement: "any", message: "expected one of the values of any" };
  }
  if (all !== undefined && values.includes(UNMATCHABLE)) {
    return { requirement: "all", message: "expected a value in every place, found a place without one" };
  }
  if (all !== undefined && !values.every((value) => all.has(value))) {
    return { requirement: "all", message: "expected only values of all" };
  }
  if (none !== undefined && values.some((value) => none.has(value))) {
    return { requirement: "none", message: "expected none of the values of none" };
  }
  return undefined;
}

/** Applies a rule to a Statement and returns what it breaks, or `undefined` when the Statement follows it. */
export function breakOf(statement: Statement, rule: CompiledRule): RuleBreak | undefined {
  const values = valuesOf(statement, rule);
  const presence = presenceProblem(rule.presence, values);
  if (presence !== undefined)
    return { rule: rule.index, requirement: "presence", message: `at ${rule.text}: ${presence}` };
  // A recommended location asks nothing when it has no value; the others ask their values of an empty list too.
  if (rule.presence === "recommended" && values.length === 0) return undefined;
  const problem = valueProblem(rule, values);
  return problem === undefined
    ? undefined
    : { rule: rule.index, requirement: problem.requirement, message: `at ${rule.text}: ${problem.message}` };
}
