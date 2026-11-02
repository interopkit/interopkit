import { DataError } from "@interopkit/core";
import { describe, expect, it, vi } from "vitest";
import { writeMultipart } from "../src/attachments/index.js";
import { type Statement, VERB_VOIDED } from "../src/index.js";
import { handleLrsRequest, type LrsOptions } from "../src/store/index.js";
import { uuid } from "./full-statement.js";
import { statementOf } from "./lrs-client.js";
import { AUTHORITY, jsonOf, memory, NOW, optionsOf, reasonOf, requestOf } from "./memory-lrs.js";
import { dataOf, messageOf, statementWithAttachments } from "./multipart.js";

const JSON_TYPE = { "content-type": "application/json" };

/** Sends a PUT or a POST with a JSON body to a fresh or a given memory. */
async function send(
  method: "PUT" | "POST",
  body: unknown,
  {
    store = memory(),
    query = {},
    changes = {},
  }: { store?: ReturnType<typeof memory>; query?: Record<string, string>; changes?: Partial<LrsOptions> } = {},
) {
  const response = await handleLrsRequest(
    requestOf(method, "/statements", {
      query,
      headers: JSON_TYPE,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    optionsOf(store, changes),
  );
  return { response, store };
}

const put = (statement: unknown, id: string, rest = {}) =>
  send("PUT", statement, { ...rest, query: { statementId: id } });

describe("PUT of a Statement", () => {
  it("stores it with what the LRS sets, and answers 204 with the time it is consistent through", async () => {
    const { response, store } = await put(statementOf(1), uuid(1));
    expect(response.status).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["x-experience-api-consistent-through"]).toBe(NOW);
    expect(store.held.get(uuid(1))).toStrictEqual({
      statement: { ...statementOf(1), stored: NOW, authority: AUTHORITY, version: "2.0.0" },
      stored: NOW,
      voided: false,
      version: "2.0.0",
    });
  });

  it("sets the id from statementId when the Statement has none, and the timestamp from the stored time", async () => {
    const { id: _id, timestamp: _timestamp, ...bare } = statementOf(1);
    const { response, store } = await put(bare, uuid(5));
    expect(response.status).toBe(204);
    expect(store.held.get(uuid(5))?.statement).toMatchObject({ id: uuid(5), timestamp: NOW });
  });

  it("stores the id in lower case, whatever case the request writes it in", async () => {
    const shouting = uuid(1).toUpperCase();
    const { response, store } = await put({ ...statementOf(1), id: shouting }, shouting);
    expect(response.status).toBe(204);
    expect([...store.held.keys()]).toStrictEqual([uuid(1)]);
  });

  it("overwrites stored and authority, and keeps the version and the timestamp it brings", async () => {
    const brought = {
      ...statementOf(1),
      stored: "2000-01-01T00:00:00.000Z",
      authority: { mbox: "mailto:forger@example.org" },
      version: "1.0.0",
      timestamp: "2025-05-05T05:05:05.000Z",
    };
    const { store } = await put(brought, uuid(1));
    expect(store.held.get(uuid(1))?.statement).toMatchObject({
      stored: NOW,
      authority: AUTHORITY,
      version: "1.0.0",
      timestamp: "2025-05-05T05:05:05.000Z",
    });
  });

  it("keeps the authority it brings only when the options say so", async () => {
    const brought = { ...statementOf(1), authority: { mbox: "mailto:trusted@example.org" } };
    const { store } = await put(brought, uuid(1), { changes: { keepSubmittedAuthority: true } });
    expect(store.held.get(uuid(1))?.statement.authority).toStrictEqual({ mbox: "mailto:trusted@example.org" });
    const without = await put({ ...statementOf(2) }, uuid(2), { changes: { keepSubmittedAuthority: true } });
    expect(without.store.held.get(uuid(2))?.statement.authority).toStrictEqual(AUTHORITY);
  });

  it("answers 204 for a resend of the same Statement, and 409 for another Statement with the id", async () => {
    const store = memory();
    await put(statementOf(1), uuid(1), { store });
    const again = await put({ ...statementOf(1), timestamp: "2030-01-01T00:00:00.000Z" }, uuid(1), { store });
    expect(again.response.status).toBe(204);
    const other = await put({ ...statementOf(1), verb: { id: "http://adlnet.gov/expapi/verbs/failed" } }, uuid(1), {
      store,
    });
    expect(other.response.status).toBe(409);
    expect(jsonOf(other.response)).toStrictEqual({
      message: `The LRS holds another Statement with the id ${uuid(1)}, and a Statement is not changed.`,
    });
    expect(store.held.get(uuid(1))?.statement.verb.id).toBe("http://adlnet.gov/expapi/verbs/completed");
  });

  it.each([
    [{}, "needs the parameter statementId"],
    [{ statementId: "x" }, "The Statement id must be a UUID"],
    [{ statementId: uuid(1), extra: "1" }, 'The parameter "extra" is not a parameter of this resource'],
    [{ statementId: uuid(1), StatementId: uuid(1) }, 'The parameter "StatementId" is not a parameter'],
  ])("refuses the parameters %j with 400", async (query, sentence) => {
    const { response, store } = await send("PUT", statementOf(1), { query });
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain(sentence);
    expect(store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
  });

  it("refuses a parameter that occurs twice with 400", async () => {
    const store = memory();
    const response = await handleLrsRequest(
      requestOf("PUT", "/statements", {
        query: `statementId=${uuid(1)}&statementId=${uuid(1)}`,
        headers: JSON_TYPE,
        body: JSON.stringify(statementOf(1)),
      }),
      optionsOf(store),
    );
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain("more than once");
  });

  it("refuses with 400 an id in the Statement that is not the statementId, a list, and a Statement with an error", async () => {
    const mismatch = await put(statementOf(1), uuid(2));
    expect(mismatch.response.status).toBe(400);
    expect(reasonOf(mismatch.response)).toContain(
      `The id of the Statement, ${uuid(1)}, is not the statementId of the request, ${uuid(2)}.`,
    );
    const list = await put([statementOf(1)], uuid(1));
    expect(reasonOf(list.response)).toContain("A PUT stores one Statement, and the body is a list.");
    const invalid = await put({ ...statementOf(1), actor: { name: "No identifier" } }, uuid(1));
    expect(invalid.response.status).toBe(400);
    expect(reasonOf(invalid.response)).toContain("The batch of Statements is invalid at [0].actor");
    expect([mismatch, list, invalid].flatMap(({ store }) => store.calls)).toStrictEqual(
      Array.from({ length: 3 }, () => "consistentThrough"),
    );
  });
});

describe("the body of a request that stores Statements", () => {
  it.each([
    ["not json", "The text is not valid JSON"],
    [`{"id":"${uuid(1)}","id":"${uuid(1)}"}`, 'The text has the property "id" twice'],
    ["", "The text is not valid JSON"],
    ["5", "The batch of Statements is invalid at [0]"],
    ["null", "The batch of Statements is invalid at [0]"],
    ['"x"', "The batch of Statements is invalid at [0]"],
  ])("refuses the text %j with 400", async (text, sentence) => {
    const { response, store } = await send("POST", text);
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain(sentence);
    expect(store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
  });

  it("refuses a body that is not UTF-8, and JSON nested deeper than the limit", async () => {
    const store = memory();
    const bytes = await handleLrsRequest(
      requestOf("POST", "/statements", { headers: JSON_TYPE, body: Uint8Array.from([0xff, 0xfe]) }),
      optionsOf(store),
    );
    expect([bytes.status, reasonOf(bytes)]).toStrictEqual([400, expect.stringContaining("not UTF-8")]);
    const nested = await send("POST", `{"a":${"[".repeat(5)}${"]".repeat(5)}}`, {
      changes: { limits: { maxDepth: 4 } },
    });
    expect(nested.response.status).toBe(400);
    expect(reasonOf(nested.response)).toContain("deeper than the limit of 4");
  });

  it.each([
    [undefined, "found undefined"],
    ["text/plain", 'found "text/plain"'],
    ["application/xml", 'found "application/xml"'],
  ])("refuses the content type %j with 400", async (type, sentence) => {
    const request = requestOf("POST", "/statements", {
      headers: type === undefined ? {} : { "content-type": type },
      body: "[]",
    });
    const response = await handleLrsRequest(request, optionsOf(memory()));
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain(sentence);
  });

  it("reads the content type in any case and with parameters", async () => {
    for (const type of ["Application/JSON", "application/json; charset=utf-8"]) {
      const response = await handleLrsRequest(
        requestOf("POST", "/statements", { headers: { "content-type": type }, body: "[]" }),
        optionsOf(memory()),
      );
      expect(response.status).toBe(200);
    }
  });
});

describe("POST of Statements", () => {
  it("stores a Statement and answers 200 with its id", async () => {
    const { response, store } = await send("POST", statementOf(1));
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual([uuid(1)]);
    expect(response.headers["content-type"]).toBe("application/json;charset=UTF-8");
    expect(response.headers["x-experience-api-consistent-through"]).toBe(NOW);
    expect(store.held.size).toBe(1);
  });

  it("stores a batch and answers with the ids in the order of the request, making the ones that are missing", async () => {
    const { id: _id, ...bare } = statementOf(2);
    const { response, store } = await send("POST", [statementOf(3), bare, statementOf(1)]);
    expect(jsonOf(response)).toStrictEqual([uuid(3), uuid(901), uuid(1)]);
    expect(store.held.size).toBe(3);
  });

  it("stores the whole batch with one stored time and one call", async () => {
    const { store } = await send("POST", [statementOf(1), statementOf(2)]);
    expect(store.calls.filter((call) => call === "insert")).toHaveLength(1);
    expect([...store.held.values()].map(({ stored }) => stored)).toStrictEqual([NOW, NOW]);
  });

  it("answers 200 with an empty list for a batch of none, and does not call the store to store", async () => {
    const { response, store } = await send("POST", []);
    expect([response.status, jsonOf(response)]).toStrictEqual([200, []]);
    expect(store.calls).not.toContain("insert");
  });

  it("refuses a batch of more than limits.maxBatch with 413, and one of that many with 200", async () => {
    const changes = { limits: { maxBatch: 2 } };
    const three = await send("POST", [statementOf(1), statementOf(2), statementOf(3)], { changes });
    expect(three.response.status).toBe(413);
    expect(reasonOf(three.response)).toContain("The request has 3 Statements, above the limit of 2 for one request.");
    expect(three.store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
    expect((await send("POST", [statementOf(1), statementOf(2)], { changes })).response.status).toBe(200);
  });

  it("refuses a batch that rejects one Statement, whole, and a batch with two Statements of one id", async () => {
    const bad = await send("POST", [statementOf(1), { ...statementOf(2), verb: {} }]);
    expect(bad.response.status).toBe(400);
    expect(reasonOf(bad.response)).toContain("[1].verb");
    expect(bad.store.held.size).toBe(0);
    const twice = await send("POST", [statementOf(1), statementOf(1)]);
    expect(twice.response.status).toBe(400);
    expect(reasonOf(twice.response)).toContain("[1].id");
    expect(twice.store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
  });

  it("refuses a parameter with 400", async () => {
    const { response } = await send("POST", statementOf(1), { query: { statementId: uuid(1) } });
    expect(response.status).toBe(400);
  });

  it("answers 204 for a batch that the LRS holds already, and 200 with the ids for one that has something new", async () => {
    const store = memory();
    await send("POST", [statementOf(1), statementOf(2)], { store });
    const again = await send("POST", [statementOf(1), statementOf(2)], { store });
    expect(again.response.status).toBe(204);
    expect(again.response.body).toBe("");
    const mixed = await send("POST", [statementOf(2), statementOf(3)], { store });
    expect([mixed.response.status, jsonOf(mixed.response)]).toStrictEqual([200, [uuid(2), uuid(3)]]);
  });

  it("answers 409 for a batch that has a Statement the LRS holds with other content", async () => {
    const store = memory();
    await send("POST", statementOf(1), { store });
    const conflict = await send("POST", [{ ...statementOf(1), object: { id: "https://example.org/other" } }], {
      store,
    });
    expect(conflict.response.status).toBe(409);
  });

  it("makes ids with newId, and throws a DataError when newId makes something that is no UUID", async () => {
    const { id: _id, ...bare } = statementOf(1);
    const ok = await send("POST", bare, { changes: { newId: () => uuid(77).toUpperCase() } });
    expect(jsonOf(ok.response)).toStrictEqual([uuid(77)]);
    await expect(send("POST", bare, { changes: { newId: () => "not a uuid" } })).rejects.toBeInstanceOf(DataError);
  });

  it("uses crypto.randomUUID for the id of a Statement when newId is not given", async () => {
    const { id: _id, ...bare } = statementOf(1);
    const store = memory();
    const { newId: _newId, ...changes } = optionsOf(store);
    const response = await handleLrsRequest(
      requestOf("POST", "/statements", { headers: JSON_TYPE, body: JSON.stringify(bare) }),
      changes,
    );
    const [made] = jsonOf(response) as string[];
    expect(made).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
});

describe("the ports of a request that stores Statements", () => {
  it("answers 500 without a word of the cause when the store rejects, and stores nothing more", async () => {
    const store = memory();
    const failing = { ...store.statements, insert: () => Promise.reject(new Error("disk 7 is full")) };
    const { response } = await send("POST", statementOf(1), { store, changes: { statements: failing } });
    expect(response.status).toBe(500);
    expect(reasonOf(response)).not.toContain("disk 7");
  });

  it("answers 500 when consistentThrough rejects, and when get rejects for a voiding Statement", async () => {
    const store = memory();
    const broken = { ...store.statements, consistentThrough: () => Promise.reject(new Error("down")) };
    expect((await send("POST", statementOf(1), { store, changes: { statements: broken } })).response.status).toBe(500);
    const voiding = {
      ...statementOf(2),
      verb: { id: VERB_VOIDED },
      object: { objectType: "StatementRef", id: uuid(1) },
    };
    const noGet = { ...store.statements, get: () => Promise.reject(new Error("down")) };
    expect((await send("POST", voiding, { changes: { statements: noGet } })).response.status).toBe(500);
  });

  it("throws a DataError when consistentThrough answers something that is no time", async () => {
    const store = memory();
    const wrong = { ...store.statements, consistentThrough: async () => 5 as never };
    await expect(send("POST", statementOf(1), { changes: { statements: wrong } })).rejects.toBeInstanceOf(DataError);
  });

  it("rejects with the reason of the signal when it aborts while the store works", async () => {
    const controller = new AbortController();
    const store = memory();
    const hanging = { ...store.statements, insert: () => new Promise<never>(() => {}) };
    const sending = send("POST", statementOf(1), { changes: { statements: hanging, signal: controller.signal } });
    controller.abort(new Error("gave up"));
    await expect(sending).rejects.toStrictEqual(new Error("gave up"));
  });

  it("gives every port the signal of the options", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const store = memory();
    const watching = {
      ...store.statements,
      insert: async (...args: Parameters<typeof store.statements.insert>) => {
        seen.push(args[3]?.signal);
        return store.statements.insert(...args);
      },
      consistentThrough: async (options?: { signal?: AbortSignal }) => {
        seen.push(options?.signal);
        return NOW;
      },
    };
    const observing = {
      ...store.activities,
      observe: async (...args: Parameters<typeof store.activities.observe>) => {
        seen.push(args[2]?.signal);
      },
    };
    await send("POST", statementOf(1), {
      changes: { statements: watching, activities: observing, signal: controller.signal },
    });
    expect(seen).toStrictEqual([controller.signal, controller.signal, controller.signal]);
  });
});

describe("the Activities of the Statements that are stored", () => {
  it("tells the store of every definition of one Activity, so that it can join what several Statements say of it", async () => {
    const meeting = (n: number, name: Record<string, string>): Statement => ({
      ...statementOf(n),
      object: { id: "https://example.org/activities/meeting", definition: { name } },
    });
    const { store } = await send("POST", [
      meeting(1, { "en-US": "meeting" }),
      meeting(2, { "fr-FR": "the meeting in French" }),
    ]);
    expect(store.observed[0]?.activities).toStrictEqual([
      { id: "https://example.org/activities/meeting", definition: { name: { "en-US": "meeting" } } },
      { id: "https://example.org/activities/meeting", definition: { name: { "fr-FR": "the meeting in French" } } },
    ]);
  });

  it("tells the store of every Activity, with the authority, and of one mention of an Activity that has no definition", async () => {
    const withContext: Statement = {
      ...statementOf(1),
      object: { id: "https://example.org/activities/a" },
      context: {
        contextActivities: { parent: [{ id: "https://example.org/activities/b", definition: { name: { en: "B" } } }] },
      },
    };
    const again: Statement = { ...statementOf(2), object: { id: "https://example.org/activities/b" } };
    const { store } = await send("POST", [withContext, again]);
    expect(store.observed).toHaveLength(1);
    expect(store.observed[0]?.authority).toStrictEqual(AUTHORITY);
    expect(store.observed[0]?.activities).toStrictEqual([
      { id: "https://example.org/activities/a" },
      { id: "https://example.org/activities/b", definition: { name: { en: "B" } } },
    ]);
  });

  it("tells it again when a batch is sent again, and answers 500 when it rejects while the Statements stay stored", async () => {
    const store = memory();
    await send("POST", statementOf(1), { store });
    await send("POST", statementOf(1), { store });
    expect(store.observed).toHaveLength(2);
    const failing = { ...store.activities, observe: () => Promise.reject(new Error("down")) };
    const { response } = await send("POST", statementOf(2), { store, changes: { activities: failing } });
    expect(response.status).toBe(500);
    expect(store.held.has(uuid(2))).toBe(true);
  });

  it("tells the store of the Activities of a SubStatement too", async () => {
    const sub: Statement = {
      ...statementOf(1),
      object: {
        objectType: "SubStatement",
        actor: { mbox: "mailto:a@example.org" },
        verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
        object: { id: "https://example.org/activities/inner" },
      },
    };
    const { store } = await send("POST", sub);
    expect(store.observed[0]?.activities.map(({ id }) => id)).toStrictEqual(["https://example.org/activities/inner"]);
  });
});

describe("the check of the host", () => {
  const complete = (n: number) => ({ ...statementOf(n), stored: NOW, authority: AUTHORITY, version: "2.0.0" });

  it("sees the Statements as the LRS stores them, with the access", async () => {
    const seen: unknown[] = [];
    const { response } = await send("POST", statementOf(1), {
      changes: {
        accept: async (statements, access) => {
          seen.push(statements, access.authority);
          return [];
        },
      },
    });
    expect(response.status).toBe(200);
    expect(seen).toStrictEqual([[complete(1)], AUTHORITY]);
  });

  it("refuses with 400 when it finds an error, and goes on when it finds a warning", async () => {
    const finding = (severity: "error" | "warning") => async () => [
      { path: "[0].context", rule: "profile", message: "needs a registration", severity },
    ];
    const bad = await send("POST", statementOf(1), { changes: { accept: finding("error") } });
    expect(bad.response.status).toBe(400);
    expect(reasonOf(bad.response)).toContain("The batch of Statements is invalid at [0].context: needs a registration");
    expect(bad.store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
    expect((await send("POST", statementOf(1), { changes: { accept: finding("warning") } })).response.status).toBe(200);
  });

  it("answers 500 when it rejects", async () => {
    const { response } = await send("POST", statementOf(1), {
      changes: { accept: () => Promise.reject(new Error("down")) },
    });
    expect(response.status).toBe(500);
  });

  it("receives the signal of the options", async () => {
    const controller = new AbortController();
    const seen: unknown[] = [];
    await send("POST", statementOf(1), {
      changes: {
        signal: controller.signal,
        accept: async (_statements, _access, options) => {
          seen.push(options?.signal);
          return [];
        },
      },
    });
    expect(seen).toStrictEqual([controller.signal]);
  });
});

describe("a defect of a reader", () => {
  it("is not taken for a refusal of the request", async () => {
    vi.resetModules();
    vi.doMock("../src/read/index.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/read/index.js")>()),
      readStatementJson: () => {
        throw new TypeError("a defect of the reader");
      },
    }));
    try {
      const { handleLrsRequest: withBrokenReader } = await import("../src/store/index.js");
      const { memory: freshMemory, optionsOf: freshOptions } = await import("./memory-lrs.js");
      await expect(
        withBrokenReader(
          requestOf("POST", "/statements", { headers: JSON_TYPE, body: "[]" }),
          freshOptions(freshMemory()),
        ),
      ).rejects.toThrow(new TypeError("a defect of the reader"));
    } finally {
      vi.doUnmock("../src/read/index.js");
      vi.resetModules();
    }
  });
});

describe("voiding", () => {
  const voiding = (n: number, target: string): Statement => ({
    ...statementOf(n),
    verb: { id: VERB_VOIDED, display: { "en-US": "voided" } },
    object: { objectType: "StatementRef", id: target },
  });

  it("marks the Statement that a voiding Statement refers to as voided", async () => {
    const store = memory();
    await send("POST", statementOf(1), { store });
    const { response } = await send("POST", voiding(2, uuid(1)), { store });
    expect(response.status).toBe(200);
    expect(store.held.get(uuid(1))?.voided).toBe(true);
    expect(store.held.get(uuid(2))?.voided).toBe(false);
  });

  it("marks a Statement of the same batch, whether it comes before or after the voiding Statement", async () => {
    for (const batch of [
      [statementOf(1), voiding(2, uuid(1))],
      [voiding(2, uuid(1)), statementOf(1)],
    ]) {
      const { store } = await send("POST", batch);
      expect(store.held.get(uuid(1))?.voided).toBe(true);
    }
  });

  it("does not void a voiding Statement, in the store or in the batch", async () => {
    const store = memory();
    await send("POST", [statementOf(1), voiding(2, uuid(1))], { store });
    await send("POST", voiding(3, uuid(2)), { store });
    expect(store.held.get(uuid(2))?.voided).toBe(false);
    const batch = await send("POST", [voiding(4, uuid(5)), voiding(5, uuid(6)), statementOf(6)]);
    expect(batch.store.held.get(uuid(5))?.voided).toBe(false);
    expect(batch.store.held.get(uuid(6))?.voided).toBe(true);
  });

  it("accepts a voiding Statement whose target it does not hold, and leaves the later Statement alone", async () => {
    const store = memory();
    const { response } = await send("POST", voiding(2, uuid(1)), { store });
    expect(response.status).toBe(200);
    await send("POST", statementOf(1), { store });
    expect(store.held.get(uuid(1))?.voided).toBe(false);
  });

  it("passes the ids that are voided to the store in lower case, and nothing for a Statement that is already voided", async () => {
    const store = memory();
    const inserted: (readonly string[])[] = [];
    const watching = {
      ...store.statements,
      insert: async (...args: Parameters<typeof store.statements.insert>) => {
        inserted.push(args[1]);
        return store.statements.insert(...args);
      },
    };
    await send("POST", statementOf(1), { store, changes: { statements: watching } });
    await send("POST", voiding(2, uuid(1).toUpperCase()), { store, changes: { statements: watching } });
    await send("POST", voiding(3, uuid(1)), { store, changes: { statements: watching } });
    expect(inserted).toStrictEqual([[], [uuid(1)], []]);
  });

  it("refuses a voiding Statement whose Object is no Statement Reference with 400", async () => {
    const wrong = { ...statementOf(2), verb: { id: VERB_VOIDED } };
    const { response } = await send("POST", wrong);
    expect(response.status).toBe(400);
  });
});

describe("Attachments", () => {
  const data = dataOf("a certificate");
  const withHeader = (extra: Partial<NonNullable<Statement["attachments"]>[number]> = {}): Statement => {
    const statement = statementWithAttachments([data]);
    const [header] = statement.attachments ?? [];
    return {
      ...statementOf(1),
      attachments: [{ ...header, ...extra } as NonNullable<Statement["attachments"]>[number]],
    };
  };

  /** Sends a multipart POST of the Statements and the data. */
  async function multipart(statements: Statement | Statement[], parts = [data], changes: Partial<LrsOptions> = {}) {
    const message = writeMultipart(statements, parts);
    const store = memory();
    const response = await handleLrsRequest(
      requestOf("POST", "/statements", { headers: { "content-type": message.contentType }, body: message.body }),
      optionsOf(store, changes),
    );
    return { response, store };
  }

  it("stores the data of an Attachment with the type of its header, once for a hash", async () => {
    const other = { ...statementOf(2), attachments: withHeader().attachments };
    const { response, store } = await multipart([withHeader(), other]);
    expect(response.status).toBe(200);
    expect([...store.data.values()]).toStrictEqual([data]);
  });

  it("stores the data of a PUT as well", async () => {
    const message = writeMultipart(withHeader(), [data]);
    const store = memory();
    const response = await handleLrsRequest(
      requestOf("PUT", "/statements", {
        query: { statementId: uuid(1) },
        headers: { "content-type": message.contentType },
        body: message.body,
      }),
      optionsOf(store),
    );
    expect(response.status).toBe(204);
    expect(store.data.size).toBe(1);
  });

  it("stores the Statement of an Attachment that has a fileUrl and no data, from JSON", async () => {
    const linked = withHeader({ fileUrl: "https://example.org/certificate" });
    const { response, store } = await send("POST", linked);
    expect(response.status).toBe(200);
    expect(store.data.size).toBe(0);
  });

  it("refuses with 400 an Attachment that has neither a fileUrl nor data, in JSON and in multipart", async () => {
    const json = await send("POST", withHeader());
    expect(json.response.status).toBe(400);
    expect(reasonOf(json.response)).toContain(
      `The Attachment with the hash ${data.sha2} has no fileUrl, and no part holds its data.`,
    );
    const store = memory();
    const empty = await handleLrsRequest(
      requestOf("POST", "/statements", {
        headers: { "content-type": "multipart/mixed; boundary=b" },
        body: messageOf("b", JSON.stringify(withHeader()), []),
      }),
      optionsOf(store),
    );
    expect(empty.status).toBe(400);
    expect(store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
  });

  it("stores data whose length is not the length of the header, as the hash is what binds the data to the Attachment", async () => {
    const { response, store } = await multipart(withHeader({ length: 3 }));
    expect(response.status).toBe(200);
    expect(store.data.get(data.sha2)).toStrictEqual(data);
    const asked = await handleLrsRequest(
      requestOf("GET", "/statements", { query: { statementId: uuid(1), attachments: "true" } }),
      optionsOf(store),
    );
    expect(asked.status).toBe(200);
    expect(asked.headers["content-type"]).toContain("multipart/mixed");
  });

  it("refuses with 400 a part that no Attachment names, and stores nothing", async () => {
    const stray = dataOf("stray");
    const message = messageOf("b", JSON.stringify(withHeader()), [
      { headers: ["Content-Type: text/plain", `X-Experience-API-Hash: ${data.sha2}`], body: "a certificate" },
      { headers: ["Content-Type: text/plain", `X-Experience-API-Hash: ${stray.sha2}`], body: "stray" },
    ]);
    const store = memory();
    const response = await handleLrsRequest(
      requestOf("POST", "/statements", { headers: { "content-type": "multipart/mixed; boundary=b" }, body: message }),
      optionsOf(store),
    );
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toBe(`The part with the hash ${stray.sha2} belongs to no Attachment of the Statements.`);
    expect(store.held.size).toBe(0);
  });

  it("takes an Attachment of a SubStatement as an Attachment of the request", async () => {
    const sub: Statement = {
      ...statementOf(1),
      object: {
        objectType: "SubStatement",
        actor: { mbox: "mailto:a@example.org" },
        verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
        object: { id: "https://example.org/activities/inner" },
        attachments: withHeader().attachments ?? [],
      },
    };
    const { response, store } = await multipart(sub);
    expect(response.status).toBe(200);
    expect(store.data.size).toBe(1);
  });

  describe("the limits of a multipart request", () => {
    it("refuses more parts than limits.maxParts with 413", async () => {
      const two = [dataOf("one"), dataOf("two")];
      const statement = { ...statementOf(1), attachments: statementWithAttachments(two).attachments };
      const { response, store } = await multipart(statement, two, { limits: { maxParts: 2 } });
      expect(response.status).toBe(413);
      expect(reasonOf(response)).toContain("part count exceeds");
      expect(store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
    });

    it("refuses a part above limits.maxPartBytes with 413, and the Statements part too", async () => {
      const big = dataOf("x".repeat(500));
      const statement = { ...statementOf(1), attachments: statementWithAttachments([big]).attachments };
      expect((await multipart(statement, [big], { limits: { maxPartBytes: 499 } })).response.status).toBe(413);
      expect((await multipart(statement, [big], { limits: { maxPartBytes: 5000 } })).response.status).toBe(200);
      expect((await multipart(statement, [big], { limits: { maxPartBytes: 20 } })).response.status).toBe(413);
    });

    it("refuses a message that is not valid with 400, and a content type with no boundary", async () => {
      const store = memory();
      const broken = await handleLrsRequest(
        requestOf("POST", "/statements", {
          headers: { "content-type": "multipart/mixed; boundary=b" },
          body: "not a message",
        }),
        optionsOf(store),
      );
      expect(broken.status).toBe(400);
      const bare = await handleLrsRequest(
        requestOf("POST", "/statements", { headers: { "content-type": "multipart/mixed" }, body: "x" }),
        optionsOf(store),
      );
      expect(bare.status).toBe(400);
    });

    it("refuses JSON nested deeper than limits.maxDepth in the first part with 400", async () => {
      const message = writeMultipart(statementOf(1), []);
      const text = new TextDecoder().decode(message.body).replace(/\{.*\}/u, `{"a":${"[".repeat(5)}${"]".repeat(5)}}`);
      const response = await handleLrsRequest(
        requestOf("POST", "/statements", { headers: { "content-type": message.contentType }, body: text }),
        optionsOf(memory(), { limits: { maxDepth: 4 } }),
      );
      expect(response.status).toBe(400);
    });
  });
});

describe("the bounds of what a request makes the LRS hold", () => {
  const bare = (index: number) => ({ id: uuid(index) });
  const wrongBatch = (count: number) => Array.from({ length: count }, (_value, index) => bare(index + 1));

  it("refuses a body of more tokens than limits.maxTokens, a million by default, before it parses it", async () => {
    const million = `[${"0,".repeat(600_000)}0]`;
    const over = await send("POST", million);
    expect(over.response.status).toBe(400);
    expect(reasonOf(over.response)).toContain("The text has more than 1000000 tokens");
    expect(over.store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
    const few = await send("POST", statementOf(1), { changes: { limits: { maxTokens: 20 } } });
    expect(few.response.status).toBe(400);
    expect(reasonOf(few.response)).toContain("The text has more than 20 tokens");
    expect((await send("POST", statementOf(1), { changes: { limits: { maxTokens: 2000 } } })).response.status).toBe(
      200,
    );
  });

  it("refuses the first part of a multipart body of more tokens than limits.maxTokens", async () => {
    const message = writeMultipart(statementOf(1), []);
    const refuse = (maxTokens: number) =>
      handleLrsRequest(
        requestOf("POST", "/statements", { headers: { "content-type": message.contentType }, body: message.body }),
        optionsOf(memory(), { limits: { maxTokens } }),
      );
    const over = await refuse(20);
    expect(over.status).toBe(400);
    expect(reasonOf(over)).toContain("The text has more than 20 tokens");
    expect((await refuse(2000)).status).toBe(200);
  });

  it("stops counting the errors of a batch at limits.maxFindings, and says that there may be more", async () => {
    const batch = wrongBatch(40);
    const stopped = await send("POST", batch, { changes: { limits: { maxFindings: 3 } } });
    expect(stopped.response.status).toBe(400);
    const message = reasonOf(stopped.response);
    expect(message).toMatch(/^The batch of Statements is invalid at \[0\]/u);
    expect(message).toContain(
      "At least 2 more errors: the check stopped at its limit, and validateStatements with a higher maxFindings lists more.",
    );
    expect(stopped.store.calls.filter((call) => call !== "consistentThrough")).toStrictEqual([]);
    const counted = await send("POST", wrongBatch(2));
    expect(reasonOf(counted.response)).toMatch(
      /^The batch of Statements is invalid at \[0\]\.actor: .* 5 more errors: validateStatements lists every finding\.$/u,
    );
  });

  it("stops counting at 1,000 errors by default", async () => {
    const { response } = await send("POST", wrongBatch(500));
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain("At least 999 more errors: the check stopped at its limit");
  });

  it("counts errors alone toward limits.maxFindings, so that warnings do not refuse a batch", async () => {
    const warned = (index: number) => ({
      ...statementOf(index),
      object: {
        id: "https://example.org/activities/choice",
        definition: {
          type: "http://adlnet.gov/expapi/activities/cmi.interaction",
          interactionType: "choice",
          correctResponsesPattern: ["a"],
          choices: [{ id: "a b", description: { "en-US": "A" } }],
        },
      },
    });
    const { response, store } = await send("POST", [warned(1), warned(2), warned(3)], {
      changes: { limits: { maxFindings: 1 } },
    });
    expect(response.status).toBe(200);
    expect(store.held.size).toBe(3);
  });

  it("reads each Statement of an accepted batch once", async () => {
    const { response, store } = await send("POST", [statementOf(1), statementOf(2)]);
    expect(response.status).toBe(200);
    expect([...store.held.keys()]).toStrictEqual([uuid(1), uuid(2)]);
  });

  it("throws a DataError for limits that are no positive whole numbers", async () => {
    await expect(send("POST", statementOf(1), { changes: { limits: { maxTokens: 0 } } })).rejects.toThrow("maxTokens");
    await expect(send("POST", statementOf(1), { changes: { limits: { maxFindings: 1.5 } } })).rejects.toThrow(
      "maxFindings",
    );
  });
});

describe("what an LRS converts and refuses in the properties it sets or judges", () => {
  const stamped = (timestamp: string, n = 1): Statement => ({ ...statementOf(n), timestamp });
  const heldTimestamp = (store: ReturnType<typeof memory>, n = 1) => store.held.get(uuid(n))?.statement.timestamp;

  it.each([
    ["an offset", "2023-05-04T12:00:00.250-05:00", "2023-05-04T17:00:00.250Z"],
    ["a time with no seconds, which ISO 8601 allows", "2023-05-04T12:00-05:00", "2023-05-04T17:00:00.000Z"],
    [
      "a space between the date and the time, which RFC 3339 allows",
      "2008-09-15 15:53:00.601+00:00",
      "2008-09-15T15:53:00.601Z",
    ],
    ["a lower-case t and z", "2023-05-04t12:00:00z", "2023-05-04T12:00:00.000Z"],
    ["more than three digits of a second", "2023-05-04T12:00:00.123456Z", "2023-05-04T12:00:00.123Z"],
  ])("writes a timestamp with %s in UTC", async (_name, timestamp, utc) => {
    const { response, store } = await send("POST", stamped(timestamp));
    expect(response.status).toBe(200);
    expect(heldTimestamp(store)).toBe(utc);
  });

  it("writes the timestamp of a SubStatement in UTC, and leaves a Statement with none to get the time it was stored", async () => {
    const sub: Statement = {
      ...statementOf(1),
      object: {
        objectType: "SubStatement",
        actor: { mbox: "mailto:a@example.org" },
        verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
        object: { id: "https://example.org/activities/inner" },
        timestamp: "2023-05-04T12:00-05:00",
      },
    };
    const { id: _id, timestamp: _timestamp, ...bare } = statementOf(2);
    const { response, store } = await send("POST", [sub, bare]);
    expect(response.status).toBe(200);
    const inner = store.held.get(uuid(1))?.statement.object;
    expect(inner && "timestamp" in inner ? inner.timestamp : undefined).toBe("2023-05-04T17:00:00.000Z");
    expect(heldTimestamp(store)).toBe(sub.timestamp);
  });

  it("refuses the offset -00:00, which ISO 8601 does not allow, and says where it is", async () => {
    const { response, store } = await send("POST", [statementOf(1), stamped("2008-09-15T15:53:00.601-00:00", 2)]);
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toBe(
      'At [1].timestamp: The timestamp "2008-09-15T15:53:00.601-00:00" has the offset -00:00, which ISO 8601 does not allow: write Z or +00:00.',
    );
    expect(store.held.size).toBe(0);
    const inner = await send("POST", {
      ...statementOf(1),
      object: {
        objectType: "SubStatement",
        actor: { mbox: "mailto:a@example.org" },
        verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
        object: { id: "https://example.org/activities/inner" },
        timestamp: "2008-09-15T15:53:00-00:00",
      },
    });
    expect(reasonOf(inner.response)).toContain("At [0].object.timestamp:");
  });

  it.each([
    "should fail",
    "01/011/2015",
    "2008-09-15T15:53:00.601-0000",
    "2008-09-15T15:53:00.601-00",
    "2023-02-30T12:00:00Z",
  ])("leaves %j for the reader of Statements to refuse with its path", async (timestamp) => {
    const { response, store } = await send("POST", stamped(timestamp));
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain("The batch of Statements is invalid at [0].timestamp");
    expect(store.held.size).toBe(0);
  });

  it.each(["1.0", "1.0.9", "2.0", "2.0.0", "2.0.7"])("takes the Statement version %s", async (version) => {
    const { response, store } = await send("POST", { ...statementOf(1), version });
    expect(response.status).toBe(200);
    expect(store.held.get(uuid(1))?.statement.version).toBe(version);
  });

  it.each(["should fail", "0.9.9", "1.1.0", "3.0.0", "2", "2.0.0-beta"])(
    "refuses the Statement version %j",
    async (version) => {
      const { response, store } = await send("POST", [statementOf(1), { ...statementOf(2), version }]);
      expect(response.status).toBe(400);
      expect(reasonOf(response)).toBe(
        `The version of the Statement at [1], ${JSON.stringify(version)}, is not one that the LRS takes: write 2.0.x, or 1.0.x for a Statement of xAPI 1.0.`,
      );
      expect(store.held.size).toBe(0);
    },
  );

  it.each([
    [
      "an identified Group",
      {
        objectType: "Group",
        mbox: "mailto:t@example.org",
        member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }],
      },
    ],
    ["an anonymous Group of one Agent", { objectType: "Group", member: [{ mbox: "mailto:a@example.org" }] }],
    [
      "an anonymous Group of three Agents",
      { objectType: "Group", member: ["a", "b", "c"].map((name) => ({ mbox: `mailto:${name}@example.org` })) },
    ],
  ])("refuses a submitted authority that is %s, though the LRS would replace it", async (_name, authority) => {
    const { response, store } = await send("POST", { ...statementOf(1), authority });
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain("The batch of Statements is invalid at [0].authority");
    expect(store.held.size).toBe(0);
  });

  it("refuses a revision or a platform in the context of a Statement whose Object is not an Activity", async () => {
    const about = {
      ...statementOf(1),
      object: { objectType: "Agent", mbox: "mailto:a@example.org" },
      context: { revision: "2" },
    };
    const { response } = await send("POST", about);
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain("The batch of Statements is invalid at [0].context.revision");
    expect(
      (await send("POST", { ...statementOf(1), context: { platform: "LMS", revision: "2" } })).response.status,
    ).toBe(200);
  });
});
