import { type Statement, VERB_VOIDED } from "@interopkit/learning-records";
import type { StoredStatement } from "@interopkit/learning-records/store";
import { describe, expect, it } from "vitest";
import { createDirectory, createMemoryDocuments } from "../src/documents.ts";
import { createMemoryStatements } from "../src/statements.ts";

const CLOCK = { now: () => Date.parse("2026-03-02T08:00:00.000Z") };
const ACTOR = { mbox: "mailto:ana@campus.example" } as const;

/** A Statement as the LRS stores it, with an id made of a number. */
function entry(n: number, verb = "completed", voided = false): StoredStatement {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const statement: Statement = {
    id,
    actor: ACTOR,
    verb: { id: `http://adlnet.gov/expapi/verbs/${verb}` },
    object: { id: "https://campus.example/courses/a" },
    stored: "2026-03-02T08:00:00.000Z",
    timestamp: "2026-03-02T08:00:00.000Z",
    version: "2.0.0",
  };
  return { statement, stored: "2026-03-02T08:00:00.000Z", voided, version: "2.0.0" };
}

describe("the memory store of Statements", () => {
  it("stores a batch, and stores nothing of a batch with an id that it holds, which it returns as it held it", async () => {
    const { statements, count } = createMemoryStatements(CLOCK);
    expect(await statements.insert([entry(1), entry(2)], [], [])).toStrictEqual({ existing: [] });
    const resent = await statements.insert([entry(2, "answered"), entry(3)], [], []);
    expect(resent.existing).toStrictEqual([entry(2)]);
    expect(count()).toBe(2);
  });

  it("keeps the ids of voids, so that a Statement which comes later is voided", async () => {
    const { statements } = createMemoryStatements(CLOCK);
    const later = entry(1).statement.id ?? "";
    await statements.insert([entry(2)], [later], []);
    await statements.insert([entry(1)], [], []);
    expect((await statements.get(later, { voided: true }))?.voided).toBe(true);
  });

  it("never voids a voiding Statement, whether it is held or comes later", async () => {
    const { statements } = createMemoryStatements(CLOCK);
    const voiding = (n: number, target: string): StoredStatement => ({
      ...entry(n),
      statement: {
        ...entry(n).statement,
        verb: { id: VERB_VOIDED },
        object: { objectType: "StatementRef", id: target },
      },
    });
    const [first, second] = [entry(1).statement.id ?? "", entry(2).statement.id ?? ""];
    await statements.insert([voiding(1, entry(9).statement.id ?? "")], [entry(9).statement.id ?? ""], []);
    await statements.insert([entry(3)], [first], []);
    expect((await statements.get(first, { voided: false }))?.voided).toBe(false);
    await statements.insert([entry(4)], [second], []);
    await statements.insert([voiding(2, entry(9).statement.id ?? "")], [], []);
    expect((await statements.get(second, { voided: false }))?.voided).toBe(false);
  });

  it("marks the Statements of voids as voided, those of the same batch included, and returns each only to a query for voided ones", async () => {
    const { statements } = createMemoryStatements(CLOCK);
    await statements.insert([entry(1), entry(2)], [entry(1).statement.id ?? ""], []);
    expect(await statements.get(entry(1).statement.id ?? "", { voided: false })).toBeUndefined();
    expect((await statements.get(entry(1).statement.id ?? "", { voided: true }))?.voided).toBe(true);
    expect((await statements.get(entry(2).statement.id ?? "", { voided: false }))?.voided).toBe(false);
  });

  it("pages newest first, or oldest first, by a cursor that stays right while Statements arrive", async () => {
    const { statements } = createMemoryStatements(CLOCK);
    await statements.insert([entry(1), entry(2), entry(3)], [], []);
    const first = await statements.query({}, { limit: 2 });
    expect(first?.statements.map(({ statement }) => statement.id?.slice(-1))).toStrictEqual(["3", "2"]);
    await statements.insert([entry(4)], [], []);
    const second = await statements.query(
      {},
      { limit: 2, ...(first?.cursor === undefined ? {} : { cursor: first.cursor }) },
    );
    expect(second?.statements.map(({ statement }) => statement.id?.slice(-1))).toStrictEqual(["1"]);
    expect(second?.cursor).toBeUndefined();
    const ascending = await statements.query({ ascending: true }, { limit: 10 });
    expect(ascending?.statements.map(({ statement }) => statement.id?.slice(-1))).toStrictEqual(["1", "2", "3", "4"]);
    const later = await statements.query({ ascending: true }, { limit: 2, cursor: "2" });
    expect(later?.statements.map(({ statement }) => statement.id?.slice(-1))).toStrictEqual(["3", "4"]);
  });

  it("filters with the rules of the standard, and answers undefined for a cursor that it did not make", async () => {
    const { statements } = createMemoryStatements(CLOCK);
    await statements.insert([entry(1, "completed"), entry(2, "answered")], [], []);
    const answered = await statements.query({ verb: "http://adlnet.gov/expapi/verbs/answered" }, { limit: 10 });
    expect(answered?.statements).toHaveLength(1);
    expect(await statements.query({}, { limit: 1, cursor: "not a number" })).toBeUndefined();
  });

  it("keeps the data of Attachments by their hash, and says what it has", async () => {
    const { statements } = createMemoryStatements(CLOCK);
    const data = { sha2: "a".repeat(64), contentType: "text/plain", body: new Uint8Array([1]) };
    await statements.insert([entry(1)], [], [data]);
    const found = await statements.attachments(["a".repeat(64), "b".repeat(64)]);
    expect([...found.keys()]).toStrictEqual(["a".repeat(64)]);
  });

  it("gives the time of the clock as the time every Statement is available through", async () => {
    expect(await createMemoryStatements(CLOCK).statements.consistentThrough()).toBe("2026-03-02T08:00:00.000Z");
  });
});

