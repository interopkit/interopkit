import { type Issue, isSameJson } from "@interopkit/core/checks";
import {
  type Activity,
  type Context,
  findStatementTime,
  isSameActor,
  type Statement,
  VERB_VOIDED,
} from "@interopkit/learning-records";
import { CMI5_CATEGORIES, CMI5_EXTENSIONS, type Cmi5Verb } from "../model/index.js";
import { categoryIdsOf, classifyStatement, cmi5VerbOf, isAuVerb } from "./classify.js";
import type { SessionFacts, SessionProgress } from "./session.js";

/** What judging one statement gives: its findings, with paths in the statement, and the session after it. */
export interface Judgement {
  readonly findings: readonly Issue[];
  readonly next: SessionProgress;
}

/** The verbs that Browse and Review forbid, since they record satisfaction (10.2.2). */
const JUDGED_VERBS: ReadonlySet<Cmi5Verb> = new Set(["completed", "passed", "failed"]);

/** The verbs whose statements carry a duration (9.5.4.1). */
const TIMED_VERBS: ReadonlySet<Cmi5Verb> = new Set(["completed", "passed", "failed", "terminated"]);

/** The value that `success` must have for each verb, and none for the others (9.5.2). */
const SUCCESS: Partial<Record<Cmi5Verb, boolean>> = { passed: true, failed: false };

/** The value that `completion` must have for each verb, and none for the others (9.5.3). */
const COMPLETION: Partial<Record<Cmi5Verb, boolean>> = { completed: true };

/** The most that the `progress` extension may say, a percentage (9.5.5.1). */
const MAX_PROGRESS = 100;

/** A time of xAPI in UTC: `Z`, or an offset of zero in a form that ISO 8601 writes. */
const UTC = /(?:[Zz]|\+00(?::?00)?)$/u;

/** The findings of one statement, as it builds them. */
class Findings {
  readonly list: Issue[] = [];

  error(path: string, rule: string, message: string): void {
    this.list.push({ path, rule, message, severity: "error" });
  }

  warning(path: string, rule: string, message: string): void {
    this.list.push({ path, rule, message, severity: "warning" });
  }
}

/** Judges what every statement of an assignable unit needs: an id, a time in UTC, the actor, and no voiding (6.3, 9.1, 9.2, 9.7). */
function judgeIdentity(statement: Statement, facts: SessionFacts, found: Findings): void {
  if (statement.id === undefined)
    found.error("id", "statement-id", "is missing: an assignable unit gives each statement an id (9.1).");
  if (statement.verb.id === VERB_VOIDED) {
    found.error("verb.id", "voiding", "is the voided verb, which no assignable unit may use (6.3).");
  }
  if (statement.timestamp === undefined) {
    found.error("timestamp", "timestamp", "is missing: every statement has its time, by which cmi5 orders them (9.7).");
  } else if (!UTC.test(statement.timestamp)) {
    found.error("timestamp", "timestamp-utc", `${JSON.stringify(statement.timestamp)} is not in UTC (9.7).`);
  }
  if (statement.actor.objectType === "Group" || !isSameActor(statement.actor, facts.actor)) {
    found.error(
      "actor",
      "actor",
      "is not the learner that the LMS gave the session in the actor of its launch (8.1.3, 9.2).",
    );
  }
}

/** Judges the context of a statement against the template of its session and its registration (9.6, 10.2.1). */
function judgeContext(statement: Statement, facts: SessionFacts, found: Findings): void {
  const { context } = statement;
  if (context?.registration !== facts.registration) {
    found.error(
      "context.registration",
      "registration",
      `is not ${facts.registration}, the registration of the launch (8.1.4, 9.6.1).`,
    );
  }
  const sessionId = facts.launchData.contextTemplate.extensions?.[CMI5_EXTENSIONS.sessionId];
  if (context?.extensions?.[CMI5_EXTENSIONS.sessionId] === undefined) {
    found.error(
      "context.extensions",
      "session-id",
      "has no session id, which every statement of a session carries (9.6.3.1).",
    );
  } else if (!isSameJson(context.extensions[CMI5_EXTENSIONS.sessionId], sessionId)) {
    found.error("context.extensions", "session-id", "has a session id other than that of the session (9.6.3.1).");
  }
  judgeTemplate(facts.launchData.contextTemplate, context, found);
}

