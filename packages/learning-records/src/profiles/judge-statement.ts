import type { Issue } from "@interopkit/core/checks";
import type { Extensions, Statement } from "../model/index.js";
import { error, member, walkStatement, warning } from "../read/internal.js";
import type { ExtensionConceptType } from "./concepts.js";
import { breakOf, type CompiledTemplate, hasDeterminingProperties } from "./template-match.js";

/** What the Statement Template algorithm gives for a Statement, as the table of the specification names it. */
export type TemplateOutcome = "success" | "invalid" | "unmatched";

/** Finds a Statement that a StatementRef names and that is available to the check, or returns `undefined`. */
export type StatementLookup = (id: string) => Statement | undefined;

/**
 * The deepest chain of StatementRefs that a check of a Statement Template follows; a Statement further down is taken as not
 * available, as the specification lets a Statement that the checking system lacks be, so that a chain the size of a batch
 * keeps within the call stack.
 */
const MAX_REFERENCE_DEPTH = 64;

/** What judging a Statement against the Statement Templates of a profile gives. */
export interface TemplateJudgement {
  readonly outcome: TemplateOutcome;
  readonly templates: readonly string[];
  readonly issues: readonly Issue[];
}

/** The Statement Templates of a profile, ready to judge Statements, with what the judgement of a Statement needs besides. */
export interface TemplateJudge {
  readonly templates: readonly CompiledTemplate[];
  /** The types of the extensions that the profile and the other profiles define, by id. */
  readonly extensions: ReadonlyMap<string, ExtensionConceptType>;
  /** The id of the version of the profile that the Statements name. */
  readonly version: string;
}

/** The place of a Statement where each type of extension goes, and the word for it. */
const PLACES: ReadonlyMap<ExtensionConceptType, string> = new Map([
  ["ContextExtension", "a context"],
  ["ResultExtension", "a result"],
  ["ActivityExtension", "an Activity Definition"],
]);

/**
 * What one judgement of a Statement keeps of the Statements it refers to: whether a Statement matches a template, by the id of
 * the Statement and of the template, and the pairs that it is judging, so that a loop of references is taken as matching and
 * each pair is judged once.
 */
interface References {
  readonly lookup: StatementLookup;
  readonly matched: Map<string, boolean>;
  readonly judging: Set<string>;
}

/** Tells whether a Statement that another refers to matches a template of the profile: its Determining Properties and rules. */
function referredMatches(
  judge: TemplateJudge,
  statement: Statement,
  id: string,
  templateId: string,
  references: References,
  depth: number,
): boolean {
  const key = `${id.toLowerCase()} ${templateId}`;
  const known = references.matched.get(key);
  if (known !== undefined) return known;
  if (references.judging.has(key)) return true;
  references.judging.add(key);
  const template = judge.templates.find((candidate) => candidate.template.id === templateId);
  const matches =
    template !== undefined &&
    hasDeterminingProperties(statement, template.template) &&
    problemsOf(judge, statement, template, references, depth + 1).length === 0;
  references.judging.delete(key);
  references.matched.set(key, matches);
  return matches;
}

/** Says what a Statement lacks of a StatementRef template of a template, or returns `undefined` when it has it. */
function referenceProblem(
  judge: TemplateJudge,
  statement: Statement,
  template: CompiledTemplate,
  place: "object" | "context",
  references: References,
  depth: number,
): string | undefined {
  const named =
    place === "object" ? template.template.objectStatementRefTemplate : template.template.contextStatementRefTemplate;
  if (named === undefined) return undefined;
  const reference =
    place === "object"
      ? statement.object.objectType === "StatementRef"
        ? statement.object.id
        : undefined
      : statement.context?.statement?.id;
  const where = place === "object" ? "the object" : "context.statement";
  if (reference === undefined) return `expected a StatementRef as ${where}`;
  const other = depth < MAX_REFERENCE_DEPTH ? references.lookup(reference) : undefined;
  if (other === undefined) return undefined;
  const matches = named.some((id) => referredMatches(judge, other, reference, id, references, depth));
  return matches
    ? undefined
    : `expected ${where} to refer to a Statement that matches one of ${JSON.stringify(named)}, found ${reference}`;
}