describe("the memory store of Activities", () => {
  const meeting = (
    definition: object,
  ): Parameters<ReturnType<typeof createMemoryStatements>["activities"]["observe"]>[0] => [
    { id: "https://campus.example/m", definition },
  ];
  const sender = { mbox: "mailto:a@campus.example" } as const;

  it("joins the languages and extensions of what one authority sends, and the newer wins elsewhere", async () => {
    const { activities } = createMemoryStatements(CLOCK);
    await activities.observe(meeting({ name: { en: "Meeting" }, extensions: { "https://x.example/a": 1 } }), sender);
    await activities.observe(
      meeting({
        name: { id: "Rapat" },
        description: { en: "Weekly" },
        extensions: { "https://x.example/b": 2 },
        type: "https://x.example/t",
      }),
      sender,
    );
    expect(await activities.get("https://campus.example/m")).toStrictEqual({
      id: "https://campus.example/m",
      objectType: "Activity",
      definition: {
        name: { en: "Meeting", id: "Rapat" },
        description: { en: "Weekly" },
        extensions: { "https://x.example/a": 1, "https://x.example/b": 2 },
        type: "https://x.example/t",
      },
    });
  });

  it("does not let another authority change the definition, and keeps no Activity that has no definition", async () => {
    const { activities } = createMemoryStatements(CLOCK);
    await activities.observe(meeting({ name: { en: "Meeting" } }), sender);
    await activities.observe(meeting({ name: { en: "Hijacked" } }), { mbox: "mailto:other@example.org" });
    await activities.observe([{ id: "https://campus.example/none" }], sender);
    expect((await activities.get("https://campus.example/m"))?.definition?.name).toStrictEqual({ en: "Meeting" });
    expect(await activities.get("https://campus.example/none")).toBeUndefined();
  });
});

describe("the memory store of documents", () => {
  const key = { resource: "state", activityId: "https://campus.example/a", agent: ACTOR, stateId: "s" } as const;
  const document = (text: string, updated = "2026-03-02T08:00:00.000Z") => ({
    contentType: "text/plain",
    body: new TextEncoder().encode(text),
    etag: `"${text}"`,
    updated,
  });

  it("writes under the condition that it is given, atomically", async () => {
    const store = createMemoryDocuments();
    expect(await store.write(key, document("one"), { none: true })).toBe("written");
    expect(await store.write(key, document("two"), { none: true })).toBe("exists");
    expect(await store.write(key, document("two"), { ifNoneMatch: "*" })).toBe("precondition-failed");
    expect(await store.write(key, document("two"), { ifMatch: '"nope"' })).toBe("precondition-failed");
    expect(await store.write(key, document("two"), { ifMatch: '"one"' })).toBe("written");
    expect((await store.get(key))?.etag).toBe('"two"');
  });

  it("removes a document under its tag, says when there is none, and lists ids after a time", async () => {
    const store = createMemoryDocuments();
    await store.write(key, document("one", "2026-03-02T08:00:00.000Z"), { none: true });
    await store.write({ ...key, stateId: "t" }, document("two", "2026-03-02T09:00:00.000Z"), { none: true });
    const scope = { resource: "state", activityId: key.activityId, agent: ACTOR } as const;
    expect(await store.list(scope, undefined)).toStrictEqual(["s", "t"]);
    expect(await store.list(scope, "2026-03-02T08:30:00.000Z")).toStrictEqual(["t"]);
    expect(await store.delete(key, { ifMatch: '"nope"' })).toBe("precondition-failed");
    expect(await store.delete(key, { ifMatch: '"one"' })).toBe("deleted");
    expect(await store.delete(key, { ifMatch: '"one"' })).toBe("absent");
    await store.deleteAll(scope);
    expect(await store.list(scope, undefined)).toStrictEqual([]);
  });
});

describe("the directory", () => {
  it("answers with what it knows of a person, and otherwise with the identifiers of the Agent asked about", async () => {
    const directory = createDirectory({
      "mailto:ana@campus.example": { objectType: "Person", name: ["Ana"], mbox: ["mailto:ana@campus.example"] },
    });
    expect((await directory.person(ACTOR)).name).toStrictEqual(["Ana"]);
    const account = { homePage: "https://sso.example", name: "x" };
    expect(await directory.person({ account, name: "X" })).toStrictEqual({
      objectType: "Person",
      name: ["X"],
      account: [account],
    });
    expect(await directory.person({ openid: "https://id.example/x" })).toStrictEqual({
      objectType: "Person",
      openid: ["https://id.example/x"],
    });
    expect(await directory.person({ mbox_sha1sum: "a".repeat(40) })).toStrictEqual({
      objectType: "Person",
      mbox_sha1sum: ["a".repeat(40)],
    });
  });
});
