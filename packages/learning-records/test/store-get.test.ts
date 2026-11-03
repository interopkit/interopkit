import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { readMultipart, writeMultipart } from "../src/attachments/index.js";
import { type Statement, type StatementQuery, VERB_VOIDED } from "../src/index.js";
import { handleLrsRequest, type LrsOptions } from "../src/store/index.js";
import { minimalStatement, uuid } from "./full-statement.js";
import { statementOf } from "./lrs-client.js";
import { ALLOW_ALL, AUTHORITY, jsonOf, memory, NOW, optionsOf, reasonOf, requestOf, textOf } from "./memory-lrs.js";
import { dataOf, statementWithAttachments } from "./multipart.js";

const JSON_TYPE = { "content-type": "application/json" };
type Memory = ReturnType<typeof memory>;

/** Stores Statements through the handler, one request for each, so that each has the time of its request. */
async function fill(store: Memory, statements: readonly unknown[], changes: Partial<LrsOptions> = {}): Promise<void> {
  const response = await handleLrsRequest(
    requestOf("POST", "/statements", { headers: JSON_TYPE, body: JSON.stringify(statements) }),
    optionsOf(store, changes),
  );
  expect(response.status).toBe(200);
}

/** Asks the handler for the Statements resource. */
function get(
  store: Memory,
  query: Record<string, string> | string = {},
  headers: Record<string, string> = {},
  changes: Partial<LrsOptions> = {},
  method = "GET",
) {
  return handleLrsRequest(requestOf(method, "/statements", { query, headers }), optionsOf(store, changes));
}

const stored = (n: number): Statement => ({ ...statementOf(n), stored: NOW, authority: AUTHORITY, version: "2.0.0" });