/** The lists of Activities of a context by the key of `contextActivities`, in the order the context gives them. */
function activityLists(context: Context | undefined): ReadonlyMap<string, readonly Activity[]> {
  return new Map(Object.entries((context?.contextActivities ?? {}) as Readonly<Record<string, readonly Activity[]>>));
}

/** Judges that a context keeps every activity of the lists of the template (10.2.1). */
function judgeTemplateActivities(template: Context, context: Context | undefined, found: Findings): void {
  const lists = activityLists(context);
  for (const [type, activities] of activityLists(template)) {
    const held = new Set((lists.get(type) ?? []).map(({ id }) => id));
    for (const { id } of activities.filter((activity) => !held.has(activity.id))) {
      found.error(
        `context.contextActivities.${type}`,
        "context-template",
        `lacks the activity ${JSON.stringify(id)} of the context template of the session (10.2.1).`,
      );
    }
  }
}

/** Judges that a context keeps every value of the template, which an assignable unit may add to and never overwrite (10.2.1). */
function judgeTemplate(template: Context, context: Context | undefined, found: Findings): void {
  judgeTemplateActivities(template, context, found);
  for (const [key, value] of Object.entries(template.extensions ?? {})) {
    if (key !== CMI5_EXTENSIONS.sessionId && !isSameJson(context?.extensions?.[key], value)) {
      found.error(
        "context.extensions",
        "context-template",
        `does not keep ${JSON.stringify(key)} of the context template (10.2.1).`,
      );
    }
  }
  const members = new Map<string, unknown>(Object.entries(context ?? {}));
  for (const [key, value] of Object.entries(template)) {
    if (key !== "contextActivities" && key !== "extensions" && !isSameJson(members.get(key), value)) {
      found.error(
        `context.${key}`,
        "context-template",
        "does not keep the value of the context template of the session (10.2.1).",
      );
    }
  }
}

/** Judges where a statement falls in its session: after initialized, before terminated (7.1, 9.3). */
function judgeOrder(
  statement: Statement,
  verb: Cmi5Verb | undefined,
  progress: SessionProgress,
  found: Findings,
): void {
  const time = findStatementTime(statement);
  if (verb !== "initialized" && progress.initializedAt === undefined) {
    found.error(
      "verb.id",
      "before-initialized",
      "comes before the initialized statement, which is the first of a session (9.3.2).",
    );
  } else if (time !== undefined && progress.initializedAt !== undefined && time < progress.initializedAt) {
    found.error(
      "timestamp",
      "before-initialized",
      "is before the time of the initialized statement of the session (9.3).",
    );
  }
  if (progress.terminated) {
    found.error(
      "verb.id",
      "after-terminated",
      "comes after the terminated statement, which is the last of a session (9.3.8).",
    );
  }
}

/** Judges the category of `moveOn`: on a statement that cmi5 defines with `success` or `completion`, and on no other (9.6.2.2). */
function judgeMoveOnCategory(statement: Statement, defined: boolean, found: Findings): void {
  const has = categoryIdsOf(statement).includes(CMI5_CATEGORIES.moveOn);
  const needs = defined && (statement.result?.success !== undefined || statement.result?.completion !== undefined);
  if (has === needs) return;
  found.error(
    "context.contextActivities.category",
    "move-on-category",
    needs
      ? "lacks the activity of moveOn, which a statement with success or completion carries (9.6.2.2)."
      : "has the activity of moveOn, which only a statement of cmi5 with success or completion carries (9.6.2.2).",
  );
}

