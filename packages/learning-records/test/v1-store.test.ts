import { DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { describe, expect, it } from "vitest";
import { readMultipart, writeMultipart } from "../src/attachments/index.js";
import type { Statement } from "../src/index.js";
import { handleLrsRequest, type LrsOptions, type StoredStatement } from "../src/store/index.js";
import { minimalStatement, providerStatementV1, subStatementStatement, uuid } from "./full-statement.js";
import { jsonOf, type Memory, memory, NOW, optionsOf, reasonOf, requestOf } from "./memory-lrs.js";
import { sha2Of } from "./multipart.js";

const V1 = { "x-experience-api-version": "1.0.3" };
const JSON_BODY = { "content-type": "application/json" };
const ACTIVITY = "https://example.org/activities/course-1";
const AGENT = JSON.stringify({ mbox: "mailto:learner@example.org" });
const STATE: Record<string, string> = { activityId: ACTIVITY, agent: AGENT, stateId: "bookmark" };
const AGENT_PROFILE: Record<string, string> = { agent: AGENT, profileId: "preferences" };
const ACTIVITY_PROFILE: Record<string, string> = { activityId: ACTIVITY, profileId: "notes" };
const PROCTOR = { objectType: "contextAgent", agent: { openid: "https://openid.example.org/people/proctor" } } as const;

interface Init {
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** Calls the handler on the route of 1.0.3. */
function onV1(
  store: Memory,
  method: string,
  path: string,
  init: Init = {},
  changes: Partial<LrsOptions> = {},
): Promise<HttpResponse> {
  return handleLrsRequest(
    requestOf(method, path, { ...init, headers: { ...V1, ...init.headers } }),
    optionsOf(store, changes),
  );
}

/** Calls the handler on the route of 2.0. */
function onV2(store: Memory, method: string, path: string, init: Init = {}): Promise<HttpResponse> {
  return handleLrsRequest(requestOf(method, path, init), optionsOf(store));
}

/** Posts a Statement to a route. */
function post(store: Memory, statement: unknown, route: typeof onV1 = onV1): Promise<HttpResponse> {
  return route(store, "POST", "/statements", { headers: JSON_BODY, body: JSON.stringify(statement) });
}

/** A whole Statement of 1.0.3 without its Attachments, whose data no request of these tests carries. */
function statementOfV1(): Statement {
  const { attachments: _attachments, ...statement } = providerStatementV1();
  return statement;
}

/** The one Statement that a memory holds. */
function onlyHeld(store: Memory): StoredStatement {
  const [entry] = store.held.values();
  if (entry === undefined) throw new Error("The memory holds no Statement.");
  return entry;
}

/** A Statement of 2.0 with what 1.0.3 does not have, in its context and in that of its SubStatement. */
function statementOfV2(): Statement {
  const { object, ...statement } = subStatementStatement();
  if (object.objectType !== "SubStatement") throw new Error("The fixture has a SubStatement.");
  return {
    ...statement,
    object: { ...object, context: { ...object.context, contextAgents: [PROCTOR] } },
    context: { language: "en", contextAgents: [PROCTOR] },
  };
}

describe("the Statements of the route of 1.0.3", () => {
  it("gives a Statement that brings no version 1.0.0, and keeps in the store the route that stored it", async () => {
    const store = memory();
    expect((await post(store, minimalStatement())).status).toBe(200);
    const held = onlyHeld(store);
    expect(held.statement.version).toBe("1.0.0");
    expect(held.version).toBe("1.0.3");
  });

  it("gives a Statement that brings no version 2.0.0 on the route of 2.0, and keeps that route in the store", async () => {
    const store = memory();
    await post(store, minimalStatement(), onV2);
    expect(onlyHeld(store).statement.version).toBe("2.0.0");
    expect(onlyHeld(store).version).toBe("2.0.0");
  });

  it.each(["1.0", "1.0.0", "1.0.3", "1.0.9"])("keeps the version %s that a Statement brings", async (version) => {
    const store = memory();
    const id = uuid(10);
    expect((await post(store, { ...minimalStatement(), id, version })).status).toBe(200);
    const answer = await onV1(store, "GET", "/statements", { query: { statementId: id } });
    expect(jsonOf(answer)).toMatchObject({ version });
  });

  it.each(["2.0.0", "2.0", "0.9.9", "1.1.0", "abc"])(
    "refuses a Statement of the version %s and stores nothing",
    async (version) => {
      const store = memory();
      const response = await post(store, { ...minimalStatement(), version });
      expect(response.status).toBe(400);
      expect(reasonOf(response)).toContain("version");
      expect(store.held.size).toBe(0);
    },
  );

  it("refuses contextAgents and contextGroups, which 1.0.3 does not have, and takes them on the route of 2.0", async () => {
    const statement = { ...minimalStatement(), context: { contextAgents: [PROCTOR] } };
    const store = memory();
    expect((await post(store, statement)).status).toBe(400);
    expect((await post(store, statement, onV2)).status).toBe(200);
  });

  it("writes a timestamp of ISO 8601 in UTC, a SubStatement's too", async () => {
    const store = memory();
    const statement = {
      ...subStatementStatement(),
      timestamp: "20240613T204603+0200",
      object: { ...subStatementStatement().object, timestamp: "2024-06-13T20+02" },
    };
    expect((await post(store, statement)).status).toBe(200);
    const held = onlyHeld(store).statement;
    expect(held.timestamp).toBe("2024-06-13T18:46:03.000Z");
    expect(held.object).toMatchObject({ timestamp: "2024-06-13T18:00:00.000Z" });
  });

  it.each(["2024-06-13T18:46:03", "2024-06-13", "2024-06-13T18:46:03-00:00", "2024-06-13 18:46:03Z"])(
    "refuses the timestamp %s with its path",
    async (timestamp) => {
      const store = memory();
      const response = await post(store, { ...minimalStatement(), timestamp });
      expect(response.status).toBe(400);
      expect(reasonOf(response)).toContain("[0].timestamp");
    },
  );

  it("sets the stored and the timestamp in UTC when the Statement has neither", async () => {
    const store = memory();
    await post(store, minimalStatement());
    expect(onlyHeld(store).statement).toMatchObject({ stored: NOW, timestamp: NOW });
  });

  it("answers every request of the resource with the version of the route", async () => {
    const store = memory();
    for (const response of [
      await post(store, minimalStatement()),
      await onV1(store, "GET", "/statements"),
      await onV1(store, "HEAD", "/statements"),
      await onV1(store, "PUT", "/statements", { query: { statementId: "x" } }),
    ]) {
      expect(response.headers["x-experience-api-version"]).toBe("1.0.3");
    }
  });
});

describe("a Statement of 2.0 on the route of 1.0.3", () => {
  it("is answered by its id in the form of 1.0.3, and as it is on the route of 2.0", async () => {
    const store = memory();
    const statement = statementOfV2();
    await post(store, statement, onV2);
    const query = { statementId: statement.id ?? "" };
    const form = jsonOf(await onV1(store, "GET", "/statements", { query }));
    expect(form).toMatchObject({ version: "1.0.0", context: { language: "en" } });
    expect(form).not.toHaveProperty("context.contextAgents");
    expect(form).not.toHaveProperty("object.context.contextAgents");
    expect(form).toMatchObject({ object: { context: { contextActivities: expect.anything() } } });
    expect(jsonOf(await onV2(store, "GET", "/statements", { query }))).toMatchObject({
      version: "2.0.0",
      context: { contextAgents: [PROCTOR] },
      object: { context: { contextAgents: [PROCTOR] } },
    });
  });

  it("is answered in a query, in every format, in the form of 1.0.3", async () => {
    const store = memory();
    await post(store, statementOfV2(), onV2);
    for (const format of ["exact", "ids", "canonical"]) {
      const page = jsonOf(await onV1(store, "GET", "/statements", { query: { format } }));
      expect(page).toMatchObject({ statements: [{ version: "1.0.0" }] });
      expect(JSON.stringify(page)).not.toContain("contextAgents");
    }
  });

  it("is answered with its Attachments in the form of 1.0.3", async () => {
    const store = memory();
    const body = new TextEncoder().encode("certificate");
    const attachment = {
      usageType: "https://example.org/attachments/certificate",
      display: { "en-US": "Certificate" },
      contentType: "text/plain",
      length: body.byteLength,
      sha2: sha2Of(body),
    };
    const statement = { ...statementOfV2(), attachments: [attachment] };
    const message = writeMultipart(statement, [{ sha2: attachment.sha2, contentType: "text/plain", body }]);
    const sent = await handleLrsRequest(
      requestOf("PUT", "/statements", {
        query: { statementId: statement.id ?? "" },
        headers: { "content-type": message.contentType },
        body: message.body,
      }),
      optionsOf(store),
    );
    expect(sent.status).toBe(204);
    const answer = await onV1(store, "GET", "/statements", {
      query: { statementId: statement.id ?? "", attachments: "true" },
    });
    const read = readMultipart(answer.headers["content-type"] ?? "", answer.body as Uint8Array);
    expect(read.statements).toMatchObject({ version: "1.0.0", attachments: [{ sha2: attachment.sha2 }] });
    expect(JSON.stringify(read.statements)).not.toContain("contextAgents");
  });

  it("is a resend on the route of 1.0.3 when the Statement sent is its form of 1.0.3, and nothing changes", async () => {
    const store = memory();
    const statement = statementOfV2();
    await post(store, statement, onV2);
    const before = onlyHeld(store);
    const { context: _context, object, ...rest } = statement;
    if (object.objectType !== "SubStatement") throw new Error("The fixture has a SubStatement.");
    const { context: inner, ...sub } = object;
    const { contextAgents: _agents, ...kept } = inner ?? {};
    const form = { ...rest, object: { ...sub, context: kept }, context: { language: "en" } };
    const response = await onV1(store, "PUT", "/statements", {
      query: { statementId: statement.id ?? "" },
      headers: JSON_BODY,
      body: JSON.stringify(form),
    });
    expect(response.status).toBe(204);
    expect(onlyHeld(store)).toStrictEqual(before);
  });

  it("is a conflict on the route of 2.0 when the Statement sent is its form of 1.0.3", async () => {
    const store = memory();
    const statement = statementOfV2();
    await post(store, statement, onV2);
    const { context: _context, ...rest } = statement;
    const response = await post(store, { ...rest, context: { language: "en" } }, onV2);
    expect(response.status).toBe(409);
  });

  it("is a conflict on the route of 1.0.3 when the Statement sent differs from that form", async () => {
    const store = memory();
    const statement = statementOfV2();
    await post(store, statement, onV2);
    const { object: _object, context: _context, ...rest } = statement;
    const response = await post(store, { ...rest, object: { id: ACTIVITY } });
    expect(response.status).toBe(409);
  });
});

describe("a Statement of 1.0.3 on the route of 2.0", () => {
  it("is answered with the version it was stored with", async () => {
    const store = memory();
    const statement = statementOfV1();
    await post(store, statement);
    const answer = jsonOf(await onV2(store, "GET", "/statements", { query: { statementId: statement.id ?? "" } }));
    expect(answer).toMatchObject({ version: "1.0.0" });
  });

  it("is a resend on the route of 2.0 when the same Statement is sent", async () => {
    const store = memory();
    const statement = statementOfV1();
    await post(store, statement);
    expect((await post(store, statement, onV2)).status).toBe(204);
    expect(store.held.size).toBe(1);
  });
});

describe("a Statement that an LRS answers on both routes", () => {
  it("is the same Statement after a read on one route and a resend on the other", async () => {
    const store = memory();
    const statement = statementOfV1();
    await post(store, statement);
    expect(store.held.size).toBe(1);
    const read = jsonOf(await onV1(store, "GET", "/statements", { query: { statementId: statement.id ?? "" } }));
    expect((await post(store, read, onV2)).status).toBe(204);
    expect((await post(store, read)).status).toBe(204);
    expect(store.held.size).toBe(1);
  });
});

/** Puts a document with a precondition that lets it through, and says what the handler answered. */
function create(store: Memory, path: string, query: Record<string, string>, body: string): Promise<HttpResponse> {
  return onV1(store, "PUT", path, { query, headers: { ...JSON_BODY, "if-none-match": "*" }, body });
}

/** The body of the one document of a memory, as text. */
function onlyBody(store: Memory): string {
  const [held] = store.documents.values();
  if (held === undefined) throw new Error("The memory holds no document.");
  return new TextDecoder().decode(held.document.body);
}

describe("the State of the route of 1.0.3", () => {
  it("replaces a document with a PUT that has no precondition", async () => {
    const store = memory();
    await create(store, "/activities/state", STATE, '{"a":1}');
    const response = await onV1(store, "PUT", "/activities/state", {
      query: STATE,
      headers: JSON_BODY,
      body: '{"b":2}',
    });
    expect(response.status).toBe(204);
    expect(onlyBody(store)).toBe('{"b":2}');
  });

  it("makes a document with a PUT that has no precondition", async () => {
    const store = memory();
    const response = await onV1(store, "PUT", "/activities/state", { query: STATE, headers: JSON_BODY, body: "{}" });
    expect(response.status).toBe(204);
    expect(store.documents.size).toBe(1);
  });

  it("sends an unconditional write to the store for such a PUT, and an unconditional write repeated changes nothing else", async () => {
    const store = memory();
    const conditions: unknown[] = [];
    const documents = {
      ...store.documentStore,
      write: (...args: Parameters<typeof store.documentStore.write>) => {
        conditions.push(args[2]);
        return store.documentStore.write(...args);
      },
    };
    const init = { query: STATE, headers: JSON_BODY, body: '{"a":1}' };
    expect((await onV1(store, "PUT", "/activities/state", init, { documents })).status).toBe(204);
    expect((await onV1(store, "PUT", "/activities/state", init, { documents })).status).toBe(204);
    expect(conditions).toStrictEqual([{ unconditional: true }, { unconditional: true }]);
    expect(store.documents.size).toBe(1);
  });

  it("answers 500 and writes nothing when the store fails an unconditional write", async () => {
    const store = memory();
    const documents = {
      ...store.documentStore,
      write: () => Promise.reject(new Error("The disk is full.")),
    };
    const response = await onV1(
      store,
      "PUT",
      "/activities/state",
      { query: STATE, headers: JSON_BODY, body: "{}" },
      { documents },
    );
    expect(response.status).toBe(500);
    expect(store.documents.size).toBe(0);
  });

  it("throws a DataError for a store that does not write an unconditional write", async () => {
    const store = memory();
    const documents = { ...store.documentStore, write: async () => "exists" as const };
    await expect(
      onV1(store, "PUT", "/activities/state", { query: STATE, headers: JSON_BODY, body: "{}" }, { documents }),
    ).rejects.toThrow(
      new DataError('The answer of DocumentStore.write must be "written" for an unconditional write, found "exists".'),
    );
  });

  it("still judges the preconditions that a PUT brings", async () => {
    const store = memory();
    await create(store, "/activities/state", STATE, "{}");
    const stale = await onV1(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { ...JSON_BODY, "if-match": '"stale"' },
      body: '{"b":2}',
    });
    expect(stale.status).toBe(412);
    expect((await create(store, "/activities/state", STATE, '{"b":2}')).status).toBe(412);
    expect(onlyBody(store)).toBe("{}");
  });

  it("merges a POST and removes a document with a DELETE that have no precondition", async () => {
    const store = memory();
    await create(store, "/activities/state", STATE, '{"a":1}');
    const merged = await onV1(store, "POST", "/activities/state", {
      query: STATE,
      headers: JSON_BODY,
      body: '{"b":2}',
    });
    expect(merged.status).toBe(204);
    expect(JSON.parse(onlyBody(store))).toStrictEqual({ a: 1, b: 2 });
    expect((await onV1(store, "DELETE", "/activities/state", { query: STATE })).status).toBe(204);
    expect(store.documents.size).toBe(0);
  });

  it("is refused a PUT with no precondition over a document on the route of 2.0", async () => {
    const store = memory();
    await create(store, "/activities/state", STATE, "{}");
    const response = await onV2(store, "PUT", "/activities/state", { query: STATE, headers: JSON_BODY, body: "{}" });
    expect(response.status).toBe(409);
  });
});

describe.each([
  ["the Agent Profile", "/agents/profile", AGENT_PROFILE],
  ["the Activity Profile", "/activities/profile", ACTIVITY_PROFILE],
])("%s of the route of 1.0.3", (_name, path, query) => {
  it("refuses a PUT with no precondition with 400 where no document exists, and writes nothing", async () => {
    const store = memory();
    const response = await onV1(store, "PUT", path, { query, headers: JSON_BODY, body: "{}" });
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain("needs a precondition");
    expect(store.documents.size).toBe(0);
  });

  it("refuses a PUT with no precondition with 409 over a document, and leaves it", async () => {
    const store = memory();
    await create(store, path, query, '{"a":1}');
    const response = await onV1(store, "PUT", path, { query, headers: JSON_BODY, body: "{}" });
    expect(response.status).toBe(409);
    expect(reasonOf(response)).toContain("If-Match");
    expect(onlyBody(store)).toBe('{"a":1}');
  });

  it("takes a PUT with a precondition", async () => {
    const store = memory();
    const made = await create(store, path, query, '{"a":1}');
    const etag = made.headers.etag ?? "";
    const changed = await onV1(store, "PUT", path, { query, headers: { ...JSON_BODY, "if-match": etag }, body: "{}" });
    expect(changed.status).toBe(204);
  });

  it("merges a POST and removes a document with a DELETE that have no precondition", async () => {
    const store = memory();
    expect((await onV1(store, "POST", path, { query, headers: JSON_BODY, body: '{"a":1}' })).status).toBe(204);
    expect((await onV1(store, "POST", path, { query, headers: JSON_BODY, body: '{"b":2}' })).status).toBe(204);
    expect(JSON.parse(onlyBody(store))).toStrictEqual({ a: 1, b: 2 });
    expect((await onV1(store, "DELETE", path, { query })).status).toBe(204);
    expect(store.documents.size).toBe(0);
  });

  it("makes a document with a PUT that has no precondition on the route of 2.0", async () => {
    const store = memory();
    const response = await onV2(store, "PUT", path, { query, headers: JSON_BODY, body: "{}" });
    expect(response.status).toBe(204);
  });
});

describe("the times of the parameters of the route of 1.0.3", () => {
  it.each(["20240613T184604Z", "2024-06-13T20:46:04+02", "2024-06-13T18:46:04.000Z"])(
    "takes the time %s in since and until, in Statements",
    async (time) => {
      const store = memory();
      const statements = await onV1(store, "GET", "/statements", { query: { since: time, until: time } });
      expect(statements.status).toBe(200);
    },
  );

  it("compares the time of a parameter in UTC", async () => {
    const store = memory();
    await post(store, minimalStatement());
    const before = await onV1(store, "GET", "/statements", { query: { since: "20260115T113000+0200" } });
    expect(jsonOf(before)).toMatchObject({ statements: [{ stored: NOW }] });
    const after = await onV1(store, "GET", "/statements", { query: { since: "20260115T123000+0200" } });
    expect(jsonOf(after)).toStrictEqual({ statements: [] });
  });

  it("takes the time in since, for the ids of documents", async () => {
    const store = memory();
    await create(store, "/activities/state", STATE, "{}");
    const { stateId: _stateId, ...context } = STATE;
    const ids = await onV1(store, "GET", "/activities/state", { query: { ...context, since: "20200101T000000Z" } });
    expect(jsonOf(ids)).toStrictEqual(["bookmark"]);
  });

  it.each(["2024-06-13T18:46:04", "2024-06-13", "2024-06-13T18:46:04-00:00", "yesterday"])(
    "refuses the time %s, which a Statement of 1.0.3 could not have",
    async (since) => {
      const store = memory();
      const statements = await onV1(store, "GET", "/statements", { query: { since } });
      expect(statements.status).toBe(400);
      expect(reasonOf(statements)).toContain("The parameter since must be an ISO 8601 date and time with a time zone");
      const { stateId: _stateId, ...context } = STATE;
      expect((await onV1(store, "GET", "/activities/state", { query: { ...context, since } })).status).toBe(400);
    },
  );

  it("keeps the parameters of a query in the address of the next page", async () => {
    const store = memory();
    for (const n of [1, 2]) await post(store, { ...minimalStatement(), id: uuid(n) });
    const first = await onV1(store, "GET", "/statements", { query: { limit: "1", since: "20200101T000000Z" } });
    expect(jsonOf(first)).toMatchObject({ more: expect.stringContaining("since=20200101T000000Z") });
  });
});

describe("the ETag of the route of 1.0.3", () => {
  it("is the SHA-1 of the content as lower-case hex in quotes, in the answer of a GET and of a write", async () => {
    const store = memory();
    const written = await create(store, "/activities/state", STATE, "hello");
    const tag = '"aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"';
    expect(written.headers.etag).toBe(tag);
    const read = await onV1(store, "GET", "/activities/state", { query: STATE });
    expect(read.headers.etag).toBe(tag);
  });
});

describe("the versions of the options", () => {
  it("serves 1.0.3 alone, and names it in every answer", async () => {
    const store = memory();
    const options = optionsOf(store, { versions: ["1.0.3"] });
    const about = await handleLrsRequest(requestOf("GET", "/about"), options);
    expect(jsonOf(about)).toStrictEqual({ version: ["1.0.3"] });
    expect(about.headers["x-experience-api-version"]).toBe("1.0.3");
    const refused = await handleLrsRequest(requestOf("GET", "/statements"), options);
    expect(refused.status).toBe(400);
    expect(refused.headers["x-experience-api-version"]).toBe("1.0.3");
  });
});
