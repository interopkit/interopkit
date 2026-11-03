import { callPort, DataError } from "@interopkit/core";
import { convertStatementVersion, isSameStatement } from "../../compare/index.js";
import { iriKey } from "../../compare/internal.js";
import { type Activity, type Statement, VERB_VOIDED } from "../../model/index.js";
import type { StoredStatement } from "../ports.js";
import { activitiesIn } from "../query.js";
import { type Context, isRefusal, refused, type Verdict } from "../verdict.js";
import type { Prepared } from "./prepare.js";

/** What storing the Statements of a request did. */
export interface Stored {
  /** The ids of the Statements, in the order of the request. */
  readonly ids: readonly string[];
  /** Whether the request stored at least one Statement that the LRS did not hold. */
  readonly created: boolean;
}

const FAILED = "The LRS could not store the Statements.";

/** Lists the ids of the Statements that the Statements of a batch void: the targets of those with the voided Verb. */
function voidingTargets(statements: readonly Statement[]): readonly string[] {
  const targets = new Set<string>();
  for (const { verb, object } of statements) {
    if (verb.id === VERB_VOIDED && object.objectType === "StatementRef") targets.add(object.id.toLowerCase());
  }
  return [...targets];
}

/**
 * Lists the Activities of the Statements in their order: every mention that has a definition, so that a store that joins the
 * definitions of one Activity from several Statements sees each of them (4.1.6.4), and the first mention of an Activity that no
 * Statement defines, so that it sees every id.
 */
function activitiesOfAll(statements: readonly Statement[]): readonly Activity[] {
  const mentions = statements.flatMap(activitiesIn);
  const defined = new Set(mentions.filter(({ definition }) => definition !== undefined).map(({ id }) => iriKey(id)));
  const bare = new Set<string>();
  return mentions.filter((activity) => {
    if (activity.definition !== undefined) return true;
    const key = iriKey(activity.id);
    if (defined.has(key) || bare.has(key)) return false;
    bare.add(key);
    return true;
  });
}

/** Tells whether the Statements that the LRS holds with ids of a request are the ones that came, as the route answers them. */
function resends(
  context: Context,
  existing: readonly StoredStatement[],
  statements: readonly Statement[],
): Verdict<ReadonlyMap<string, Statement>> {
  const submitted = new Map(statements.map((statement) => [statement.id, statement]));
  const same = new Map<string, Statement>();
  for (const held of existing) {
    const { id } = held.statement;
    const sent = submitted.get(id);
    if (id === undefined || sent === undefined) {
      throw new DataError(`The answer of StatementStore.insert names ${id}, which is no Statement of the batch.`);
    }
    // A resend on the route of 1.0.3 is compared with what that route answers for the Statement held (2.5 of the gaps page).
    const answered = context.version === "1.0.3" ? convertStatementVersion(held.statement, "1.0.3") : held.statement;
    if (!isSameStatement(answered, sent)) {
      return refused(409, `The LRS holds another Statement with the id ${id}, and a Statement is not changed.`);
    }
    same.set(id, held.statement);
  }
  return { value: same };
}

/**
 * Stores the Statements that the LRS does not hold. The store takes a batch whole or not at all, so a batch with an id that it
 * holds is compared first: another Statement refuses the request with nothing stored (4.1.5), and a resend leaves the others to
 * store. Each round leaves out at least one Statement, and another writer may take an id between two rounds.
 *
 * @returns The Statements that the LRS held, by id.
 */
async function storeNew(context: Context, prepared: Prepared): Promise<Verdict<ReadonlyMap<string, Statement>>> {
  const { stored, attachments } = prepared;
  const { signal } = context.settings;
  const held = new Map<string, Statement>();
  let pending: Prepared["statements"] = prepared.statements;
  while (pending.length > 0) {
    const batch: StoredStatement[] = pending.map((statement) => ({
      statement,
      stored,
      voided: false,
      version: context.version,
    }));
    const targets = voidingTargets(pending);
    const inserted = await callPort(
      () => context.settings.statements.insert(batch, targets, attachments, { signal }),
      signal,
    );
    if (inserted === undefined) return refused(500, FAILED);
    const same = resends(context, inserted.value.existing, pending);
    if (isRefusal(same)) return same;
    if (same.value.size === 0) break;
    for (const [id, statement] of same.value) held.set(id, statement);
    pending = pending.filter(({ id }) => !held.has(id));
  }
  return { value: held };
}

/**
 * Stores the Statements of a request and tells the host's store of the Activities. An id that the LRS holds already is compared
 * with the Statement that came: the same Statement is a resend, which changes nothing, and another is a conflict (4.1.6.1). The
 * store of Activities sees a resend as the LRS holds it, so that a definition which a resend changes reaches no Object of the LRS.
 */
export async function storeStatements(context: Context, prepared: Prepared): Promise<Verdict<Stored>> {
  const { statements } = prepared;
  const { signal } = context.settings;
  const ids = statements.map(({ id }) => id);
  if (statements.length === 0) return { value: { ids, created: false } };
  const held = await storeNew(context, prepared);
  if (isRefusal(held)) return held;
  const seen = activitiesOfAll(statements.map((statement) => held.value.get(statement.id) ?? statement));
  const told = await callPort(
    () => context.settings.activities.observe(seen, context.access.authority, { signal }),
    signal,
  );
  if (told === undefined) return refused(500, FAILED);
  return { value: { ids, created: held.value.size < statements.length } };
}
