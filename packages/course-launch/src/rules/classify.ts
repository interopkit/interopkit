import type { Statement } from "@interopkit/learning-records";
import { AU_VERBS, type AuVerb, CMI5_CATEGORIES, CMI5_EXTENSIONS, CMI5_VERBS, type Cmi5Verb } from "../model/index.js";

/** Tells whether a name is that of a verb of cmi5. */
const isCmi5Verb = (name: string): name is Cmi5Verb => Object.hasOwn(CMI5_VERBS, name);

/** The verbs of cmi5 by IRI. */
const VERBS_BY_ID: ReadonlyMap<string, Cmi5Verb> = new Map(
  Object.entries(CMI5_VERBS).flatMap(([name, id]) => (isCmi5Verb(name) ? [[id, name] as const] : [])),
);

/** Returns the name of the verb of cmi5 that an IRI is, or `undefined` for any other verb. */
export function cmi5VerbOf(id: string): Cmi5Verb | undefined {
  return VERBS_BY_ID.get(id);
}

/** The names of the verbs that an assignable unit sends, as a set of text. */
const AU_VERB_NAMES: ReadonlySet<string> = new Set(AU_VERBS);

/** Tells whether a verb of cmi5, by name, is one that an assignable unit sends. */
export const isAuVerb = (name: string | undefined): name is AuVerb => name !== undefined && AU_VERB_NAMES.has(name);

/** Lists the ids of the activities of the `category` of a statement. */
export function categoryIdsOf(statement: Statement): readonly string[] {
  return (statement.context?.contextActivities?.category ?? []).map(({ id }) => id);
}

/** Tells whether the context of a statement carries a session id, as a context made from a template of cmi5 does. */
function hasSessionId(statement: Statement): boolean {
  return statement.context?.extensions?.[CMI5_EXTENSIONS.sessionId] !== undefined;
}

/**
 * Tells which kind of statement of cmi5 a statement is, from its form alone: one that cmi5 defines carries the category of
 * cmi5 and a verb of cmi5; one that it allows carries a context made from the template of a session, its session id, and not
 * the category of cmi5; any other is not allowed.
 *
 * @remarks
 * A statement with the category of cmi5 and another verb, or with the category of `moveOn` and no category of cmi5, is not
 * allowed. Whether a statement keeps every value of the template of its session, and the rules of its session, are judged by
 * `validateSessionStatements`, which knows the session.
 *
 * @param statement - A statement, read already by the rules of xAPI.
 * @returns `"defined"`, `"allowed"` or `"not-allowed"`.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#type_statement_au | cmi5, 7.1.3 Types of Statements}
 */
export function classifyStatement(statement: Statement): "defined" | "allowed" | "not-allowed" {
  const categories = categoryIdsOf(statement);
  if (categories.includes(CMI5_CATEGORIES.cmi5)) {
    return cmi5VerbOf(statement.verb.id) === undefined ? "not-allowed" : "defined";
  }
  return hasSessionId(statement) && !categories.includes(CMI5_CATEGORIES.moveOn) ? "allowed" : "not-allowed";
}