describe("GET of one Statement", () => {
  it("answers 200 with the Statement, and the headers that the standard asks for", async () => {
    const store = memory();
    await fill(store, [statementOf(1)]);
    const response = await get(store, { statementId: uuid(1) });
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual(stored(1));
    expect(response.headers["content-type"]).toBe("application/json;charset=UTF-8");
    expect(response.headers["x-experience-api-consistent-through"]).toBe(NOW);
    expect(response.headers["last-modified"]).toBe("Thu, 15 Jan 2026 10:30:00 GMT");
  });

  it("finds the Statement by an id in any case", async () => {
    const store = memory();
    await fill(store, [statementOf(1)]);
    expect((await get(store, { statementId: uuid(1).toUpperCase() })).status).toBe(200);
  });

  it("answers 404 for a Statement it does not hold, and for a voided one unless it is asked by voidedStatementId", async () => {
    const store = memory();
    await fill(store, [
      statementOf(1),
      { ...statementOf(2), verb: { id: VERB_VOIDED }, object: { objectType: "StatementRef", id: uuid(1) } },
    ]);
    expect((await get(store, { statementId: uuid(9) })).status).toBe(404);
    const gone = await get(store, { statementId: uuid(1) });
    expect(gone.status).toBe(404);
    expect(reasonOf(gone)).toBe(`The LRS holds no Statement with the id ${uuid(1)}.`);
    expect(jsonOf(await get(store, { voidedStatementId: uuid(1) }))).toStrictEqual({ ...stored(1) });
    const live = await get(store, { voidedStatementId: uuid(2) });
    expect(live.status).toBe(404);
    expect(reasonOf(live)).toBe(`The LRS holds no voided Statement with the id ${uuid(2)}.`);
    expect(reasonOf(await get(store, { statementId: uuid(1), format: "ids" }))).toContain("no Statement");
  });

  it("answers 500 when the store rejects for the Statement or for the time it is consistent through", async () => {
    const store = memory();
    await fill(store, [statementOf(1)]);
    const noGet = { ...store.statements, get: () => Promise.reject(new Error("down")) };
    expect((await get(store, { statementId: uuid(1) }, {}, { statements: noGet })).status).toBe(500);
    const noTime = { ...store.statements, consistentThrough: () => Promise.reject(new Error("down")) };
    expect((await get(store, { statementId: uuid(1) }, {}, { statements: noTime })).status).toBe(500);
    expect((await get(store, {}, {}, { statements: noTime })).status).toBe(500);
  });

  it("answers 404 when the store answers with a Statement of the other kind", async () => {
    const store = memory();
    await fill(store, [statementOf(1)]);
    const lying = { ...store.statements, get: async () => store.held.get(uuid(1)) };
    expect((await get(store, { voidedStatementId: uuid(1) }, {}, { statements: lying })).status).toBe(404);
  });

  it.each([
    [{ statementId: uuid(1), voidedStatementId: uuid(1) }, "both statementId and voidedStatementId"],
    [{ statementId: uuid(1), verb: "http://adlnet.gov/expapi/verbs/completed" }, "cannot have the parameter verb"],
    [{ statementId: uuid(1), limit: "1" }, "cannot have the parameter limit"],
    [{ statementId: uuid(1), cursor: "1" }, "cannot have the parameter cursor"],
    [{ voidedStatementId: uuid(1), ascending: "true" }, "cannot have the parameter ascending"],
    [{ statementId: "x" }, "The Statement id must be a UUID"],
    [{ statementId: uuid(1), format: "full" }, "The query is invalid at format"],
    [{ statementId: uuid(1), attachments: "yes" }, "The parameter attachments must be true or false"],
  ])("refuses the parameters %j with 400", async (query, sentence) => {
    const store = memory();
    const response = await get(store, query);
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain(sentence);
    expect(store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
  });

  it("accepts attachments and format beside the id, which the standard allows", async () => {
    const store = memory();
    await fill(store, [statementOf(1)]);
    const response = await get(store, { statementId: uuid(1), attachments: "false", format: "exact" });
    expect(response.status).toBe(200);
  });

  it("answers HEAD with the headers of GET and no body", async () => {
    const store = memory();
    await fill(store, [statementOf(1)]);
    const head = await get(store, { statementId: uuid(1) }, {}, {}, "HEAD");
    const full = await get(store, { statementId: uuid(1) });
    expect([head.status, head.body, head.headers]).toStrictEqual([200, "", full.headers]);
  });
});

describe("the formats of the Statements that are returned", () => {
  const rich: Statement = {
    ...statementOf(1),
    actor: { name: "Example Learner", mbox: "mailto:learner@example.org" },
    verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: { "en-US": "completed" } },
    object: {
      id: "https://example.org/activities/course-1",
      definition: {
        name: { "en-US": "Course", "fr-FR": "Course in French" },
        description: { "en-US": "A course", "fr-FR": "A course in French" },
      },
    },
  };

  it("returns the identifiers alone for the format ids", async () => {
    const store = memory();
    await fill(store, [rich]);
    const answer = jsonOf(await get(store, { statementId: uuid(1), format: "ids" })) as Statement;
    expect(answer.actor).toStrictEqual({ mbox: "mailto:learner@example.org" });
    expect(answer.verb).toStrictEqual({ id: "http://adlnet.gov/expapi/verbs/completed" });
    expect(answer.object).toStrictEqual({ id: "https://example.org/activities/course-1" });
  });

  it("returns one language in each map for canonical, with the definitions of the store and the languages of Accept-Language", async () => {
    const store = memory();
    await fill(store, [rich]);
    store.definitions.set("https://example.org/activities/course-1", {
      id: "https://example.org/activities/course-1",
      definition: { name: { "en-US": "Canonical course", "fr-FR": "Canonical course in French" } },
    });
    const french = jsonOf(
      await get(
        store,
        { statementId: uuid(1), format: "canonical" },
        { "accept-language": "de;q=0.9, fr-FR;q=0.8, en;q=0.1" },
      ),
    ) as Statement;
    expect(french.object).toStrictEqual({
      id: "https://example.org/activities/course-1",
      definition: { name: { "fr-FR": "Canonical course in French" } },
    });
    const first = jsonOf(await get(store, { statementId: uuid(1), format: "canonical" })) as Statement;
    expect((first.object as { definition?: { name?: unknown } }).definition?.name).toStrictEqual({
      "en-US": "Canonical course",
    });
  });

  it("ignores the ranges of Accept-Language that are no language tags or weigh nothing", async () => {
    const store = memory();
    await fill(store, [rich]);
    const answer = jsonOf(
      await get(
        store,
        { statementId: uuid(1), format: "canonical" },
        { "accept-language": "x_y, en-US;q=0, fr-FR;q=abc, *;q=0.5" },
      ),
    ) as Statement;
    expect((answer.object as { definition?: { name?: unknown } }).definition?.name).toStrictEqual({
      "en-US": "Course",
    });
    const none = jsonOf(
      await get(store, { statementId: uuid(1), format: "ids" }, { "accept-language": ", ;q=0" }),
    ) as Statement;
    expect(none.actor).toStrictEqual({ mbox: "mailto:learner@example.org" });
  });

  it("answers 500 when the store of Activities rejects for the format canonical, for one Statement and for a page", async () => {
    const store = memory();
    await fill(store, [rich]);
    const failing = { ...store.activities, get: () => Promise.reject(new Error("down")) };
    const one = await get(store, { statementId: uuid(1), format: "canonical" }, {}, { activities: failing });
    expect(one.status).toBe(500);
    expect((await get(store, { format: "canonical" }, {}, { activities: failing })).status).toBe(500);
  });
});

