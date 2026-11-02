import type { Clock } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { Activity, AttachmentData, DocumentScope, DocumentTarget, LrsDocument } from "../src/index.js";
import {
  type Access,
  type ActivityStore,
  type DocumentStore,
  type LrsOptions,
  matchesStatementQuery,
  type StatementStore,
  type StoredStatement,
} from "../src/store/index.js";
import { uuid } from "./full-statement.js";

/** The time of the clock of the tests. */
export const NOW = "2026-01-15T10:30:00.000Z";

/** The authority that the access of the tests gives. */
export const AUTHORITY = { account: { homePage: "https://lrs.example.org", name: "client-1" } } as const;

const BASE = "https://lrs.example.org/xapi";

/** The Statements and Attachments of a store that lives in memory, with a record of the calls that reached it. */
export interface Memory {
  readonly held: Map<string, StoredStatement>;
  readonly data: Map<string, AttachmentData>;
  readonly observed: { activities: readonly Activity[]; authority: unknown }[];
  readonly definitions: Map<string, Activity>;
  readonly calls: string[];
  /** The documents by the JSON of their key, with the key. */
  readonly documents: Map<string, { readonly key: DocumentTarget; readonly document: LrsDocument }>;
  /** Runs inside a write or a delete of the documents, before the store compares, as another writer would. */
  interfere: (() => void) | undefined;
  statements: StatementStore;
  activities: ActivityStore;
  documentStore: DocumentStore;
}

/** Tells whether the key of a document is in a scope: every property of the scope is the key's. */
function inScope(key: DocumentTarget, scope: DocumentScope): boolean {
  const properties: Readonly<Record<string, unknown>> = key;
  return (
    key.resource === scope.resource &&
    Object.entries(scope).every(([name, value]) => JSON.stringify(properties[name]) === JSON.stringify(value))
  );
}

/** A store of Statements and Activities in memory that follows the contract of the ports. */
export function memory(): Memory {
  const held = new Map<string, StoredStatement>();
  const data = new Map<string, AttachmentData>();
  const observed: Memory["observed"] = [];
  const definitions = new Map<string, Activity>();
  const calls: string[] = [];
  const documents: Memory["documents"] = new Map();
  const state: { interfere: (() => void) | undefined } = { interfere: undefined };
  const statements: StatementStore = {
    async insert(batch, voids, attachments) {
      calls.push("insert");
      const existing = batch.flatMap(({ statement }) =>
        held.has(statement.id ?? "") ? [held.get(statement.id ?? "") as StoredStatement] : [],
      );
      for (const entry of batch) {
        const id = entry.statement.id ?? "";
        if (!held.has(id)) held.set(id, entry);
      }
      for (const id of voids) {
        const voided = held.get(id);
        if (voided !== undefined) held.set(id, { ...voided, voided: true });
      }
      for (const attachment of attachments) data.set(attachment.sha2, attachment);
      return { existing };
    },
    async get(id, options) {
      calls.push("get");
      const found = held.get(id);
      return found !== undefined && found.voided === options.voided ? found : undefined;
    },
    async query(query, page) {
      calls.push("query");
      const offset = page.cursor === undefined ? 0 : Number(page.cursor);
      if (!Number.isInteger(offset) || offset < 0) return undefined;
      const matching = [...held.values()]
        .filter((entry) => !entry.voided)
        .filter((entry) => matchesStatementQuery(entry.statement, query, (id) => held.get(id)?.statement))
        .sort((a, b) => Date.parse(a.stored) - Date.parse(b.stored));
      if (query.ascending !== true) matching.reverse();
      const slice = matching.slice(offset, offset + page.limit);
      const next = offset + page.limit;
      return { statements: slice, ...(next < matching.length ? { cursor: String(next) } : {}) };
    },
    async consistentThrough() {
      calls.push("consistentThrough");
      return NOW;
    },
    async attachments(hashes) {
      calls.push("attachments");
      return new Map(
        hashes.flatMap((hash) => (data.has(hash) ? [[hash, data.get(hash) as AttachmentData] as const] : [])),
      );
    },
  };
  const activities: ActivityStore = {
    async get(id) {
      calls.push("activities.get");
      return definitions.get(id);
    },
    async observe(seen, authority) {
      calls.push("observe");
      observed.push({ activities: seen, authority });
    },
  };
  const documentStore: DocumentStore = {
    async get(key) {
      calls.push("documents.get");
      return documents.get(JSON.stringify(key))?.document;
    },
    async write(key, document, condition) {
      calls.push("documents.write");
      state.interfere?.();
      const id = JSON.stringify(key);
      const current = documents.get(id)?.document;
      if ("ifMatch" in condition && current?.etag !== condition.ifMatch) return "precondition-failed";
      if ("ifNoneMatch" in condition && current !== undefined) return "precondition-failed";
      if ("none" in condition && current !== undefined) return "exists";
      documents.set(id, { key, document });
      return "written";
    },
    async delete(key, condition) {
      calls.push("documents.delete");
      state.interfere?.();
      const id = JSON.stringify(key);
      const current = documents.get(id)?.document;
      if (current === undefined) return "absent";
      if (current.etag !== condition.ifMatch) return "precondition-failed";
      documents.delete(id);
      return "deleted";
    },
    async list(scope, since) {
      calls.push("documents.list");
      const after = since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(since);
      return [...documents.values()]
        .filter(({ key, document }) => inScope(key, scope) && Date.parse(document.updated) > after)
        .map(({ key }) => ("stateId" in key ? key.stateId : key.profileId));
    },
    async deleteAll(scope) {
      calls.push("documents.deleteAll");
      for (const [id, { key }] of documents) if (inScope(key, scope)) documents.delete(id);
    },
  };
  return {
    held,
    data,
    observed,
    definitions,
    calls,
    documents,
    get interfere() {
      return state.interfere;
    },
    set interfere(change: (() => void) | undefined) {
      state.interfere = change;
    },
    statements,
    activities,
    documentStore,
  };
}

