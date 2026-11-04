import { DataError, LimitError } from "@interopkit/core";
import {
  checkArray,
  createIssueSink,
  DEFAULT_MAX_FINDINGS,
  describe,
  type FindingSink,
  guardSchema,
  type Issue,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import type { Statement } from "../model/index.js";
import { parseIsoTimestamp } from "../model/internal.js";
import { error, item, readEitherVersion } from "../read/internal.js";
import type { ExtensionConceptType } from "./concepts.js";
import {
  judgeStatement,
  namesVersion,
  type StatementLookup,
  type TemplateJudge,
  type TemplateJudgement,
  type TemplateOutcome,
} from "./judge-statement.js";
import { buildPatternGraph, matchPatterns, type PatternGraph, type PatternOutcome } from "./pattern-match.js";
import { findPattern, patternMembers } from "./pattern-rules.js";
import type { Profile } from "./profile.js";
import { readProfileAndOthers } from "./read-profile.js";
import { collectReferences, type ProfileReferences } from "./references.js";
import { groupRegistrations, type PlacedStatement, type Series } from "./registrations.js";
import { compileTemplate } from "./template-match.js";
import type { StatementTemplate } from "./templates.js";

/** The options of `createProfileValidator`. */
export interface ProfileValidatorOptions {
  /**
   * Other profiles whose Statement Templates and Patterns the Patterns of the profile reuse, and whose extensions Statements
   * may carry. Each is read by its shape.
   *
   * @defaultValue none
   */
  readonly profiles?: readonly unknown[];
  /**
   * Finds the Statement that a StatementRef names, for a template with `objectStatementRefTemplate` or
   * `contextStatementRefTemplate`: the Statement as JSON, or `undefined` when the host does not have it, which the check then
   * passes, as the specification says. `validateStatements` looks in its list first.
   *
   * @defaultValue none: only the Statements of the list are available
   */
  readonly findStatement?: (id: string) => unknown;
  /**
   * The most findings that a call lists.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
  /**
   * The most Statements that `validateStatements` takes in one call.
   *
   * @defaultValue 10,000
   */
  readonly maxStatements?: number;
}

/** What the Statement Template algorithm gives for one Statement, and what the Statement breaks. */
export interface StatementVerdict {
  /**
   * `success` when it matches the Determining Properties of one or more templates and follows all their rules, `invalid` when
   * it breaks a rule of a template it matches, `unmatched` when it matches none.
   */
  readonly outcome: TemplateOutcome;
  /** The templates it matched and followed on `success`, those whose rules it broke on `invalid`, none on `unmatched`. */
  readonly templates: readonly string[];
  /**
   * The rules it breaks, and what the algorithm leaves out: extensions of the profile out of their place, and on `success` the
   * version of the profile missing from the category Activities, as a warning.
   */
  readonly issues: readonly Issue[];
}

/** What a primary Pattern gives for the Statements of a series, as the table of the specification names it. */
export interface PatternVerdict {
  /** The id of the primary Pattern. */
  readonly pattern: string;
  /**
   * `success` when it matched, `partial` when the Statements ran out in the middle of it, `failure` when it did not match.
   */
  readonly outcome: PatternOutcome;
  /** How many Statements remain after what it matched: none on a full match, all of them on a failure. */
  readonly remaining: number;
}

/** What the Statements of one registration, and of one subregistration, give against the primary Patterns of the profile. */
export interface RegistrationVerdict {
  /** The registration. */
  readonly registration: string;
  /** The subregistration of the profile, when the Statements have one. */
  readonly subregistration?: string;
  /** The places of the Statements in the list, in the order of the matching: by timestamp, then by place. */
  readonly statements: readonly number[];
  /**
   * `success` when every Statement follows the Statement Templates and one primary Pattern matches them all, or every
   * Statement follows the templates of a profile without a primary Pattern; `failure` otherwise.
   */
  readonly outcome: "success" | "failure";
  /** Each primary Pattern's outcome, none when a Statement breaks the templates. */
  readonly patterns: readonly PatternVerdict[];
}

/** What the Statements of a list that name the profile give against its Statement Templates and Patterns. */
export interface StatementsVerdict {
  /** What the Statements break, each with the place of the Statement in the list, such as `[3]`. */
  readonly issues: readonly Issue[];
  /** One verdict for each registration and subregistration, in the order of their first Statement. */
  readonly registrations: readonly RegistrationVerdict[];
}

/** A profile ready to judge Statements against its Statement Templates and Patterns. */
export interface ProfileValidator {
  /** The profile, as read. */
  readonly profile: Profile;
  /** The id of the version of the profile that a Statement names in category to follow it: the latest by `generatedAtTime`. */
  readonly version: string;
  /**
   * Judges a Statement against the Statement Templates of the profile, by the Statement Template algorithm of the
   * specification.
   *
   * @param statement - The Statement, of xAPI 2.0 or 1.0.3.
   * @returns The outcome, the templates and what the Statement breaks.
   * @throws `DataError` when the Statement is not a Statement of xAPI 2.0 or 1.0.3 for an LRS, or when `findStatement` returns one
   * that is not.
   */
  validateStatement(statement: unknown): StatementVerdict;
  /**
   * Judges the Statements of a list that name the version of the profile in category: each against the Statement Templates,
   * and those of each registration, ordered by timestamp, against the primary Patterns by the Pattern algorithm of the
   * specification.
   *
   * @param statements - The Statements, of xAPI 2.0 or 1.0.3, in the order they were received.
   * @returns What they break, and the verdict of each registration.
   * @throws `LimitError` with the limit `maxStatements` when the list is longer.
   * @throws `DataError` when it is not an array of Statements of xAPI 2.0 or 1.0.3 for an LRS.
   */
  validateStatements(statements: unknown): StatementsVerdict;
}

const optionsSchema = strictRecord({
  profiles: v.optional(v.array(v.unknown())),
  findStatement: v.optional(
    guardSchema((value): value is (id: string) => unknown => typeof value === "function", "a function"),
  ),
  maxFindings: v.optional(positiveIntegerSchema),
  maxStatements: v.optional(positiveIntegerSchema),
});

/** The most Statements of one call of `validateStatements`, unless the options say otherwise. */
const DEFAULT_MAX_STATEMENTS = 10_000;

/** Returns the id of the latest version of a profile: the latest `generatedAtTime`, and of two as late the first listed. */
function latestVersion(profile: Profile): string {
  let latest = profile.id;
  let time = Number.NEGATIVE_INFINITY;
  for (const version of profile.versions) {
    const at = parseIsoTimestamp(version.generatedAtTime) ?? time;
    if (at > time) [latest, time] = [version.id, at];
  }
  return latest;
}

/** Lists the Statement Templates of the profile and those of other profiles that its Patterns name, at any depth. */
function templatesOf(profile: Profile, references: ProfileReferences): readonly StatementTemplate[] {
  const templates = [...(profile.templates ?? [])];
  const seen = new Set<string>();
  const pending = (profile.patterns ?? []).map(({ id }) => id);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const pattern = findPattern(references, id);
    if (pattern !== undefined) {
      for (const inner of patternMembers(pattern)) pending.push(inner.id);
      continue;
    }
    const other = references.templates.has(id) ? undefined : references.otherTemplates.get(id);
    if (other !== undefined) templates.push(other);
  }
  return templates;
}