/** Judges the verb of a statement that cmi5 defines against the session and the registration (9.3, 10.2.2). */
function judgeVerb(verb: Cmi5Verb, facts: SessionFacts, progress: SessionProgress, found: Findings): void {
  if (progress.verbs.includes(verb)) {
    found.error("verb.id", "verb-repeated", `is ${verb} a second time in the session (9.3).`);
  }
  if (
    (verb === "passed" && progress.verbs.includes("failed")) ||
    (verb === "failed" && progress.verbs.includes("passed"))
  ) {
    found.error(
      "verb.id",
      "passed-and-failed",
      "is passed and failed in one session, which may have one of them (9.3).",
    );
  }
  if (verb === "completed" && progress.completed && !progress.verbs.includes("completed")) {
    found.error("verb.id", "completed-in-registration", "is a second completed in the registration (9.3.3).");
  }
  if (verb === "passed" && progress.passed && !progress.verbs.includes("passed")) {
    found.error("verb.id", "passed-in-registration", "is a second passed in the registration (9.3.4).");
  }
  if (verb === "failed" && progress.passed) {
    found.error("verb.id", "failed-after-passed", "is a failed after a passed in the registration (9.3).");
  }
  const mode = facts.launchData.launchMode;
  if (mode !== "Normal" && JUDGED_VERBS.has(verb)) {
    found.error("verb.id", "launch-mode", `is ${verb}, which the launch mode ${mode} forbids (10.2.2).`);
  }
  if (verb === "initialized" && facts.preferencesRead === false) {
    found.error(
      "verb.id",
      "preferences-unread",
      "comes before the assignable unit read the preferences of the learner (11.0).",
    );
  }
}

/** Judges the result of a statement that cmi5 defines: success, completion, duration and score (9.5). */
function judgeResult(statement: Statement, verb: Cmi5Verb, found: Findings): void {
  const { result } = statement;
  if (result?.success !== SUCCESS[verb]) {
    found.error(
      "result.success",
      "result-success",
      SUCCESS[verb] === undefined
        ? `is given in ${verb}, which has none (9.5.2).`
        : `is not ${SUCCESS[verb]} in ${verb} (9.5.2).`,
    );
  }
  if (result?.completion !== COMPLETION[verb]) {
    found.error(
      "result.completion",
      "result-completion",
      COMPLETION[verb] === undefined
        ? `is given in ${verb}, which has none (9.5.3).`
        : `is not true in ${verb} (9.5.3).`,
    );
  }
  if (TIMED_VERBS.has(verb) && result?.duration === undefined) {
    found.error("result.duration", "result-duration", `is missing: ${verb} carries the duration (9.5.4).`);
  }
  if (result?.score !== undefined && verb !== "passed" && verb !== "failed") {
    found.error(
      "result.score",
      "result-score",
      `is given in ${verb}, and only passed and failed carry a score (9.5.1).`,
    );
  }
}

/** Judges the extension `progress` of any statement: an integer percentage, and none in completed (9.5.5.1). */
function judgeProgress(statement: Statement, verb: Cmi5Verb | undefined, found: Findings): void {
  const progress = statement.result?.extensions?.[CMI5_EXTENSIONS.progress];
  if (progress === undefined) return;
  if (!(typeof progress === "number" && Number.isInteger(progress) && progress >= 0 && progress <= MAX_PROGRESS)) {
    found.error("result.extensions", "progress", "has a progress that is not an integer from 0 to 100 (9.5.5.1).");
  } else if (verb === "completed") {
    found.warning("result.extensions", "progress", "has a progress in completed, which should have none (9.5.5.1).");
  }
}

