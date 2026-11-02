import type { Clock } from "@interopkit/core";
import type { Activity, ActivityDefinition, Actor, AttachmentData, StatementQuery } from "@interopkit/learning-records";
import {
  type ActivityStore,
  matchesStatementQuery,
  type StatementStore,
  type StoredStatement,
} from "@interopkit/learning-records/store";

/** A Statement the LRS holds, with the number that puts it in the order of arrival. */
interface Held {
  readonly entry: StoredStatement;
  readonly order: number;
}

/** The stores of Statements and Activities that the example LRS keeps in memory, and what a test or a report reads of them. */
export interface MemoryStatements {
  readonly statements: StatementStore;
  readonly activities: ActivityStore;
  /** How many Statements are held, voided ones included. */
  readonly count: () => number;
  /** Every Statement held, in the order of arrival. */
  readonly all: () => readonly StoredStatement[];
}

/** Whether an authority is the one that another is, by the identifiers they carry. */
function sameAuthority(a: Actor, b: Actor): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Joins the definition that the LRS knows with the one a Statement brings: language maps and extensions grow, the rest is the newer. */
function mergedDefinition(known: Activity | undefined, seen: Activity): ActivityDefinition {
  const before = known?.definition;
  const now = seen.definition;
  return {
    ...before,
    ...now,
    ...(before?.name === undefined && now?.name === undefined ? {} : { name: { ...before?.name, ...now?.name } }),
    ...(before?.description === undefined && now?.description === undefined
      ? {}
      : { description: { ...before?.description, ...now?.description } }),
    ...(before?.extensions === undefined && now?.extensions === undefined
      ? {}
      : { extensions: { ...before?.extensions, ...now?.extensions } }),
  };
}

/**
 * Keeps Statements and Attachment data in memory. One call of a method runs to its end before another starts, since nothing
 * in it waits, so every method is atomic as the ports ask.
 *
 * @param clock - The clock of the LRS, which `consistentThrough` reads.
 */
export function createMemoryStatements(clock: Clock): MemoryStatements {
  const held = new Map<string, Held>();
  const data = new Map<string, AttachmentData>();
  const definitions = new Map<string, { readonly activity: Activity; readonly authority: Actor }>();
  let arrived = 0;

  const statements: StatementStore = {
    async insert(batch, voids, attachments) {
      const existing: StoredStatement[] = [];
      for (const entry of batch) {
        const id = entry.statement.id ?? "";
        const present = held.get(id);
        if (present === undefined) {
          arrived += 1;
          held.set(id, { entry, order: arrived });
        } else existing.push(present.entry);
      }
      for (const id of voids) {
        const target = held.get(id);
        if (target !== undefined) held.set(id, { ...target, entry: { ...target.entry, voided: true } });
      }
      for (const attachment of attachments) data.set(attachment.sha2, attachment);
      return { existing };
    },
    async get(id, { voided }) {
      const found = held.get(id)?.entry;
      return found !== undefined && found.voided === voided ? found : undefined;
    },
    async query(query: StatementQuery, page) {
      // A cursor is the arrival number of the last Statement of the page before: it stays right while Statements arrive.
      const after = page.cursor === undefined ? undefined : Number(page.cursor);
      if (after !== undefined && !Number.isSafeInteger(after)) return undefined;
      const ascending = query.ascending === true;
      const target = (id: string) => held.get(id)?.entry.statement;
      const matching = [...held.values()]
        .filter(({ entry }) => !entry.voided && matchesStatementQuery(entry.statement, query, target))
        .sort((a, b) => (ascending ? a.order - b.order : b.order - a.order))
        .filter(({ order }) => after === undefined || (ascending ? order > after : order < after));
      const pageOf = matching.slice(0, page.limit);
      const last = pageOf.at(-1);
      return {
        statements: pageOf.map(({ entry }) => entry),
        ...(matching.length > pageOf.length && last !== undefined ? { cursor: String(last.order) } : {}),
      };
    },
    async consistentThrough() {
      return new Date(clock.now()).toISOString();
    },
    async attachments(hashes) {
      const found = new Map<string, AttachmentData>();
      for (const hash of hashes) {
        const stored = data.get(hash);
        if (stored !== undefined) found.set(hash, stored);
      }
      return found;
    },
  };

  // The first sender of an Activity defines it, and only that authority adds to the definition later (4.2.2.3). The Activity that
  // the LRS answers with has all that is known of it: the languages of its name and description from every Statement, and the
  // newest of everything else.
  const activities: ActivityStore = {
    async get(id) {
      return definitions.get(id)?.activity;
    },
    async observe(seen, authority) {
      for (const activity of seen) {
        if (activity.definition === undefined) continue;
        const known = definitions.get(activity.id);
        if (known === undefined || sameAuthority(known.authority, authority)) {
          definitions.set(activity.id, {
            activity: {
              id: activity.id,
              objectType: "Activity",
              definition: mergedDefinition(known?.activity, activity),
            },
            authority,
          });
        }
      }
    },
  };

  return {
    statements,
    activities,
    count: () => held.size,
    all: () => [...held.values()].sort((a, b) => a.order - b.order).map(({ entry }) => entry),
  };
}