/** Lists the extensions that the profile and the other profiles define, with their types. */
function extensionsOf(profile: Profile, others: readonly Profile[]): ReadonlyMap<string, ExtensionConceptType> {
  const extensions = new Map<string, ExtensionConceptType>();
  for (const source of [profile, ...others]) {
    for (const concept of source.concepts ?? []) {
      const { type } = concept;
      if (
        (type === "ContextExtension" || type === "ResultExtension" || type === "ActivityExtension") &&
        !extensions.has(concept.id)
      ) {
        extensions.set(concept.id, type);
      }
    }
  }
  return extensions;
}

/** What the validator of a profile holds ready to judge Statements. */
interface Prepared {
  readonly judge: TemplateJudge;
  readonly graph: PatternGraph;
  readonly maxFindings: number;
  readonly maxStatements: number;
  readonly hostStatement: StatementLookup;
}

/** Writes the path of a finding about the Statement at a place of the list. */
function inList(index: number, path: string): string {
  return path === "" ? item("", index) : `${item("", index)}.${path}`;
}

/** Describes the outcomes of the primary Patterns for the message of a series that follows none. */
function describeOutcomes(patterns: readonly PatternVerdict[]): string {
  return patterns
    .map(({ pattern, outcome, remaining }) => `${JSON.stringify(pattern)} gave ${outcome} with ${remaining} left`)
    .join(", ");
}

