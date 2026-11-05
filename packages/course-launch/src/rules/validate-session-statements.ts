import {
  createIssueSink,
  DEFAULT_MAX_FINDINGS,
  type Issue,
  isAbsoluteUri,
  isUuid,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import {
  type Agent,
  findStatementTime,
  readStatement,
  type Statement,
  validateStatements,
} from "@interopkit/learning-records";
import * as v from "valibot";
import { judgeStatement } from "./judge-statement.js";
import { readLaunchDataAs } from "./launch-documents.js";
import { type SessionFacts, sessionStart } from "./session.js";
import { checkXapiPart } from "./xapi-parts.js";

const optionsSchema = strictRecord({ maxFindings: v.optional(positiveIntegerSchema) });

/** The rules of xAPI that the statements of a session follow: those of an LRS of 1.0.3, the version that cmi5 names. */
const XAPI_RULES_OF_AN_LRS = { role: "lrs", version: "1.0.3" } as const;

const factsSchema = strictRecord({
  actor: v.unknown(),
  registration: v.pipe(
    v.string(),
    v.check(isUuid, (issue) => `expected a UUID, found ${issue.received}`),
  ),
  activityId: v.pipe(
    v.string(),
    v.check(isAbsoluteUri, (issue) => `expected a fully qualified IRI, found ${issue.received}`),
  ),
  launchData: v.unknown(),
  prior: v.optional(strictRecord({ completed: v.optional(v.boolean()), passed: v.optional(v.boolean()) })),
  preferencesRead: v.optional(v.boolean()),
});

/** Reads the facts of a session that a host passes. */
function readFacts(value: unknown): SessionFacts {
  const label = "The session";
  const read = parseWith(factsSchema, value, label);
  checkXapiPart("actor", read.actor, `${label} at actor`);
  const launchData = readLaunchDataAs(read.launchData, `${label} at launchData`);
  const { prior, preferencesRead } = read;
  return {
    // The rules of xAPI took it as an Actor; a Group cannot launch, and the rules of cmi5 refuse its statements.
    actor: read.actor as Agent,
    registration: read.registration,
    activityId: read.activityId,
    launchData,
    ...(prior === undefined ? {} : { prior }),
    ...(preferencesRead === undefined ? {} : { preferencesRead }),
  };
}

/** The order in which a session judges its statements: by time, and a statement without one where it stands. */
export function sessionOrder(statements: readonly Statement[]): readonly number[] {
  let previous = Number.NEGATIVE_INFINITY;
  const timed = statements.map((statement, index) => {
    previous = findStatementTime(statement) ?? previous;
    return { index, time: previous };
  });
  return timed.sort((left, right) => left.time - right.time).map(({ index }) => index);
}

/**
 * Judges the statements that an assignable unit sent in one session against the launch data of the session and what its
 * registration held before it, as an LMS or a tool of reports judges a recorded session.
 *
 * @remarks
 * Each statement is read by the rules of xAPI 1.0.3 for an LRS first, and one with an error of xAPI is not judged further.
 * The others are judged in the order of their timestamps, a statement without one where it stands: every statement has an id,
 * a time in UTC, the actor and the registration of the launch, and every value of the context template; it comes after the
 * initialized statement and before the terminated one; and a statement that cmi5 defines has a verb of an assignable unit, an
 * actor with an account, the activity of the launch as its object, a result as its verb asks, a score that agrees with the
 * mastery score, and no verb that the session or the registration forbids. The rules table of the guide lists each rule.
 *
 * @param statements - The statements of the session, as the assignable unit sent them.
 * @param session - The facts of the session.
 * @param options - The most findings, 1,000 by default.
 * @returns The findings, with paths in the list of statements, in the order of the session; empty for a session that keeps
 * every rule.
 * @throws `DataError` that names the path of the first fault, when the facts or the options are not valid.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_data_model | cmi5, 9.0 xAPI Statement Data Model}
 */
export function validateSessionStatements(
  statements: readonly Statement[],
  session: SessionFacts,
  options?: { readonly maxFindings?: number },
): readonly Issue[] {
  const { maxFindings = DEFAULT_MAX_FINDINGS } = parseWith(
    optionsSchema,
    options === undefined ? {} : options,
    "The options object",
  );
  const facts = readFacts(session);
  const sink = createIssueSink(maxFindings, false);
  const xapi = validateStatements(statements, { ...XAPI_RULES_OF_AN_LRS, maxFindings });
  sink.add(xapi);
  if (!Array.isArray(statements) || sink.stopped) return sink.list();
  const refused = new Set(
    xapi.filter(({ severity }) => severity === "error").map(({ path }) => Number(/^\[(\d+)\]/u.exec(path)?.[1])),
  );
  // Each statement is judged as the rules of xAPI read it, a single Activity of a context as a list. The list of xAPI did not
  // stop, so it holds every error, and a statement that it does not refuse is read.
  const read = statements.flatMap((statement: unknown, index) =>
    refused.has(index) ? [] : [{ index, statement: readStatement(statement, XAPI_RULES_OF_AN_LRS) }],
  );
  const ordered = sessionOrder(read.map(({ statement }) => statement)).flatMap((position) => read[position] ?? []);
  let progress = sessionStart(facts);
  for (const { index, statement } of ordered) {
    if (sink.stopped) break;
    const judged = judgeStatement(statement, facts, progress);
    sink.add(judged.findings.map((finding) => ({ ...finding, path: `[${index}].${finding.path}` })));
    progress = judged.next;
  }
  return sink.list();
}
