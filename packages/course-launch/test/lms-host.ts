import type { Clock } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import {
  type Activity,
  type AttachmentData,
  type DocumentTarget,
  type LrsDocument,
  type Statement,
  VERB_VOIDED,
} from "@interopkit/learning-records";
import { createLrsClient } from "@interopkit/learning-records/client";
import {
  type Access,
  type ActivityStore,
  type DocumentStore,
  handleLrsRequest,
  type LrsOptions,
  matchesStatementQuery,
  readBasicAuthorization,
  type StatementStore,
  type StoredStatement,
} from "@interopkit/learning-records/store";
import { expect } from "vitest";
import { readCourseStructure } from "../src/index.js";
import {
  type Cmi5Store,
  extendLrsOptions,
  type ImportedCourse,
  importCourse,
  type LmsOptions,
  type Registration,
  type Session,
} from "../src/lms/index.js";

/** The origin of the LMS of the tests. */
export const ORIGIN = "https://lms.example.org";
/** The namespace of the ids that the LMS of the tests makes. */
export const NAMESPACE = "6f1c0b8e-2a4d-4c3e-9b5a-7d8e9f0a1b2c";
/** The time that the clock of the tests starts at. */
const START = Date.parse("2026-01-15T10:00:00.000Z");
/** The credential of the LMS itself, and the authority of what it writes. */
export const LMS_CREDENTIAL = `Basic ${btoa("lms:lms-secret")}`;
const LMS_AUTHORITY = { objectType: "Agent", account: { homePage: ORIGIN, name: "lms" } } as const;
/** The authority of the statements of assignable units. */
export const AU_AUTHORITY = { objectType: "Agent", account: { homePage: ORIGIN, name: "au" } } as const;
/** A learner. */
export const LEARNER = { objectType: "Agent", account: { homePage: ORIGIN, name: "learner-1" } } as const;

/** A course structure with a block of two units, the second NotApplicable, and a unit of its own after the block. */
export const COURSE_XML = `<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="https://publisher.example.org/course">
    <title><langstring lang="en-US">Geology</langstring></title>
    <description><langstring lang="en-US">Rocks and minerals.</langstring></description>
  </course>
  <objectives>
    <objective id="https://publisher.example.org/objectives/rocks">
      <title><langstring lang="en-US">Rocks</langstring></title>
      <description><langstring lang="en-US">Tell the kinds of rock apart.</langstring></description>
    </objective>
  </objectives>
  <block id="https://publisher.example.org/block">
    <title><langstring lang="en-US">Rocks</langstring></title>
    <description><langstring lang="en-US">The kinds of rock.</langstring></description>
    <au id="https://publisher.example.org/au/1" moveOn="CompletedAndPassed" masteryScore="0.8">
      <title><langstring lang="en-US">Igneous</langstring></title>
      <description><langstring lang="en-US">Rock from magma.</langstring></description>
      <url>au1/index.html?paramA=1</url>
      <launchParameters>level=2</launchParameters>
      <entitlementKey>key-1</entitlementKey>
    </au>
    <au id="https://publisher.example.org/au/2" moveOn="NotApplicable">
      <title><langstring lang="en-US">Glossary</langstring></title>
      <description><langstring lang="en-US">Words.</langstring></description>
      <url>https://content.example.org/glossary.html</url>
    </au>
  </block>
  <au id="https://publisher.example.org/au/3" moveOn="Completed" launchMethod="OwnWindow">
    <title><langstring lang="en-US">Minerals</langstring></title>
    <description><langstring lang="en-US">Crystals.</langstring></description>
    <url>https://content.example.org/minerals.html#start</url>
  </au>
</courseStructure>`;

/** The publisher ids of the units of the course of the tests. */
export const AU1 = "https://publisher.example.org/au/1";
export const AU2 = "https://publisher.example.org/au/2";
export const AU3 = "https://publisher.example.org/au/3";

/** A clock that the tests move. */
interface TestClock extends Clock {
  advance(milliseconds: number): void;
}

/** A store of courses, registrations and sessions in memory, which a test can make fail or race. */
interface MemoryCmi5Store extends Cmi5Store {
  readonly courses: Map<string, ImportedCourse>;
  readonly registrations: Map<string, Registration>;
  readonly sessions: Map<string, Session>;
  /** Makes the next calls of the methods named reject. */
  failing: Set<string>;
  /** Changes a record before the next puts of the kind named, so that they meet a conflict, as many times as given. */
  conflicts: { registration: number; session: number };
}