/** Reads a list of Statements of either version, within the most that a call takes. */
function readList(statements: unknown, maxStatements: number): readonly Statement[] {
  checkArray(statements, "The statements must be an array of Statements");
  if (statements.length > maxStatements) {
    throw new LimitError(
      `The statements are more than ${maxStatements}, found ${statements.length}: raise the option maxStatements.`,
      "maxStatements",
      maxStatements,
    );
  }
  return statements.map((statement, index) => {
    try {
      return readEitherVersion(statement);
    } catch (caught) {
      const problem = caught instanceof Error ? caught.message : describe(caught);
      throw new DataError(`The statements are invalid at [${index}]: ${problem}`, { cause: caught });
    }
  });
}

/** Judges the Statements of one series against the primary Patterns, by what their templates gave. */
function judgeSeries(
  prepared: Prepared,
  series: Series,
  judged: ReadonlyMap<number, TemplateJudgement>,
  sink: FindingSink<Issue>,
): RegistrationVerdict {
  const { graph } = prepared;
  const outcomes = series.indexes.map((index) => judged.get(index));
  const base = {
    registration: series.registration,
    ...(series.subregistration === undefined ? {} : { subregistration: series.subregistration }),
    statements: series.indexes,
  };
  if (outcomes.some((entry) => entry?.outcome !== "success")) return { ...base, outcome: "failure", patterns: [] };
  if (graph.primary.length === 0) return { ...base, outcome: "success", patterns: [] };
  const patterns = matchPatterns(
    graph,
    outcomes.map((entry) => new Set(entry?.templates)),
  );
  const followed = patterns.some(({ outcome, remaining }) => outcome === "success" && remaining === 0);
  if (!followed) {
    const message = `expected the Statements of the registration ${series.registration} to follow a primary Pattern of the profile: ${describeOutcomes(patterns)}.`;
    sink.add([error(item("", series.indexes[0] ?? 0), "pattern", message)]);
  }
  return { ...base, outcome: followed ? "success" : "failure", patterns };
}

/** Judges the Statements of a list that name the profile, each against the templates and by registration against the Patterns. */
function validateList(prepared: Prepared, statements: unknown): StatementsVerdict {
  const { judge, graph } = prepared;
  const read = readList(statements, prepared.maxStatements);
  const byId = new Map<string, Statement>();
  for (const statement of read) if (statement.id !== undefined) byId.set(statement.id.toLowerCase(), statement);
  const lookup: StatementLookup = (id) => byId.get(id.toLowerCase()) ?? prepared.hostStatement(id);
  const sink = createIssueSink(prepared.maxFindings, false);
  const selected: PlacedStatement[] = [];
  const judged = new Map<number, TemplateJudgement>();
  for (const [index, statement] of read.entries()) {
    if (!namesVersion(statement, judge.version)) continue;
    selected.push({ index, statement });
    const judgement = judgeStatement(judge, statement, lookup);
    judged.set(index, judgement);
    sink.add(judgement.issues.map((issue) => ({ ...issue, path: inList(index, issue.path) })));
    if (judgement.outcome === "unmatched") {
      const message = "expected a Statement that names the profile to match one of its Statement Templates.";
      sink.add([error(item("", index), "template-unmatched", message)]);
    }
  }
  const grouped = groupRegistrations(selected, judge.version, graph.primary.length > 0);
  sink.add(grouped.issues);
  const registrations = grouped.series.map((series) => judgeSeries(prepared, series, judged, sink));
  return { issues: sink.list(), registrations };
}