/** Judges a score: a raw score between integer bounds, and the scaled score against the mastery score of the launch (9.5.1). */
function judgeScore(statement: Statement, verb: Cmi5Verb, facts: SessionFacts, found: Findings): void {
  const score = statement.result?.score;
  if (score === undefined) return;
  const { raw, min, max, scaled } = score;
  if (raw !== undefined && (min === undefined || max === undefined)) {
    found.error("result.score", "score-range", "has a raw score without min and max (9.5.1).");
  }
  if ([raw, min, max].some((value) => value !== undefined && !Number.isInteger(value))) {
    found.error("result.score", "score-range", "has a raw, min or max that is not an integer (9.5.1).");
  }
  const mastery = facts.launchData.masteryScore;
  if (mastery === undefined || (verb !== "passed" && verb !== "failed")) return;
  if (scaled !== undefined && (verb === "passed" ? scaled < mastery : scaled >= mastery)) {
    found.error(
      "result.score.scaled",
      "mastery-score",
      `is ${scaled}, and ${verb} needs a scaled score ${verb === "passed" ? "at or above" : "below"} the mastery score ${mastery} (9.3.4, 9.3.5).`,
    );
  }
  if (statement.context?.extensions?.[CMI5_EXTENSIONS.masteryScore] !== mastery) {
    found.error(
      "context.extensions",
      "mastery-extension",
      `has not the mastery score ${mastery} of the launch, which a ${verb} with a score carries (9.6.3.2).`,
    );
  }
}

/** The session after a statement: its verb of cmi5 counted, and the registration's completed and passed. */
function advance(verb: Cmi5Verb | undefined, time: number | undefined, progress: SessionProgress): SessionProgress {
  if (verb === undefined) return progress;
  return {
    initializedAt:
      verb === "initialized" && progress.initializedAt === undefined
        ? (time ?? Number.NEGATIVE_INFINITY)
        : progress.initializedAt,
    terminated: progress.terminated || verb === "terminated",
    verbs: progress.verbs.includes(verb) ? progress.verbs : [...progress.verbs, verb],
    completed: progress.completed || verb === "completed",
    passed: progress.passed || verb === "passed",
  };
}

/**
 * Judges one statement that an assignable unit sends against its session: the rules of every statement of the unit, and those
 * of the statements that cmi5 defines, in the order of the session that the progress gives.
 *
 * @param statement - The statement as the assignable unit sent it, read already by the rules of xAPI.
 * @param facts - The session.
 * @param progress - What the session held before the statement.
 * @returns The findings, with paths in the statement, and the session after it, which counts the statement whatever its
 * findings: a host that refuses the statement keeps the session it had.
 */
export function judgeStatement(statement: Statement, facts: SessionFacts, progress: SessionProgress): Judgement {
  const found = new Findings();
  const kind = classifyStatement(statement);
  const named = cmi5VerbOf(statement.verb.id);
  const verb = kind === "defined" && isAuVerb(named) ? named : undefined;
  judgeIdentity(statement, facts, found);
  judgeContext(statement, facts, found);
  judgeOrder(statement, verb, progress, found);
  judgeMoveOnCategory(statement, kind === "defined", found);
  if (categoryIdsOf(statement).includes(CMI5_CATEGORIES.cmi5)) judgeDefined(statement, verb, facts, progress, found);
  judgeProgress(statement, verb, found);
  return { findings: found.list, next: advance(verb, findStatementTime(statement), progress) };
}

/** Judges what a statement that cmi5 defines needs beyond any statement: its verb, actor, object and result (9.2 to 9.5). */
function judgeDefined(
  statement: Statement,
  verb: Cmi5Verb | undefined,
  facts: SessionFacts,
  progress: SessionProgress,
  found: Findings,
): void {
  if (verb === undefined) {
    found.error(
      "verb.id",
      "au-verb",
      `is not a verb of cmi5 that an assignable unit sends: initialized, completed, passed, failed or terminated (9.3).`,
    );
    return;
  }
  const { actor, object } = statement;
  if (actor.objectType === "Group" || actor.account === undefined) {
    found.error("actor", "actor-account", "is not an Agent with an account, as cmi5 identifies the learner (9.2).");
  }
  if (!("id" in object) || object.id !== facts.activityId || (object.objectType ?? "Activity") !== "Activity") {
    found.error("object", "object", `is not the activity ${facts.activityId} of the launch (8.1.5, 9.4).`);
  }
  judgeVerb(verb, facts, progress, found);
  judgeResult(statement, verb, found);
  judgeScore(statement, verb, facts, found);
}
