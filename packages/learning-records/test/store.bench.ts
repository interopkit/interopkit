import type { HttpRequest } from "@interopkit/core/http";
import { readStatement, type Statement } from "@interopkit/learning-records";
import {
  handleLrsRequest,
  type LrsOptions,
  matchesStatementQuery,
  type StoredStatement,
} from "@interopkit/learning-records/store";
import { expect, test } from "vitest";
import { benchBatch, checkWithLearningLocker } from "./batch.js";
import { BENCH_OPTIONS, expectRatio, RATIOS } from "./budgets.js";

const NOW = "2026-01-15T10:30:00.000Z";
const AUTHORITY = { objectType: "Agent", account: { homePage: "https://lrs.example.org", name: "client-1" } } as const;

/** A request to the Statements resource of an LRS at `/xapi`, as a host's server gives it. */
function requestOf(method: string, query: string, body = ""): HttpRequest {
  return {
    method,
    url: `https://lrs.example.org/xapi/statements${query}`,
    headers: { "x-experience-api-version": "2.0.0", "content-type": "application/json", accept: "application/json" },
    body: new TextEncoder().encode(body),
  };
}

/**
 * The options of an LRS whose stores do nothing but answer: an insert stores nothing, and a query answers the page that it is
 * given, so that the time is the handler's.
 */
function optionsOf(page: readonly StoredStatement[]): LrsOptions {
  return {
    statements: {
      insert: async () => ({ existing: [] }),
      get: async () => undefined,
      query: async () => ({ statements: page }),
      consistentThrough: async () => NOW,
      attachments: async () => new Map(),
    },
    documents: {
      get: async () => undefined,
      write: async () => "written",
      delete: async () => "absent",
      list: async () => [],
      deleteAll: async () => undefined,
    },
    activities: { get: async () => undefined, observe: async () => undefined },
    access: async () => ({ allowed: true, authority: AUTHORITY, actions: ["statements.read", "statements.write"] }),
    clock: { now: () => Date.parse(NOW) },
  };
}

/** The batch as the LRS holds it: each Statement with what the LRS sets. */
function held(batch: readonly Statement[]): StoredStatement[] {
  return batch.map((statement) => ({
    statement: readStatement({ ...statement, stored: NOW, authority: AUTHORITY, version: "2.0.0" }),
    stored: NOW,
    voided: false,
    version: "2.0.0",
  }));
}

test("stores a batch of 1,000 Statements and answers a page of 100 within a few times of checking them", async ({
  annotate,
  bench,
}) => {
  const batch = benchBatch();
  const text = JSON.stringify(batch);
  const page = held(batch.slice(0, 100));
  const options = optionsOf(page);
  const posted = await handleLrsRequest(requestOf("POST", "", text), options);
  expect(posted.status).toBe(200);
  const answered = await handleLrsRequest(requestOf("GET", "?limit=100"), options);
  expect(answered.status).toBe(200);

  const reference = await bench("Learning Locker", () => checkWithLearningLocker(batch)).run(BENCH_OPTIONS);
  const post = await bench("handleLrsRequest POST", async () => {
    await handleLrsRequest(requestOf("POST", "", text), options);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "handleLrsRequest POST",
    post,
    { ...reference, name: "the validator of Learning Locker" },
    RATIOS.postAgainstLearningLocker,
  );

  const stringify = await bench("JSON.stringify", () =>
    JSON.stringify({ statements: page.map(({ statement }) => statement) }),
  ).run(BENCH_OPTIONS);
  const get = await bench("handleLrsRequest GET", async () => {
    await handleLrsRequest(requestOf("GET", "?limit=100"), options);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "handleLrsRequest GET",
    get,
    { ...stringify, name: "JSON.stringify of the page" },
    RATIOS.getAgainstStringify,
  );
});

test("matches 1,000 Statements against a query within a few times of checking them", async ({ annotate, bench }) => {
  const batch = benchBatch();
  const statements = held(batch).map(({ statement }) => statement);
  const query = {
    agent: { mbox: "mailto:learner7@example.org" },
    verb: "http://adlnet.gov/expapi/verbs/completed",
    activity: "https://example.org/programs/stats",
    relatedActivities: true,
    since: "2020-01-01T00:00:00Z",
  } as const;
  const none = () => undefined;
  expect(statements.filter((statement) => matchesStatementQuery(statement, query, none))).toHaveLength(1);
  const reference = await bench("Learning Locker", () => checkWithLearningLocker(batch)).run(BENCH_OPTIONS);
  const matched = await bench("matchesStatementQuery", () => {
    for (const statement of statements) matchesStatementQuery(statement, query, none);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "matchesStatementQuery",
    matched,
    { ...reference, name: "the validator of Learning Locker" },
    RATIOS.matchAgainstLearningLocker,
  );
});