describe("the Attachments of the Statements that are returned", () => {
  const data = dataOf("a certificate");
  const withData: Statement = { ...statementOf(1), attachments: statementWithAttachments([data]).attachments ?? [] };

  async function stored1(): Promise<Memory> {
    const store = memory();
    const message = writeMultipart(withData, [data]);
    const response = await handleLrsRequest(
      requestOf("POST", "/statements", { headers: { "content-type": message.contentType }, body: message.body }),
      optionsOf(store),
    );
    expect(response.status).toBe(200);
    return store;
  }

  it("answers a multipart message with the data of the Attachments for one Statement, when the request asks for them", async () => {
    const store = await stored1();
    const response = await get(store, { statementId: uuid(1), attachments: "true" });
    expect(response.headers["content-type"]).toMatch(/^multipart\/mixed; boundary=/u);
    expect(response.headers["x-experience-api-consistent-through"]).toBe(NOW);
    const read = readMultipart(response.headers["content-type"] ?? "", response.body as Uint8Array);
    expect(read.statements).toMatchObject({ id: uuid(1) });
    expect(read.parts.get(data.sha2)).toStrictEqual(data);
  });

  it("answers JSON without the data when attachments is false or absent", async () => {
    const store = await stored1();
    for (const query of [{ statementId: uuid(1) }, { statementId: uuid(1), attachments: "false" }] as Record<
      string,
      string
    >[]) {
      expect((await get(store, query)).headers["content-type"]).toBe("application/json;charset=UTF-8");
    }
  });

  it("answers a multipart message for a page, with each Attachment once, and no data for one that has a fileUrl", async () => {
    const store = await stored1();
    const [header] = withData.attachments ?? [];
    const sameData = { ...header, fileUrl: "https://example.org/certificate" };
    const elsewhere = { ...header, fileUrl: "https://example.org/linked", sha2: dataOf("linked").sha2, length: 6 };
    await fill(store, [
      { ...statementOf(2), attachments: [sameData] },
      { ...statementOf(3), attachments: [elsewhere] },
    ]);
    const response = await get(store, { attachments: "true" });
    const read = readMultipart(response.headers["content-type"] ?? "", response.body as Uint8Array);
    expect((read.statements as { statements: unknown[] }).statements).toHaveLength(3);
    expect([...read.parts.keys()]).toStrictEqual([data.sha2]);
  });

  it("throws a DataError when the store lacks the data of an Attachment that has no fileUrl", async () => {
    const store = await stored1();
    store.data.clear();
    await expect(get(store, { statementId: uuid(1), attachments: "true" })).rejects.toBeInstanceOf(DataError);
  });

  it("answers 500 when the store rejects for the data", async () => {
    const store = await stored1();
    const failing = { ...store.statements, attachments: () => Promise.reject(new Error("down")) };
    expect((await get(store, { statementId: uuid(1), attachments: "true" }, {}, { statements: failing })).status).toBe(
      500,
    );
  });
});