/** Lists what a Statement breaks of a template whose Determining Properties it has: its references and its rules. */
function problemsOf(
  judge: TemplateJudge,
  statement: Statement,
  template: CompiledTemplate,
  references: References,
  depth: number,
): readonly { readonly rule: string; readonly message: string }[] {
  const problems: { readonly rule: string; readonly message: string }[] = [];
  for (const place of ["object", "context"] as const) {
    const problem = referenceProblem(judge, statement, template, place, references, depth);
    if (problem !== undefined) problems.push({ rule: "statement-ref", message: problem });
  }
  for (const rule of template.rules) {
    const broken = breakOf(statement, rule);
    if (broken !== undefined) {
      problems.push({ rule: `rule-${broken.requirement}`, message: `${broken.message}, by rules[${broken.rule}]` });
    }
  }
  return problems;
}

/** Lists the extensions of a Statement that the profile defines for another place. */
function placementIssues(judge: TemplateJudge, statement: Statement): Issue[] {
  const found: Issue[] = [];
  const check = (extensions: Extensions | undefined, path: string, place: ExtensionConceptType): void => {
    for (const key of Object.keys(extensions ?? {})) {
      const type = judge.extensions.get(key);
      if (type === undefined || type === place) continue;
      found.push(
        error(
          member(path, key),
          "extension-place",
          `expected a ${type} in ${PLACES.get(type)}, found it in ${PLACES.get(place)}.`,
        ),
      );
    }
  };
  walkStatement(statement, {
    statement(node, path) {
      check(node.context?.extensions, member(member(path, "context"), "extensions"), "ContextExtension");
    },
    result(node, path) {
      check(node.extensions, member(path, "extensions"), "ResultExtension");
    },
    activity(node, path) {
      check(node.definition?.extensions, member(member(path, "definition"), "extensions"), "ActivityExtension");
    },
  });
  return found;
}

/** Tells whether a Statement names a version of a profile among its category Activities. */
export function namesVersion(statement: Statement, version: string): boolean {
  return (statement.context?.contextActivities?.category ?? []).some(({ id }) => id === version);
}

/**
 * Judges a Statement against the Statement Templates of a profile by the algorithm of the specification, and lists what it
 * breaks: the rules of the templates it matches, extensions out of their place, and the version of the profile that it should
 * name in category.
 */
export function judgeStatement(judge: TemplateJudge, statement: Statement, lookup: StatementLookup): TemplateJudgement {
  const matched: string[] = [];
  const failing: string[] = [];
  const issues: Issue[] = [];
  const references: References = { lookup, matched: new Map(), judging: new Set() };
  for (const template of judge.templates) {
    if (!hasDeterminingProperties(statement, template.template)) continue;
    const problems = problemsOf(judge, statement, template, references, 0);
    if (problems.length === 0) {
      matched.push(template.template.id);
      continue;
    }
    failing.push(template.template.id);
    for (const { rule, message } of problems) {
      issues.push(error("", rule, `${message} of the Statement Template ${JSON.stringify(template.template.id)}.`));
    }
  }
  for (const issue of placementIssues(judge, statement)) issues.push(issue);
  if (failing.length > 0) return { outcome: "invalid", templates: failing, issues };
  if (matched.length === 0) return { outcome: "unmatched", templates: [], issues };
  if (!namesVersion(statement, judge.version)) {
    issues.push(
      warning(
        member(member("context", "contextActivities"), "category"),
        "profile-category",
        `expected the version ${JSON.stringify(judge.version)} of the profile among the category Activities of a Statement that follows its templates.`,
      ),
    );
  }
  return { outcome: "success", templates: matched, issues };
}