/** Makes a store of records in memory: a put compares the revision, as the port asks. */
function memoryCmi5Store(): MemoryCmi5Store {
  const courses = new Map<string, ImportedCourse>();
  const registrations = new Map<string, Registration>();
  const sessions = new Map<string, Session>();
  const store: MemoryCmi5Store = {
    courses,
    registrations,
    sessions,
    failing: new Set(),
    conflicts: { registration: 0, session: 0 },
    async course(id) {
      if (store.failing.has("course")) throw new Error("The store failed.");
      return structuredClone(courses.get(id));
    },
    async registration(id) {
      if (store.failing.has("registration")) throw new Error("The store failed.");
      return structuredClone(registrations.get(id));
    },
    async putRegistration(record, revision) {
      if (store.failing.has("putRegistration")) throw new Error("The store failed.");
      if (store.conflicts.registration > 0) {
        store.conflicts.registration -= 1;
        return "conflict";
      }
      const held = registrations.get(record.id);
      if ((revision === "absent" && held !== undefined) || (revision !== "absent" && held?.revision !== revision)) {
        return "conflict";
      }
      registrations.set(record.id, structuredClone(record));
      return "written";
    },
    async session(id) {
      if (store.failing.has("session")) throw new Error("The store failed.");
      return structuredClone(sessions.get(id));
    },
    async putSession(record, revision) {
      if (store.failing.has("putSession")) throw new Error("The store failed.");
      if (store.conflicts.session > 0) {
        store.conflicts.session -= 1;
        return "conflict";
      }
      const held = sessions.get(record.id);
      if ((revision === "absent" && held !== undefined) || (revision !== "absent" && held?.revision !== revision)) {
        return "conflict";
      }
      sessions.set(record.id, structuredClone(record));
      return "written";
    },
  };
  return store;
}

/** The stores of an LRS in memory, which keep the Statements in the order of arrival. */
interface MemoryLrs {
  readonly statements: StatementStore;
  readonly documents: DocumentStore;
  readonly activities: ActivityStore;
  /** Every Statement held, in the order of arrival. */
  readonly held: () => readonly Statement[];
  /** Makes the next inserts reject. */
  failInsert: number;
}

/** Makes the stores of an LRS in memory. */
function memoryLrs(): MemoryLrs {
  const held = new Map<string, StoredStatement>();
  const documents = new Map<string, { readonly key: DocumentTarget; readonly document: LrsDocument }>();
  const data = new Map<string, AttachmentData>();
  const lrs: MemoryLrs = {
    failInsert: 0,
    held: () => [...held.values()].map(({ statement }) => statement),
    statements: {
      async insert(batch, voids, attachments) {
        if (lrs.failInsert > 0) {
          lrs.failInsert -= 1;
          throw new Error("The store failed.");
        }
        const existing = batch.flatMap(({ statement }) => held.get(statement.id ?? "") ?? []);
        if (existing.length > 0) return { existing };
        for (const entry of batch) held.set(entry.statement.id ?? "", entry);
        for (const id of voids) {
          const target = held.get(id);
          if (target !== undefined && target.statement.verb.id !== VERB_VOIDED)
            held.set(id, { ...target, voided: true });
        }
        for (const attachment of attachments) data.set(attachment.sha2, attachment);
        return { existing: [] };
      },
      async get(id, { voided }) {
        const found = held.get(id);
        return found?.voided === voided ? found : undefined;
      },
      async query(query, page) {
        const offset = page.cursor === undefined ? 0 : Number(page.cursor);
        const matching = [...held.values()].filter(
          (entry) =>
            !entry.voided &&
            matchesStatementQuery(entry.statement, query, (id) => held.get(id)?.statement, {
              ...(page.authority === undefined ? {} : { authority: page.authority }),
            }),
        );
        if (query.ascending !== true) matching.reverse();
        const next = offset + page.limit;
        return {
          statements: matching.slice(offset, next),
          ...(next < matching.length ? { cursor: String(next) } : {}),
        };
      },
      async consistentThrough() {
        return "2026-01-15T10:00:00.000Z";
      },
      async attachments(hashes) {
        return new Map(
          hashes.flatMap((hash) => (data.has(hash) ? [[hash, data.get(hash) as AttachmentData] as const] : [])),
        );
      },
    },
    documents: {
      async get(key) {
        return documents.get(JSON.stringify(key))?.document;
      },
      async write(key, document, condition) {
        const id = JSON.stringify(key);
        const current = documents.get(id)?.document;
        if ("ifMatch" in condition && current?.etag !== condition.ifMatch) return "precondition-failed";
        if ("ifNoneMatch" in condition && current !== undefined) return "precondition-failed";
        if ("none" in condition && current !== undefined) return "exists";
        documents.set(id, { key, document });
        return "written";
      },
      async delete(key, condition) {
        const id = JSON.stringify(key);
        const current = documents.get(id)?.document;
        if (current === undefined) return "absent";
        if (current.etag !== condition.ifMatch) return "precondition-failed";
        documents.delete(id);
        return "deleted";
      },
      async list(scope) {
        return [...documents.values()]
          .filter(({ key }) => key.resource === scope.resource)
          .map(({ key }) => ("stateId" in key ? key.stateId : key.profileId));
      },
      async deleteAll(scope) {
        for (const [id, { key }] of documents) {
          if (key.resource === scope.resource && JSON.stringify(key).includes(JSON.stringify(scope.activityId))) {
            documents.delete(id);
          }
        }
      },
    },
    activities: {
      async get(): Promise<Activity | undefined> {
        return undefined;
      },
      async observe() {},
    },
  };
  return lrs;
}