/**
 * Makes a validator of Statements for an xAPI Profile: it reads the profile, readies its Statement Templates and the Patterns
 * that its primary Patterns reach, and judges Statements against them by the algorithms of the specification.
 *
 * @remarks
 * A Statement follows a template when it has the template's Determining Properties (its verb, the activity type of its object,
 * the activity types of its context and the usage types of its attachments) and keeps every rule; a rule's location and selector
 * are JSONPaths. Statements of one registration, and of one subregistration of the profile, follow a primary Pattern when they
 * match it greedily from the first to the last, ordered by timestamp. The profile's latest version, by `generatedAtTime`, is the
 * one a Statement names in category to follow it.
 *
 * @param profile - The profile, or the text of its JSON, which must be valid.
 * @param options - Other profiles that it reuses, a lookup of Statements, and the limits.
 * @returns The validator.
 * @throws `DataError` when the profile is not valid, when a primary Pattern reaches an id that no profile defines, or when the
 * options are not an object with `profiles` as a list of profiles, `findStatement` as a function, and `maxFindings` and
 * `maxStatements` as positive integers.
 * @throws `LimitError` with the limit `MAX_MATCHED_PATTERNS` or `MAX_MATCHED_MEMBERS` when the primary Patterns reach more than
 * 1,000 Patterns or 10,000 members.
 * @see {@link https://github.com/adlnet/xapi-profiles/blob/master/xapi-profiles-communication.md#20-algorithms | xAPI Profiles 1.0, Part Three, Algorithms}
 */
export function createProfileValidator(profile: unknown, options?: ProfileValidatorOptions): ProfileValidator {
  const checked = parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
  const maxFindings = checked.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const maxStatements = checked.maxStatements ?? DEFAULT_MAX_STATEMENTS;
  const { findStatement } = checked;
  const read = readProfileAndOthers(profile, { profiles: checked.profiles ?? [], maxFindings });
  const references = collectReferences(read.profile, read.others);
  const primary = (read.profile.patterns ?? []).filter((pattern) => pattern.primary === true).map(({ id }) => id);
  const graph = buildPatternGraph(
    primary,
    (id) => findPattern(references, id),
    (id) => references.templates.has(id) || references.otherTemplates.has(id),
  );
  const judge: TemplateJudge = {
    templates: templatesOf(read.profile, references).map(compileTemplate),
    extensions: extensionsOf(read.profile, read.others),
    version: latestVersion(read.profile),
  };

  /** Finds a Statement through the host's lookup, read by the rules of an LRS. */
  const hostStatement = (id: string): Statement | undefined => {
    if (findStatement === undefined) return undefined;
    const found = findStatement(id);
    if (found === undefined) return undefined;
    try {
      return readEitherVersion(found);
    } catch (caught) {
      throw new DataError(`The Statement that findStatement returned for ${JSON.stringify(id)} is not one of xAPI.`, {
        cause: caught,
      });
    }
  };

  const prepared: Prepared = { judge, graph, maxFindings, maxStatements, hostStatement };
  return {
    profile: read.profile,
    version: judge.version,
    validateStatement(statement) {
      const judged = judgeStatement(judge, readEitherVersion(statement), hostStatement);
      const sink = createIssueSink(maxFindings, false);
      sink.add(judged.issues);
      return { outcome: judged.outcome, templates: judged.templates, issues: sink.list() };
    },
    validateStatements(statements) {
      return validateList(prepared, statements);
    },
  };
}