describe("GET of a page of Statements", () => {
  const five = [1, 2, 3, 4, 5].map(statementOf);

  /** Stores five Statements, each at the time of its own request. */
  async function filled(): Promise<Memory> {
    const store = memory();
    for (const [index, statement] of five.entries()) {
      const clock = { now: () => Date.parse(NOW) + (index + 1) * 1000 };
      await fill(store, [statement], { clock });
    }
    return store;
  }

  it("answers a result of the Statements, newest first, with the headers of the standard", async () => {
    const store = await filled();
    const response = await get(store);
    const result = jsonOf(response) as { statements: Statement[]; more?: string };
    expect(result.statements.map(({ id }) => id)).toStrictEqual([5, 4, 3, 2, 1].map(uuid));
    expect(result.more).toBeUndefined();
    expect(response.headers["last-modified"]).toBe("Thu, 15 Jan 2026 10:30:05 GMT");
    expect(response.headers["x-experience-api-consistent-through"]).toBe(NOW);
  });

  it("answers an empty list, without a Last-Modified, for a query that matches nothing", async () => {
    const store = await filled();
    const response = await get(store, { verb: "http://adlnet.gov/expapi/verbs/failed" });
    expect([response.status, jsonOf(response)]).toStrictEqual([200, { statements: [] }]);
    expect(response.headers).not.toHaveProperty("last-modified");
  });

  it("answers the oldest first for ascending", async () => {
    const store = await filled();
    const result = jsonOf(await get(store, { ascending: "true", limit: "2" })) as { statements: Statement[] };
    expect(result.statements.map(({ id }) => id)).toStrictEqual([uuid(1), uuid(2)]);
  });

  it("gives the store the filters as the query, and the size of the page", async () => {
    const store = await filled();
    const seen: [StatementQuery, { limit: number; cursor?: string }][] = [];
    const watching = {
      ...store.statements,
      query: async (...args: Parameters<typeof store.statements.query>) => {
        seen.push([args[0], args[1]]);
        return store.statements.query(...args);
      },
    };
    await get(
      store,
      {
        agent: '{"mbox":"mailto:learner@example.org"}',
        verb: "http://adlnet.gov/expapi/verbs/completed",
        activity: "https://example.org/activities/course-1",
        registration: uuid(7),
        related_activities: "true",
        related_agents: "false",
        since: "2026-01-01T00:00:00Z",
        until: "2026-02-01T00:00:00Z",
        limit: "3",
        format: "ids",
        attachments: "false",
        ascending: "true",
      },
      {},
      { statements: watching },
    );
    expect(seen).toStrictEqual([
      [
        {
          agent: { mbox: "mailto:learner@example.org" },
          verb: "http://adlnet.gov/expapi/verbs/completed",
          activity: "https://example.org/activities/course-1",
          registration: uuid(7),
          relatedActivities: true,
          relatedAgents: false,
          since: "2026-01-01T00:00:00Z",
          until: "2026-02-01T00:00:00Z",
          limit: 3,
          format: "ids",
          attachments: false,
          ascending: true,
        },
        { limit: 3 },
      ],
    ]);
  });

  it("takes limits.pageSize for no limit, and limits.maxPageSize for 0 and for more than it", async () => {
    const store = await filled();
    const limits = { pageSize: 2, maxPageSize: 4 };
    const count = async (query: Record<string, string>) =>
      (jsonOf(await get(store, query, {}, { limits })) as { statements: unknown[] }).statements.length;
    expect(await count({})).toBe(2);
    expect(await count({ limit: "0" })).toBe(4);
    expect(await count({ limit: "100" })).toBe(4);
    expect(await count({ limit: "3" })).toBe(3);
    expect(await count({ limit: "1" })).toBe(1);
  });

  it("takes the smaller of the two when pageSize is above maxPageSize", async () => {
    const store = await filled();
    const result = jsonOf(await get(store, {}, {}, { limits: { pageSize: 9, maxPageSize: 3 } })) as {
      statements: unknown[];
    };
    expect(result.statements).toHaveLength(3);
  });

  it("answers more as a relative address that repeats the parameters and adds the cursor, and the next page follows it", async () => {
    const store = await filled();
    const first = jsonOf(await get(store, { limit: "2", verb: "http://adlnet.gov/expapi/verbs/completed" })) as {
      statements: Statement[];
      more: string;
    };
    expect(first.more).toBe(
      `/xapi/statements?${new URLSearchParams({ limit: "2", verb: "http://adlnet.gov/expapi/verbs/completed", cursor: "2" })}`,
    );
    const pages = [first];
    while (pages.at(-1)?.more !== undefined) {
      const [path, query] = (pages.at(-1)?.more ?? "").split("?");
      expect(path).toBe("/xapi/statements");
      pages.push(jsonOf(await get(store, query ?? "")) as (typeof pages)[number]);
    }
    expect(pages.flatMap(({ statements }) => statements.map(({ id }) => id))).toStrictEqual([5, 4, 3, 2, 1].map(uuid));
    expect(pages.map(({ more }) => more === undefined)).toStrictEqual([false, false, true]);
  });

  it("writes more below the base path of the options", async () => {
    const store = await filled();
    const lrs = { limit: "2" };
    const response = await handleLrsRequest(
      { ...requestOf("GET", "/statements", { query: lrs }), url: "https://lrs.example.org/a/statements?limit=2" },
      optionsOf(store, { basePath: "/a" }),
    );
    expect((jsonOf(response) as { more: string }).more).toBe("/a/statements?limit=2&cursor=2");
  });

  it("answers 400 for a cursor that the store does not know", async () => {
    const store = await filled();
    const response = await get(store, { cursor: "expired" });
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toBe("The cursor of the request is not valid, or it has expired.");
  });

  it.each([
    [{ agent: "not json" }, "The text is not valid JSON"],
    [{ agent: '{"name":"No identifier"}' }, "The query is invalid at agent"],
    [
      { agent: '{"mbox":"mailto:a@example.org","mbox":"mailto:b@example.org"}' },
      'The text has the property "mbox" twice',
    ],
    [{ agent: '{"objectType":"Group","member":[]}' }, "The query is invalid at agent"],
    [{ verb: "completed" }, "The query is invalid at verb"],
    [{ activity: "course" }, "The query is invalid at activity"],
    [{ registration: "x" }, "The query is invalid at registration"],
    [{ since: "yesterday" }, "The query is invalid at since"],
    [{ until: "2026-01-01" }, "The query is invalid at until"],
    [{ limit: "-1" }, "The parameter limit must be a whole number of at least 0"],
    [{ limit: "1.5" }, "The parameter limit must be a whole number of at least 0"],
    [{ limit: "one" }, "The parameter limit must be a whole number of at least 0"],
    [{ format: "full" }, 'expected "ids", "exact" or "canonical"'],
    [{ ascending: "yes" }, 'The parameter ascending must be true or false, found "yes"'],
    [{ related_agents: "1" }, "The parameter related_agents must be true or false"],
    [{ related_activities: "TRUE" }, "The parameter related_activities must be true or false"],
    [{ Agent: "x" }, 'The parameter "Agent" is not a parameter of this resource: the names are case-sensitive.'],
    [{ RELATED_AGENTS: "true" }, 'The parameter "RELATED_AGENTS" is not a parameter'],
    [{ extra: "1" }, 'The parameter "extra" is not a parameter'],
    [{ relatedAgents: "true" }, 'The parameter "relatedAgents" is not a parameter'],
  ])("refuses the parameters %j with 400", async (query, sentence) => {
    const store = memory();
    const response = await get(store, query);
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain(sentence);
    expect(store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
  });

  it("refuses a parameter that occurs twice with 400", async () => {
    const response = await get(memory(), "verb=http://a.b/c&verb=http://a.b/d");
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain("more than once");
  });

  it("answers HEAD as it answers GET, without the body", async () => {
    const store = await filled();
    const head = await get(store, { limit: "2" }, {}, {}, "HEAD");
    const full = await get(store, { limit: "2" });
    expect([head.status, head.body, head.headers]).toStrictEqual([200, "", full.headers]);
  });

  it("throws a DataError when the store answers with more Statements than the limit, or with a voided Statement", async () => {
    const store = await filled();
    const tooMany = { ...store.statements, query: async () => ({ statements: [...store.held.values()] }) };
    await expect(get(store, { limit: "2" }, {}, { statements: tooMany })).rejects.toBeInstanceOf(DataError);
    await expect(get(store, { limit: "2" }, {}, { statements: tooMany })).rejects.toThrow(
      "at most 2 Statements and none that was voided",
    );
    const voided = {
      ...store.statements,
      query: async () => ({ statements: [{ ...(store.held.get(uuid(1)) as never as object), voided: true }] as never }),
    };
    await expect(get(store, {}, {}, { statements: voided })).rejects.toBeInstanceOf(DataError);
  });

  it("answers 500 when the store rejects", async () => {
    const store = await filled();
    const failing = { ...store.statements, query: () => Promise.reject(new Error("down")) };
    const response = await get(store, {}, {}, { statements: failing });
    expect(response.status).toBe(500);
    expect(textOf(response)).not.toContain("down");
  });
});

describe("the bounds of the JSON in a parameter", () => {
  const agent = JSON.stringify({ mbox: "mailto:learner@example.org" });
  const ACTIVITY = "https://example.org/activities/course-1";

  it.each([
    ["the agent of a query of Statements", "/statements", {}],
    ["the agent of the Agents resource", "/agents", {}],
    ["the agent of a State", "/activities/state", { activityId: ACTIVITY, stateId: "bookmark" }],
  ] as const)(
    "refuses %s of more tokens than limits.maxTokens, or deeper than limits.maxDepth",
    async (_name, path, rest) => {
      const store = memory();
      const ask = (text: string, limits: LrsOptions["limits"]) =>
        handleLrsRequest(requestOf("GET", path, { query: { ...rest, agent: text } }), optionsOf(store, { limits }));
      // The Agent has five tokens: the braces, the name, the colon and the value.
      expect((await ask(agent, { maxTokens: 5 })).status).not.toBe(400);
      const tokens = await ask(agent, { maxTokens: 4 });
      expect(tokens.status).toBe(413);
      expect(reasonOf(tokens)).toContain("The text has more than 4 tokens");
      const nested = await ask('{"mbox":"mailto:a@example.org","member":[{}]}', { maxDepth: 2 });
      expect(nested.status).toBe(400);
      expect(reasonOf(nested)).toContain("nests arrays and objects deeper than the limit of 2 levels");
    },
  );

  it("refuses an agent of more tokens than the default, a million, before it parses it", async () => {
    const wide = `{"mbox":"mailto:a@example.org","member":[${"0,".repeat(600_000)}0]}`;
    const response = await get(memory(), { agent: wide });
    expect(response.status).toBe(413);
    expect(reasonOf(response)).toContain("The text has more than 1000000 tokens");
    const agents = await handleLrsRequest(requestOf("GET", "/agents", { query: { agent: wide } }), optionsOf(memory()));
    expect(agents.status).toBe(413);
  });

  it("refuses an agent larger than limits.maxBodyBytes", async () => {
    const response = await get(memory(), { agent }, {}, { limits: { maxBodyBytes: 10 } });
    expect(response.status).toBe(413);
    expect(reasonOf(response)).toContain("The text has");
  });
});

describe("X-Experience-API-Consistent-Through", () => {
  const THROUGH = "x-experience-api-consistent-through";

  it.each([
    [
      "a GET that is refused for its parameters",
      "GET",
      { statementId: uuid(1), agent: '{"mbox":"mailto:a@b.org"}' },
      400,
    ],
    ["a GET of a Statement that is not there", "GET", { statementId: uuid(9) }, 404],
    ["a GET of a voided Statement by statementId", "GET", { statementId: uuid(1) }, 404],
    ["a HEAD of a query with an unknown parameter", "HEAD", { unknown: "1" }, 400],
  ])("is on the answer to %s", async (_name, method, query, status) => {
    const store = memory();
    await fill(store, [statementOf(1)]);
    await handleLrsRequest(
      requestOf("POST", "/statements", {
        headers: JSON_TYPE,
        body: JSON.stringify({ ...statementOf(2), id: uuid(2) }),
      }),
      optionsOf(store),
    );
    const first = store.held.get(uuid(1));
    if (first !== undefined) store.held.set(uuid(1), { ...first, voided: true });
    const response = await get(store, query, {}, {}, method);
    expect(response.status).toBe(status);
    expect(response.headers[THROUGH]).toBe(NOW);
  });

  it("is on the refusal of a PUT or POST for its body", async () => {
    const store = memory();
    const refused = await handleLrsRequest(
      requestOf("POST", "/statements", { headers: JSON_TYPE, body: "not json" }),
      optionsOf(store),
    );
    expect(refused.status).toBe(400);
    expect(refused.headers[THROUGH]).toBe(NOW);
  });

  it("is not made up for an answer that the store cannot give the time for, and is not asked of a refusal before the resource", async () => {
    const store = memory();
    const failing = { ...store.statements, consistentThrough: () => Promise.reject(new Error("down")) };
    const response = await get(store, { unknown: "1" }, {}, { statements: failing });
    expect(response.status).toBe(400);
    expect(response.headers[THROUGH]).toBeUndefined();
    const denied = await get(
      store,
      {},
      {},
      { access: async () => ({ allowed: false, status: 401, reason: "Sign in." }) },
    );
    expect(denied.status).toBe(401);
    expect(denied.headers[THROUGH]).toBeUndefined();
  });
});

describe("a credential that reads its own Statements (statements/read/mine of 1.0.3)", () => {
  const OTHER = { account: { homePage: "https://lrs.example.org", name: "client-2" } };
  const MINE = { ...ALLOW_ALL, actions: ["statements.read.mine", "statements.write"] } as const;

  /** A store with a Statement of the authority of the tests and one of another client. */
  async function twoClients() {
    const store = memory();
    const write = (n: number, authority: unknown) =>
      handleLrsRequest(
        requestOf("POST", "/statements", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(minimalOf(n)),
        }),
        optionsOf(store, { access: async () => ({ ...ALLOW_ALL, authority }) as never }),
      );
    await write(1, AUTHORITY);
    await write(2, OTHER);
    return store;
  }
  const minimalOf = (n: number) => ({ ...minimalStatement(), id: uuid(n) });

  it("finds its own Statements in a query, and not those of another credential", async () => {
    const store = await twoClients();
    const response = await handleLrsRequest(
      requestOf("GET", "/statements"),
      optionsOf(store, { access: async () => MINE }),
    );
    expect(response.status).toBe(200);
    expect((jsonOf(response) as { statements: { id: string }[] }).statements.map(({ id }) => id)).toStrictEqual([
      uuid(1),
    ]);
  });

  it("finds its own Statement by id, and answers 404 for one of another credential", async () => {
    const store = await twoClients();
    const ask = (n: number) =>
      handleLrsRequest(
        requestOf("GET", "/statements", { query: { statementId: uuid(n) } }),
        optionsOf(store, { access: async () => MINE }),
      );
    expect((await ask(1)).status).toBe(200);
    expect((await ask(2)).status).toBe(404);
  });

  it("throws a DataError when the store answers the query with a Statement of another authority", async () => {
    const store = await twoClients();
    const leaky = { ...store.statements, query: async () => ({ statements: [...store.held.values()] }) };
    await expect(
      handleLrsRequest(
        requestOf("GET", "/statements"),
        optionsOf(store, { statements: leaky, access: async () => MINE }),
      ),
    ).rejects.toThrow(
      "The answer of StatementStore.query must hold only the Statements of page.authority, and it holds one of another authority.",
    );
    const all = await handleLrsRequest(requestOf("GET", "/statements"), optionsOf(store, { statements: leaky }));
    expect((jsonOf(all) as { statements: unknown[] }).statements).toHaveLength(2);
  });

  it("reads any Statement with statements.read, and none without a read action", async () => {
    const store = await twoClients();
    const any = await handleLrsRequest(requestOf("GET", "/statements"), optionsOf(store));
    expect((jsonOf(any) as { statements: unknown[] }).statements).toHaveLength(2);
    const none = { ...ALLOW_ALL, actions: ["statements.write"] } as const;
    const refused = await handleLrsRequest(
      requestOf("GET", "/statements"),
      optionsOf(store, { access: async () => none }),
    );
    expect(refused.status).toBe(403);
  });
});