/** The access of the host: the credential of the LMS may do everything, and nothing else is known. */
async function hostAccess(request: HttpRequest): Promise<Access> {
  const given = readBasicAuthorization(request);
  if (given?.user === "lms" && given.password === "lms-secret") {
    return {
      allowed: true,
      authority: LMS_AUTHORITY,
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
  }
  return { allowed: false, status: 401, reason: "Unknown credential.", challenge: 'Basic realm="xAPI"' };
}

/** Builds a plain request from the arguments of a `fetch`, with header names in lower case. */
function requestOf(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | Uint8Array },
): HttpRequest {
  const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : (init.body ?? new Uint8Array());
  return {
    method: init.method,
    url,
    headers: Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value])),
    body,
  };
}

/** An LMS of the tests: its store, its LRS, its clock, its options, and the requests of a unit. */
export interface TestHost {
  readonly store: MemoryCmi5Store;
  readonly lrs: MemoryLrs;
  readonly clock: TestClock;
  readonly options: LmsOptions;
  readonly lrsOptions: LrsOptions;
  /** The options of the host's LRS before `extendLrsOptions`. */
  readonly lrsBase: LrsOptions;
  readonly course: ImportedCourse;
  /** Makes the next calls of the client of the LMS reject, or the next writes of a document say what is given. */
  readonly recordsFail: {
    sendStatement: number;
    putDocument: number;
    putOutcome: "written" | "conflict" | "precondition-failed";
  };
  /** The LRS answering a request. */
  readonly handle: (request: HttpRequest) => Promise<HttpResponse>;
  /** Sends a request of xAPI 1.0.3 to the LRS. */
  readonly xapi: (
    method: string,
    path: string,
    init?: { readonly authorization?: string; readonly body?: unknown; readonly headers?: Record<string, string> },
  ) => Promise<HttpResponse>;
}

/** Makes an LMS of the tests over stores in memory, with the course of the tests imported. */
export function testHost(changes: Partial<LmsOptions> = {}): TestHost {
  const store = memoryCmi5Store();
  const lrs = memoryLrs();
  let now = START;
  const clock: TestClock = {
    now: () => now,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
  let counter = 0;
  const host: { lrsOptions?: LrsOptions } = {};
  const handle = (request: HttpRequest): Promise<HttpResponse> =>
    handleLrsRequest(request, host.lrsOptions ?? expect.unreachable("The LRS is not ready."));
  const recordsFail: TestHost["recordsFail"] = { sendStatement: 0, putDocument: 0, putOutcome: "written" };
  const client = createLrsClient({
    endpoint: `${ORIGIN}/xapi/`,
    version: "1.0.3",
    authorization: async () => LMS_CREDENTIAL,
    fetch: async (url, init) => {
      const response = await handle(requestOf(url, init));
      return new Response(response.body.length === 0 ? null : response.body, {
        status: response.status,
        headers: response.headers,
      });
    },
  });
  const records = {
    ...client,
    sendStatement: (...args: Parameters<typeof client.sendStatement>) => {
      if (recordsFail.sendStatement > 0) {
        recordsFail.sendStatement -= 1;
        return Promise.reject(new Error("The LRS failed."));
      }
      return client.sendStatement(...args);
    },
    putDocument: (...args: Parameters<typeof client.putDocument>) => {
      if (recordsFail.putDocument > 0) {
        recordsFail.putDocument -= 1;
        return Promise.reject(new Error("The LRS failed."));
      }
      return recordsFail.putOutcome === "written"
        ? client.putDocument(...args)
        : Promise.resolve(recordsFail.putOutcome);
    },
  };
  const options: LmsOptions = {
    store,
    records,
    endpoint: `${ORIGIN}/xapi/`,
    fetchEndpoint: `${ORIGIN}/fetch`,
    authority: AU_AUTHORITY,
    clock,
    newId: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    },
    ...changes,
  };
  const base: LrsOptions = {
    statements: lrs.statements,
    documents: lrs.documents,
    activities: lrs.activities,
    access: hostAccess,
    clock,
  };
  host.lrsOptions = extendLrsOptions(base, options);
  const course = importCourse(readCourseStructure(COURSE_XML, { packaged: true }), {
    courseId: "geology",
    idBase: `${ORIGIN}/activities/`,
    idNamespace: NAMESPACE,
    contentBase: "https://content.example.org/geology/",
  });
  store.courses.set(course.id, course);
  const xapi: TestHost["xapi"] = (method, path, init = {}) =>
    handle({
      method,
      url: `${ORIGIN}/xapi/${path}`,
      headers: {
        "x-experience-api-version": "1.0.3",
        ...(init.authorization === undefined ? {} : { authorization: init.authorization }),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body:
        init.body === undefined
          ? new Uint8Array()
          : init.body instanceof Uint8Array
            ? init.body
            : new TextEncoder().encode(typeof init.body === "string" ? init.body : JSON.stringify(init.body)),
    });
  return { store, lrs, clock, options, lrsOptions: host.lrsOptions, lrsBase: base, course, recordsFail, handle, xapi };
}
