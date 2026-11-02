import { callPort } from "@interopkit/core";
import { sameStatement, toStatementVersion } from "../../compare/index.js";
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

/** Tells whether a Statement is a voiding Statement: its Verb is the voided Verb and its Object a Statement Reference. */
function voidingTarget(statement: Statement): string | undefined {
  return statement.verb.id === VERB_VOIDED && statement.object.objectType === "StatementRef"
    ? statement.object.id.toLowerCase()
    : undefined;
}

/**
 * Finds the Statements that the batch voids: the targets that the LRS holds or the batch has, which are not voiding Statements
 * themselves, since a voiding Statement cannot be voided (4.2.5). A target that is nowhere is left alone.
 */
async function voidedBy(context: Context, statements: readonly Statement[]): Promise<Verdict<readonly string[]>> {
  const { signal } = context.settings;
  const inBatch = new Map(statements.map((statement) => [statement.id, statement]));
  const voids = new Set<string>();
  for (const statement of statements) {
    const target = voidingTarget(statement);
    if (target === undefined) continue;
    const sibling = inBatch.get(target);
    if (sibling !== undefined) {
      if (voidingTarget(sibling) === undefined) voids.add(target);
      continue;
    }
    const asked = await callPort(() => context.settings.statements.get(target, { voided: false, signal }), signal);
    if (asked === undefined) return refused(500, FAILED);
    if (asked.value !== undefined && voidingTarget(asked.value.statement) === undefined) voids.add(target);
  }
  return { value: [...voids] };
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

/**
 * Stores the Statements of a request and tells the host's store of the Activities. An id that the LRS holds already is
 * compared with the Statement that came, as the route answers it: the same Statement is a resend, and another is a conflict
 * (4.1.6.1).
 */
export async function storeStatements(context: Context, prepared: Prepared): Promise<Verdict<Stored>> {
  const { statements, stored, attachments } = prepared;
  const { signal } = context.settings;
  const ids = statements.map(({ id }) => id);
  if (statements.length === 0) return { value: { ids, created: false } };
  const voids = await voidedBy(context, statements);
  if (isRefusal(voids)) return voids;
  const batch: StoredStatement[] = statements.map((statement) => ({
    statement,
    stored,
    voided: false,
    version: context.version,
  }));
  const inserted = await callPort(
    () => context.settings.statements.insert(batch, voids.value, attachments, { signal }),
    signal,
  );
  if (inserted === undefined) return refused(500, FAILED);
  const submitted = new Map(statements.map((statement) => [statement.id, statement]));
  for (const held of inserted.value.existing) {
    const sent = held.statement.id === undefined ? undefined : submitted.get(held.statement.id);
    // A resend on the route of 1.0.3 is compared with what that route answers for the Statement held (2.5 of the gaps page).
    const answered = context.version === "1.0.3" ? toStatementVersion(held.statement, "1.0.3") : held.statement;
    if (sent !== undefined && !sameStatement(answered, sent)) {
      return refused(
        409,
        `The LRS holds another Statement with the id ${held.statement.id}, and a Statement is not changed.`,
      );
    }
  }
  const seen = await callPort(
    () => context.settings.activities.observe(activitiesOfAll(statements), context.access.authority, { signal }),
    signal,
  );
  if (seen === undefined) return refused(500, FAILED);
  return { value: { ids, created: inserted.value.existing.length < statements.length } };
}
