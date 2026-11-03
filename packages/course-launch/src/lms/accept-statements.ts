import { readClock } from "@interopkit/core";
import type { Statement, StatementIssue } from "@interopkit/learning-records";
import { classifyStatement } from "../rules/index.js";
import { cmi5VerbOf, judgeStatement, type SessionProgress, sessionOrder, timeOf } from "../rules/internal.js";
import { registrationOf } from "./create-registration.js";
import { type LmsSettings, signalOf, withRetries } from "./options.js";
import { auOf } from "./progress.js";
import type { Registration, Reservation, Session } from "./records.js";

/** The verbs of cmi5 that an assignable unit sends, which the LMS reserves in its session. */
const RESERVED_VERBS: ReadonlySet<string> = new Set(["initialized", "completed", "passed", "failed", "terminated"]);

/** Tells whether a verb of cmi5 is one that an assignable unit sends. */
const isReserved = (verb: string | undefined): verb is Reservation["verb"] =>
  verb !== undefined && RESERVED_VERBS.has(verb);

/** The id of a statement as the LRS keeps it, in lower case, or `undefined` for one sent without. */
const idOf = (statement: Statement): string | undefined => statement.id?.toLowerCase();

/**
 * What a session and its registration held before a batch: their reservations without those of the batch itself, so that a
 * batch sent again after a failure of the store is judged as it was the first time.
 */
function progressBefore(
  session: Session,
  au: Registration["aus"][string],
  batch: ReadonlySet<string>,
): SessionProgress {
  const held = session.reserved.filter(({ statement }) => !batch.has(statement));
  const initialized = held.find(({ verb }) => verb === "initialized");
  return {
    initializedAt: initialized?.time,
    terminated: held.some(({ verb }) => verb === "terminated"),
    verbs: held.map(({ verb }) => verb),
    completed: au.completed !== undefined && !batch.has(au.completed.statement),
    passed: au.passed !== undefined && !batch.has(au.passed.statement),
  };
}

/** The statements of a batch in the order of the session, each with its index in the batch. */
function inOrder(
  statements: readonly Statement[],
): readonly { readonly statement: Statement; readonly index: number }[] {
  return sessionOrder(statements).flatMap((index) => {
    const statement = statements[index];
    return statement === undefined ? [] : [{ statement, index }];
  });
}

/** Lists the reservations of the statements of a batch that cmi5 defines, in the order of the session. */
function reservationsOf(order: ReturnType<typeof inOrder>): readonly Reservation[] {
  return order.flatMap(({ statement }) => {
    const id = idOf(statement);
    if (id === undefined || classifyStatement(statement) !== "defined") return [];
    const verb = cmi5VerbOf(statement.verb.id);
    // A statement without a time was refused, so every statement here has one.
    return isReserved(verb) ? [{ verb, statement: id, time: timeOf(statement.timestamp) ?? 0 }] : [];
  });
}

/** Writes the completed and passed statements that a batch reserved into the record of its unit in the registration. */
function withOutcomes(
  registration: Registration,
  unit: string,
  reserved: readonly Reservation[],
): Registration | undefined {
  let au = auOf(registration, unit);
  let changed = false;
  for (const { verb, statement } of reserved) {
    if ((verb !== "completed" && verb !== "passed") || au[verb]?.statement === statement) continue;
    au = { ...au, [verb]: { statement, stored: false } };
    changed = true;
  }
  if (!changed) return undefined;
  return { ...registration, aus: { ...registration.aus, [unit]: au }, revision: registration.revision + 1 };
}

/** Judges a batch against its session and, when it keeps every rule, reserves its statements; returns the findings. */
async function judgeAndReserve(
  settings: LmsSettings,
  statements: readonly Statement[],
  sessionId: string,
): Promise<readonly StatementIssue[] | "conflict"> {
  const { store } = settings;
  const session = await store.session(sessionId, signalOf(settings));
  if (session === undefined || session.state !== "active") {
    return [
      { path: "", rule: "session-ended", message: "comes after the session ended (9.3.6, 9.3.8).", severity: "error" },
    ];
  }
  const registration = await registrationOf(settings, session.registration);
  const batch = new Set(statements.flatMap((statement) => idOf(statement) ?? []));
  const facts = {
    actor: session.actor,
    registration: session.registration,
    activityId: session.activityId,
    launchData: session.launchData,
    preferencesRead: session.preferencesRead,
  };
  let progress = progressBefore(session, auOf(registration, session.au), batch);
  const order = inOrder(statements);
  const findings: StatementIssue[] = [];
  for (const { statement, index } of order) {
    const judged = judgeStatement(statement, facts, progress);
    findings.push(...judged.findings.map((finding) => ({ ...finding, path: `[${index}].${finding.path}` })));
    progress = judged.next;
  }
  if (findings.some(({ severity }) => severity === "error")) return findings;
  const reserved = reservationsOf(order);
  const updated: Session = {
    ...session,
    reserved: [...session.reserved.filter(({ statement }) => !batch.has(statement)), ...reserved],
    lastStatementAt: readClock(settings.clock),
    revision: session.revision + 1,
  };
  if ((await store.putSession(updated, session.revision, signalOf(settings))) === "conflict") return "conflict";
  const outcomes = withOutcomes(registration, session.au, reserved);
  if (
    outcomes !== undefined &&
    (await store.putRegistration(outcomes, registration.revision, signalOf(settings))) === "conflict"
  ) {
    // The session holds the reservations now; the next try judges the batch the same and writes the registration again.
    return "conflict";
  }
  return findings;
}

/**
 * Judges the statements of a request of an assignable unit against its session, by the rules of cmi5, and reserves those that
 * keep them before the store holds them.
 *
 * @remarks
 * The statements are judged as the unit sent them, in the order of their timestamps, against what the session and the
 * registration held before the batch. A batch that keeps every rule reserves its statements that cmi5 defines in the session,
 * and its completed and passed statements in the registration, with conditional writes: two requests at once cannot both take
 * a verb that a session or a registration takes once. A batch sent again is judged as the first time, so a failure of the
 * store never blocks the unit's retry.
 *
 * @returns The findings; an error among them refuses the request with 403.
 */
export async function acceptStatements(
  settings: LmsSettings,
  statements: readonly Statement[],
  session: string,
): Promise<readonly StatementIssue[]> {
  return withRetries(settings, "judged statements", () => judgeAndReserve(settings, statements, session));
}