/** The clock of the tests. */
const CLOCK: Clock = { now: () => Date.parse(NOW) };

/** Access for every action, with the authority of the tests. */
export const ALLOW_ALL: Access = {
  allowed: true,
  authority: AUTHORITY,
  actions: [
    "statements.read",
    "statements.write",
    "state.read",
    "state.write",
    "profiles.read",
    "profiles.write",
    "activities.read",
    "agents.read",
  ],
};

/** The options of an LRS over a store in memory, with the changes a test makes. */
export function optionsOf(store: Memory, changes: Partial<LrsOptions> = {}): LrsOptions {
  let counter = 0;
  return {
    statements: store.statements,
    documents: store.documentStore,
    activities: store.activities,
    access: async () => ALLOW_ALL,
    clock: CLOCK,
    newId: () => {
      counter += 1;
      return uuid(900 + counter);
    },
    ...changes,
  };
}

/** What a test says of a request. */
export interface RequestInit {
  readonly query?: Readonly<Record<string, string>> | string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

/** Builds the request of a test to the Statements resource or another, with the version header unless a test names it. */
export function requestOf(method: string, path: string, init: RequestInit = {}): HttpRequest {
  const query = typeof init.query === "string" ? init.query : new URLSearchParams(init.query ?? {}).toString();
  const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : (init.body ?? new Uint8Array());
  return {
    method,
    url: `${BASE}${path}${query === "" ? "" : `?${query}`}`,
    headers: { "x-experience-api-version": "2.0.0", accept: "application/json", ...init.headers },
    body,
  };
}

/** The body of an answer as text. */
export function textOf(response: HttpResponse): string {
  return typeof response.body === "string" ? response.body : new TextDecoder().decode(response.body);
}

/** The message of a refusal that is written as JSON, which is how a request that names no Accept gets it. */
export function reasonOf(response: HttpResponse): string {
  return (JSON.parse(textOf(response)) as { message: string }).message;
}

/** The body of an answer as JSON. */
export function jsonOf(response: HttpResponse): unknown {
  return JSON.parse(textOf(response));
}
