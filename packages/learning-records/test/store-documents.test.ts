import { DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { describe, expect, it } from "vitest";
import type { LrsDocument } from "../src/index.js";
import { handleLrsRequest, type LrsOptions } from "../src/store/index.js";
import { jsonOf, type Memory, memory, optionsOf, reasonOf, requestOf, textOf } from "./memory-lrs.js";

const ACTIVITY = "https://example.org/activities/course-1";
const AGENT = JSON.stringify({ mbox: "mailto:learner@example.org" });
const STATE: Record<string, string> = { activityId: ACTIVITY, agent: AGENT, stateId: "bookmark" };
const JSON_TYPE = "application/json";
const FAILED = "The LRS could not answer the request.";

/** The SHA-1 of "hello" in hex, which is the entity tag of a document with that body, in quotes. */
const HELLO_TAG = '"aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"';

interface Init {
  readonly query?: Readonly<Record<string, string>> | string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

/** Calls the handler on the stores of a memory. */
function send(
  store: Memory,
  method: string,
  path: string,
  init: Init = {},
  changes: Partial<LrsOptions> = {},
): Promise<HttpResponse> {
  return handleLrsRequest(requestOf(method, path, init), optionsOf(store, changes));
}

/** Writes a State document with a precondition that lets it through. */
function putState(store: Memory, body: string, headers: Record<string, string> = {}, query = STATE) {
  return send(store, "PUT", "/activities/state", {
    query,
    headers: {
      "content-type": JSON_TYPE,
      ...(headers["if-match"] === undefined ? { "if-none-match": "*" } : {}),
      ...headers,
    },
    body,
  });
}

/** Replaces the one document of a memory with another body and a tag the handler did not make, as another writer would. */
function rewrite(store: Memory, body: string, etag: string): void {
  const entry = [...store.documents][0];
  if (entry === undefined) throw new Error("The memory holds no document.");
  const [id, held] = entry;
  store.documents.set(id, {
    key: held.key,
    document: { ...held.document, body: new TextEncoder().encode(body), etag, updated: held.document.updated },
  });
}

/** The one document of a memory. */
function onlyDocument(store: Memory): LrsDocument {
  const held = [...store.documents.values()][0];
  if (held === undefined) throw new Error("The memory holds no document.");
  return held.document;
}

/** The body of the one document of a memory as text. */
function heldText(store: Memory): string {
  const [held] = [...store.documents.values()];
  return new TextDecoder().decode(held?.document.body);
}

describe("handleLrsRequest: PUT of a document", () => {
  it("creates a document with If-None-Match and answers 204 with its ETag", async () => {
    const store = memory();
    const response = await putState(store, "hello", { "content-type": "text/plain" });
    expect(response.status).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers.etag).toBe(HELLO_TAG);
    expect(response.headers["x-experience-api-version"]).toBe("2.0.0");
    expect(heldText(store)).toBe("hello");
  });

  it("creates a document with no precondition where none exists, and refuses with 409 where one does", async () => {
    const store = memory();
    const created = await send(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE },
      body: "{}",
    });
    expect(created.status).toBe(204);
    const again = await send(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE },
      body: "[]",
    });
    expect(again.status).toBe(409);
    expect(reasonOf(again)).toBe(
      "The document exists: send If-Match with its ETag to change it, or check its current state with a GET first.",
    );
    expect(heldText(store)).toBe("{}");
  });

  it("replaces a document when If-Match names its tag, and refuses with 412 when the tag is another", async () => {
    const store = memory();
    await putState(store, "hello");
    const replaced = await putState(store, "world", { "if-match": HELLO_TAG });
    expect(replaced.status).toBe(204);
    expect(heldText(store)).toBe("world");
    const stale = await send(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE, "if-match": HELLO_TAG },
      body: "late",
    });
    expect(stale.status).toBe(412);
    expect(reasonOf(stale)).toBe("The document is not the version that If-Match names.");
    expect(heldText(store)).toBe("world");
  });

  it("answers 412 for If-Match where no document exists, and for If-None-Match where one does", async () => {
    const store = memory();
    const absent = await send(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE, "if-match": HELLO_TAG },
      body: "x",
    });
    expect(absent.status).toBe(412);
    await putState(store, "hello");
    const exists = await putState(store, "again");
    expect(exists.status).toBe(412);
    expect(reasonOf(exists)).toBe(
      "The document is a version that If-None-Match names, and the write asks that it is not.",
    );
  });

  it("takes a list of tags in If-None-Match: the write goes where the document has none of them", async () => {
    const store = memory();
    await putState(store, "hello");
    const header = async (value: string, body: string) =>
      (
        await send(store, "PUT", "/activities/state", {
          query: STATE,
          headers: { "content-type": JSON_TYPE, "if-none-match": value },
          body,
        })
      ).status;
    expect(await header(`"nope", ${HELLO_TAG}`, "named")).toBe(412);
    expect(heldText(store)).toBe("hello");
    expect(await header('"nope", W/"x"', "other")).toBe(204);
    expect(heldText(store)).toBe("other");
    const absent = memory();
    const created = await send(absent, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE, "if-none-match": '"nope"' },
      body: "new",
    });
    expect(created.status).toBe(204);
  });

  it("takes * and lists of tags in If-Match, and never matches a weak tag", async () => {
    const store = memory();
    await putState(store, "hello");
    const header = async (value: string, body: string) =>
      (
        await send(store, "PUT", "/activities/state", {
          query: STATE,
          headers: { "content-type": JSON_TYPE, "if-match": value },
          body,
        })
      ).status;
    expect(await header(`W/${HELLO_TAG}`, "weak")).toBe(412);
    expect(await header('"nope", W/"x"', "none")).toBe(412);
    expect(await header(`"nope" , ${HELLO_TAG}`, "listed")).toBe(204);
    expect(heldText(store)).toBe("listed");
    expect(await header("*", "any")).toBe(204);
    expect(heldText(store)).toBe("any");
  });

  it.each([
    ["an If-Match that is not quoted, such as one that has no ETag form", { "if-match": "1234" }],
    ["an If-Match that is empty", { "if-match": "" }],
    ["an If-Match of the right hash without its quotes", { "if-match": HELLO_TAG.replaceAll('"', "") }],
    ["an If-Match and an If-None-Match that cannot both hold", { "if-match": "*", "if-none-match": "*" }],
  ])("answers 412 and changes nothing for %s", async (_name, headers) => {
    const store = memory();
    await putState(store, "hello");
    const response = await send(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE, ...headers },
      body: "x",
    });
    expect(response.status).toBe(412);
    expect(heldText(store)).toBe("hello");
  });

  it("answers 400 for a content type that is missing or is no media type", async () => {
    const store = memory();
    const missing = await send(store, "PUT", "/activities/state", { query: STATE, body: "x" });
    expect(missing.status).toBe(400);
    expect(reasonOf(missing)).toBe("A PUT or POST of a document needs a Content-Type header.");
    const wrong = await send(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": "not a type" },
      body: "x",
    });
    expect(wrong.status).toBe(400);
    expect(reasonOf(wrong)).toBe(
      'The Content-Type must be an Internet media type, such as application/json, found "not a type".',
    );
  });

  it("keeps the bytes and the content type of any document, and an empty one", async () => {
    const store = memory();
    const bytes = new Uint8Array([0, 255, 128, 7]);
    await send(store, "PUT", "/agents/profile", {
      query: { agent: AGENT, profileId: "photo" },
      headers: { "content-type": "image/png", "if-none-match": "*" },
      body: bytes,
    });
    const got = await send(store, "GET", "/agents/profile", { query: { agent: AGENT, profileId: "photo" } });
    expect(got.status).toBe(200);
    expect(got.body).toStrictEqual(bytes);
    expect(got.headers["content-type"]).toBe("image/png");
    await send(store, "PUT", "/agents/profile", {
      query: { agent: AGENT, profileId: "empty" },
      headers: { "content-type": "text/plain" },
    });
    const empty = await send(store, "GET", "/agents/profile", { query: { agent: AGENT, profileId: "empty" } });
    expect(empty.status).toBe(200);
    expect((empty.body as Uint8Array).byteLength).toBe(0);
    expect(empty.headers.etag).toBe('"da39a3ee5e6b4b0d3255bfef95601890afd80709"');
  });

  it("refuses with 413, before the store is called, a document over the limit", async () => {
    const store = memory();
    const response = await send(
      store,
      "PUT",
      "/activities/state",
      { query: STATE, headers: { "content-type": "text/plain" }, body: "123456" },
      { limits: { maxDocumentBytes: 5 } },
    );
    expect(response.status).toBe(413);
    expect(reasonOf(response)).toBe("The document has 6 bytes, above the limit of 5 bytes.");
    expect(store.calls).toStrictEqual([]);
    const fits = await send(
      store,
      "PUT",
      "/activities/state",
      { query: STATE, headers: { "content-type": "text/plain" }, body: "12345" },
      { limits: { maxDocumentBytes: 5 } },
    );
    expect(fits.status).toBe(204);
  });
});

describe("handleLrsRequest: GET of a document", () => {
  it("returns the document with its type, ETag and time of last modification", async () => {
    const store = memory();
    await putState(store, "hello", { "content-type": "text/plain; charset=utf-8" });
    const response = await send(store, "GET", "/activities/state", { query: STATE });
    expect(response.status).toBe(200);
    expect(textOf(response)).toBe("hello");
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers.etag).toBe(HELLO_TAG);
    expect(response.headers["last-modified"]).toBe("Thu, 15 Jan 2026 10:30:00 GMT");
  });

  it("answers 404 for a document that does not exist", async () => {
    const response = await send(memory(), "GET", "/activities/state", { query: STATE });
    expect(response.status).toBe(404);
    expect(reasonOf(response)).toBe("The LRS holds no such document.");
  });

  it("answers HEAD with the headers of GET and no body", async () => {
    const store = memory();
    await putState(store, "hello");
    const response = await send(store, "HEAD", "/activities/state", { query: STATE });
    expect(response.status).toBe(200);
    expect(response.body).toBe("");
    expect(response.headers.etag).toBe(HELLO_TAG);
  });

  it("names the document by the identifier of the Agent and not by the rest of the Agent", async () => {
    const store = memory();
    await putState(store, "hello");
    const same = [
      { name: "Someone Else", mbox: "mailto:learner@example.org", objectType: "Agent" },
      { objectType: "Agent", mbox: "mailto:learner@example.org" },
    ];
    for (const agent of same) {
      const response = await send(store, "GET", "/activities/state", {
        query: { ...STATE, agent: JSON.stringify(agent) },
      });
      expect(response.status).toBe(200);
    }
    const other = await send(store, "GET", "/activities/state", {
      query: { ...STATE, agent: JSON.stringify({ mbox: "mailto:other@example.org" }) },
    });
    expect(other.status).toBe(404);
  });

  it("names a document of an Agent with an account, an OpenID or a hashed mailbox", async () => {
    const store = memory();
    const agents = [
      { account: { name: "learner", homePage: "https://example.org" } },
      { openid: "https://learner.example.org/" },
      { mbox_sha1sum: "a".repeat(40) },
    ];
    for (const agent of agents) {
      const query = { ...STATE, agent: JSON.stringify(agent) };
      expect((await putState(store, "x", {}, query)).status).toBe(204);
    }
    expect(store.documents.size).toBe(3);
    const reordered = { account: { homePage: "https://example.org", name: "learner" } };
    const found = await send(store, "GET", "/activities/state", {
      query: { ...STATE, agent: JSON.stringify(reordered) },
    });
    expect(found.status).toBe(200);
  });

  it("keeps the documents of a registration apart from those of another and from those of none", async () => {
    const store = memory();
    const registration = "6690E6C9-3ef0-4ed3-8b37-7f3964730bee";
    await putState(store, "with", {}, { ...STATE, registration });
    await putState(store, "without");
    const get = async (query: Record<string, string>) =>
      textOf(await send(store, "GET", "/activities/state", { query }));
    expect(await get({ ...STATE, registration: registration.toLowerCase() })).toBe("with");
    expect(await get(STATE)).toBe("without");
    expect(await get({ ...STATE, registration: "00000000-0000-4000-8000-000000000000" })).toContain("no such document");
  });
});

describe("handleLrsRequest: the ids of documents", () => {
  const profile = (profileId: string) => ({ query: { agent: AGENT, profileId } });

  it("lists the ids of the documents of a context", async () => {
    const store = memory();
    for (const id of ["a", "b"]) {
      await send(store, "PUT", "/agents/profile", {
        ...profile(id),
        headers: { "content-type": "text/plain", "if-none-match": "*" },
        body: id,
      });
    }
    await send(store, "PUT", "/agents/profile", {
      query: { agent: JSON.stringify({ mbox: "mailto:other@example.org" }), profileId: "c" },
      headers: { "content-type": "text/plain" },
    });
    const response = await send(store, "GET", "/agents/profile", { query: { agent: AGENT } });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json;charset=UTF-8");
    expect(jsonOf(response)).toStrictEqual(["a", "b"]);
    expect(
      jsonOf(await send(store, "GET", "/agents/profile", { query: { agent: '{"mbox":"mailto:none@x.org"}' } })),
    ).toStrictEqual([]);
  });

  it("lists only the documents updated after since, and names the time in any zone", async () => {
    const store = memory();
    let now = Date.parse("2026-01-15T10:00:00.000Z");
    const clock = { now: () => now };
    for (const id of ["early", "late"]) {
      await handleLrsRequest(
        requestOf("PUT", "/agents/profile", {
          ...profile(id),
          headers: { "content-type": "text/plain" },
        }),
        optionsOf(store, { clock }),
      );
      now += 60_000;
    }
    const since = async (value: string) =>
      jsonOf(await send(store, "GET", "/agents/profile", { query: { agent: AGENT, since: value } }));
    expect(await since("2026-01-15T09:59:00Z")).toStrictEqual(["early", "late"]);
    expect(await since("2026-01-15T10:00:00.000Z")).toStrictEqual(["late"]);
    expect(await since("2026-01-15T11:00:30+01:00")).toStrictEqual(["late"]);
    expect(await since("2026-01-15T10:01:00Z")).toStrictEqual([]);
  });

  it("gives the store the time of since in UTC, whatever zone the request wrote", async () => {
    const store = memory();
    const seen: (string | undefined)[] = [];
    const documents = {
      ...store.documentStore,
      list: async (_scope: unknown, since: string | undefined) => {
        seen.push(since);
        return [];
      },
    };
    const ask = (query: Record<string, string>) =>
      send(store, "GET", "/agents/profile", { query }, { documents: documents as never });
    await ask({ agent: AGENT, since: "2026-01-15T11:00:00+01:00" });
    await ask({ agent: AGENT });
    expect(seen).toStrictEqual(["2026-01-15T10:00:00.000Z", undefined]);
  });

  it("lists the States of an Activity and an Agent across registrations unless one is named", async () => {
    const store = memory();
    const registration = "6690e6c9-3ef0-4ed3-8b37-7f3964730bee";
    await putState(store, "x", {}, { ...STATE, stateId: "plain" });
    await putState(store, "x", {}, { ...STATE, stateId: "registered", registration });
    const list = async (query: Record<string, string>) =>
      jsonOf(await send(store, "GET", "/activities/state", { query }));
    const context = { activityId: ACTIVITY, agent: AGENT };
    expect(await list(context)).toStrictEqual(["plain", "registered"]);
    expect(await list({ ...context, registration })).toStrictEqual(["registered"]);
  });

  it("lists each id once even where a store lists it twice", async () => {
    const store = memory();
    const response = await send(
      store,
      "GET",
      "/agents/profile",
      { query: { agent: AGENT } },
      { documents: { ...store.documentStore, list: async () => ["a", "b", "a"] } },
    );
    expect(jsonOf(response)).toStrictEqual(["a", "b"]);
  });

  it("answers HEAD with the status of GET and no body", async () => {
    const response = await send(memory(), "HEAD", "/agents/profile", { query: { agent: AGENT } });
    expect(response.status).toBe(200);
    expect(response.body).toBe("");
  });
});

describe("handleLrsRequest: the parameters of a document", () => {
  const cases: readonly (readonly [string, string, string, Readonly<Record<string, string>>, string])[] = [
    ["GET", "/activities/state", "an unknown parameter", { ...STATE, extra: "1" }, "extra"],
    ["GET", "/activities/state", "a parameter in another case", { ...STATE, StateId: "x" }, "StateId"],
    ["GET", "/activities/state", "no activityId", { agent: AGENT, stateId: "x" }, "activityId"],
    ["GET", "/activities/state", "no agent", { activityId: ACTIVITY, stateId: "x" }, "agent"],
    ["GET", "/activities/state", "an activityId that is no IRI", { ...STATE, activityId: "relative" }, "activityId"],
    ["GET", "/activities/state", "a registration that is no UUID", { ...STATE, registration: "7" }, "registration"],
    ["GET", "/activities/state", "an agent that is not JSON", { ...STATE, agent: "mailto:a@b.org" }, "not valid JSON"],
    ["GET", "/activities/state", "an agent without an identifier", { ...STATE, agent: "{}" }, "exactly one"],
    [
      "GET",
      "/activities/state",
      "a Group as the agent",
      { ...STATE, agent: '{"objectType":"Group","mbox":"mailto:g@x.org"}' },
      "agent",
    ],
    ["GET", "/activities/state", "since with an id", { ...STATE, since: "2026-01-15T10:00:00Z" }, "since"],
    ["GET", "/agents/profile", "a stateId on a profile", { agent: AGENT, stateId: "x" }, "stateId"],
    [
      "GET",
      "/agents/profile",
      "an activityId on an Agent Profile",
      { agent: AGENT, activityId: ACTIVITY },
      "activityId",
    ],
    ["GET", "/activities/profile", "an agent on an Activity Profile", { activityId: ACTIVITY, agent: AGENT }, "agent"],
    ["GET", "/agents/profile", "a since that is no time", { agent: AGENT, since: "yesterday" }, "since"],
    ["PUT", "/activities/state", "no stateId", { activityId: ACTIVITY, agent: AGENT }, "stateId"],
    ["POST", "/agents/profile", "no profileId", { agent: AGENT }, "profileId"],
    [
      "PUT",
      "/agents/profile",
      "since on a write",
      { agent: AGENT, profileId: "x", since: "2026-01-15T10:00:00Z" },
      "since",
    ],
    ["DELETE", "/activities/profile", "no profileId", { activityId: ACTIVITY }, "profileId"],
  ];

  it.each(cases)("answers 400 for %s %s with %s", async (method, path, _name, query, mention) => {
    const store = memory();
    const response = await send(store, method, path, {
      query,
      headers: { "content-type": "text/plain", "if-match": "*" },
      body: "x",
    });
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain(mention);
    expect(store.calls).toStrictEqual([]);
  });

  it("answers 400 for a parameter that occurs twice", async () => {
    const response = await send(memory(), "GET", "/agents/profile", { query: `agent=${AGENT}&agent=${AGENT}` });
    expect(response.status).toBe(400);
  });
});

describe("handleLrsRequest: POST of a document", () => {
  const post = (store: Memory, body: string, headers: Record<string, string> = {}, changes: Partial<LrsOptions> = {}) =>
    send(
      store,
      "POST",
      "/activities/state",
      { query: STATE, headers: { "content-type": JSON_TYPE, ...headers }, body },
      changes,
    );

  it("stores the body where no document exists, as it came", async () => {
    const store = memory();
    const response = await post(store, '{ "a" : 1 }', { "if-none-match": "*" });
    expect(response.status).toBe(204);
    expect(heldText(store)).toBe('{ "a" : 1 }');
  });

  it("stores a body that is not JSON where no document exists", async () => {
    const store = memory();
    const response = await send(store, "POST", "/activities/state", {
      query: STATE,
      headers: { "content-type": "text/plain" },
      body: "plain",
    });
    expect(response.status).toBe(204);
    expect(heldText(store)).toBe("plain");
  });

  it("merges the top-level properties of the body into the document, and the body wins", async () => {
    const store = memory();
    await putState(store, '{"a":1,"b":{"x":1},"c":3}');
    const document = onlyDocument(store);
    const response = await post(store, '{"b":{"y":2},"d":4}', { "if-match": document.etag });
    expect(response.status).toBe(204);
    expect(JSON.parse(heldText(store))).toStrictEqual({ a: 1, b: { y: 2 }, c: 3, d: 4 });
    expect(onlyDocument(store).contentType).toBe(JSON_TYPE);
    expect(onlyDocument(store).etag).toBe(response.headers.etag);
  });

  it("merges a property named __proto__ as data and changes no prototype", async () => {
    const store = memory();
    await putState(store, '{"a":1}');
    await post(store, '{"__proto__":{"polluted":true}}', { "if-match": "*" });
    expect(heldText(store)).toBe('{"a":1,"__proto__":{"polluted":true}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("answers 412 and 409 for the preconditions of a POST as it does for a PUT", async () => {
    const store = memory();
    await putState(store, '{"a":1}');
    expect((await post(store, '{"b":1}', { "if-match": '"stale"' })).status).toBe(412);
    expect((await post(store, '{"b":1}', { "if-none-match": "*" })).status).toBe(412);
    expect(heldText(store)).toBe('{"a":1}');
  });

  it("merges a POST with no precondition into the document that exists, and a PUT with none is the only write that is refused", async () => {
    const store = memory();
    await putState(store, '{"a":1}');
    const merged = await post(store, '{"b":2}');
    expect(merged.status).toBe(204);
    expect(JSON.parse(heldText(store))).toStrictEqual({ a: 1, b: 2 });
    expect(merged.headers.etag).toBe(onlyDocument(store).etag);
    const put = await send(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE },
      body: "{}",
    });
    expect(put.status).toBe(409);
  });

  it.each([
    [
      "a body that is not JSON",
      "not json",
      JSON_TYPE,
      "The body of a POST with the type application/json must be a JSON object, and it is not valid JSON.",
    ],
    ["a body that is an array", "[1]", JSON_TYPE, "must be a JSON object, and it is not an object."],
    ["a body that is a string", '"s"', JSON_TYPE, "is not an object"],
    ["a body that is null", "null", JSON_TYPE, "is not an object"],
    ["a body that is not UTF-8", new Uint8Array([123, 255, 125]), JSON_TYPE, "not UTF-8"],
    ["a body nested too deep", `${"[".repeat(65)}${"]".repeat(65)}`, JSON_TYPE, "deeper than the limit of 64"],
  ])("answers 400 for %s where no document exists", async (_name, body, type, message) => {
    const store = memory();
    const response = await send(store, "POST", "/activities/state", {
      query: STATE,
      headers: { "content-type": type, "if-none-match": "*" },
      body,
    });
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain(message);
    expect(store.documents.size).toBe(0);
  });

  it.each([
    ["a body that is not JSON", "{", "is not valid JSON"],
    ["a body that is an array", "[]", "is not an object"],
  ])("answers 400 for %s where a document exists", async (_name, body, message) => {
    const store = memory();
    await putState(store, '{"a":1}');
    const response = await post(store, body, { "if-match": "*" });
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain(message);
    expect(heldText(store)).toBe('{"a":1}');
  });

  it("answers 400 when the document that exists is not a JSON object, or the body is not JSON", async () => {
    const store = memory();
    await putState(store, "[1,2]");
    const array = await post(store, '{"b":1}', { "if-match": "*" });
    expect(array.status).toBe(400);
    expect(reasonOf(array)).toBe("The document that exists must be a JSON object, and it is not an object.");
    rewrite(store, "plain", '"tag"');
    const plain = await send(store, "POST", "/activities/state", {
      query: STATE,
      headers: { "content-type": "text/plain", "if-match": "*" },
      body: "more",
    });
    expect(plain.status).toBe(400);
    expect(reasonOf(plain)).toBe(
      "A POST merges JSON objects: the body and the document that exists must both be application/json.",
    );
  });

  it("answers 400 when the document that exists is typed as something other than JSON", async () => {
    const store = memory();
    await putState(store, '{"a":1}', { "content-type": "text/plain" });
    const response = await post(store, '{"b":1}', { "if-match": "*" });
    expect(response.status).toBe(400);
  });

  it("refuses a body or a document of more tokens than limits.maxTokens, a million by default, before it parses it", async () => {
    const merge = async (held: string, body: string, maxTokens: number) => {
      const store = memory();
      await putState(store, held);
      return post(store, body, { "if-match": "*" }, { limits: { maxTokens } });
    };
    // {"a":1} has 5 tokens, and {"b":[1,2,3]} has 11.
    const posted = await merge('{"a":1}', '{"b":[1,2,3]}', 8);
    expect(posted.status).toBe(400);
    expect(reasonOf(posted)).toBe(
      "The body of the POST must be a JSON object, and it has more than 8 tokens, the limit.",
    );
    const held = await merge('{"b":[1,2,3]}', '{"a":1}', 8);
    expect(held.status).toBe(400);
    expect(reasonOf(held)).toBe(
      "The document that exists must be a JSON object, and it has more than 8 tokens, the limit.",
    );
    expect((await merge('{"a":1}', '{"b":[1,2,3]}', 11)).status).toBe(204);
    const absent = await send(memory(), "POST", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE, "if-none-match": "*" },
      body: `[${"0,".repeat(524_000)}0]`,
    });
    expect(absent.status).toBe(400);
    expect(reasonOf(absent)).toContain("has more than 1000000 tokens");
  });

  it("refuses with 413 a merge whose result is over the limit of a document", async () => {
    const store = memory();
    const changes = { limits: { maxDocumentBytes: 20 } };
    await putState(store, '{"a":"1234567"}');
    const response = await post(store, '{"b":"1234567"}', { "if-match": "*" }, changes);
    expect(response.status).toBe(413);
    expect(reasonOf(response)).toContain("above the limit of 20 bytes");
    expect(heldText(store)).toBe('{"a":"1234567"}');
  });
});

describe("handleLrsRequest: writes that race", () => {
  const post = (store: Memory, body: string, headers: Record<string, string>, changes: Partial<LrsOptions> = {}) =>
    send(
      store,
      "POST",
      "/activities/state",
      { query: STATE, headers: { "content-type": JSON_TYPE, ...headers }, body },
      changes,
    );

  it("merges into the document that won a race, when the precondition still holds", async () => {
    const store = memory();
    await putState(store, '{"a":1}');
    store.calls.length = 0;
    let raced = false;
    store.interfere = () => {
      if (raced) return;
      raced = true;
      rewrite(store, '{"a":9,"c":3}', '"winner"');
    };
    const response = await post(store, '{"b":2}', { "if-match": "*" });
    expect(response.status).toBe(204);
    expect(JSON.parse(heldText(store))).toStrictEqual({ a: 9, c: 3, b: 2 });
    expect(store.calls.filter((call) => call === "documents.write")).toHaveLength(2);
  });

  it("answers 412 when the document that won is not the version that If-Match names", async () => {
    const store = memory();
    await putState(store, '{"a":1}');
    const document = onlyDocument(store);
    store.calls.length = 0;
    store.interfere = () => rewrite(store, '{"a":9}', '"winner"');
    const response = await post(store, '{"b":2}', { "if-match": document.etag });
    expect(response.status).toBe(412);
    expect(heldText(store)).toBe('{"a":9}');
    expect(store.calls.filter((call) => call === "documents.write")).toHaveLength(1);
  });

  it("answers 409 after the tries of the limit when every try loses", async () => {
    const store = memory();
    await putState(store, '{"a":1}');
    let count = 0;
    store.interfere = () => {
      count += 1;
      rewrite(store, `{"a":${count + 1}}`, `"tag-${count}"`);
    };
    const response = await post(store, '{"b":2}', { "if-match": "*" });
    expect(response.status).toBe(409);
    expect(reasonOf(response)).toBe(
      "The document was changed by other requests while this one was written: read it again and retry.",
    );
    expect(count).toBe(3);
    const fewer = memory();
    await putState(fewer, '{"a":1}');
    let times = 0;
    fewer.interfere = () => {
      times += 1;
      rewrite(fewer, `{"a":${times + 1}}`, `"tag-${times}"`);
    };
    const one = await post(fewer, '{"b":2}', { "if-match": "*" }, { limits: { mergeRetries: 1 } });
    expect(one.status).toBe(409);
    expect(times).toBe(1);
  });

  it("answers 409 for a write with no precondition where another writer created the document", async () => {
    const store = memory();
    store.interfere = () => {
      store.interfere = undefined;
      const key = {
        resource: "state",
        activityId: ACTIVITY,
        agent: { objectType: "Agent", mbox: "mailto:learner@example.org" },
        stateId: "bookmark",
      } as const;
      const document = {
        contentType: JSON_TYPE,
        body: new Uint8Array(),
        etag: '"x"',
        updated: "2026-01-15T10:30:00.000Z",
      };
      store.documents.set(JSON.stringify(key), { key, document });
    };
    const response = await send(store, "PUT", "/activities/state", {
      query: STATE,
      headers: { "content-type": JSON_TYPE },
      body: "{}",
    });
    expect(response.status).toBe(409);
  });
});

describe("handleLrsRequest: DELETE of a document", () => {
  const remove = (store: Memory, headers: Record<string, string> = {}, changes: Partial<LrsOptions> = {}) =>
    send(store, "DELETE", "/activities/state", { query: STATE, headers }, changes);

  it("removes the document whose tag If-Match names", async () => {
    const store = memory();
    await putState(store, "hello");
    const response = await remove(store, { "if-match": HELLO_TAG });
    expect(response.status).toBe(204);
    expect(store.documents.size).toBe(0);
  });

  it("removes a document for If-Match * and for a list of tags", async () => {
    for (const header of ["*", `"nope", ${HELLO_TAG}`]) {
      const store = memory();
      await putState(store, "hello");
      expect((await remove(store, { "if-match": header })).status).toBe(204);
    }
  });

  it("answers 204 for a document that does not exist when no If-Match asks for a version, and 412 when one does", async () => {
    expect((await remove(memory())).status).toBe(204);
    expect((await remove(memory(), { "if-match": "*" })).status).toBe(412);
    expect((await remove(memory(), { "if-match": HELLO_TAG })).status).toBe(412);
  });

  it("removes the document that exists without If-Match, and refuses with 412 when If-Match names another tag", async () => {
    const store = memory();
    await putState(store, "hello");
    const other = await remove(store, { "if-match": '"other"' });
    expect(other.status).toBe(412);
    expect(reasonOf(other)).toBe("The document is not the version that If-Match names.");
    expect(store.documents.size).toBe(1);
    expect((await remove(store, { "if-match": "1234" })).status).toBe(412);
    expect(store.documents.size).toBe(1);
    expect((await remove(store)).status).toBe(204);
    expect(store.documents.size).toBe(0);
  });

  it("answers 400 for If-None-Match, which a DELETE does not take", async () => {
    const store = memory();
    await putState(store, "hello");
    const none = await remove(store, { "if-none-match": "*" });
    expect(none.status).toBe(400);
    expect(reasonOf(none)).toBe('A DELETE takes If-Match, not If-None-Match, found "*".');
    expect(store.documents.size).toBe(1);
  });

  it("removes the document that won a race when If-Match * still holds, and answers 412 or 204 if it was removed", async () => {
    const store = memory();
    await putState(store, "hello");
    let raced = false;
    store.interfere = () => {
      if (raced) return;
      raced = true;
      rewrite(store, "changed", '"winner"');
    };
    expect((await remove(store, { "if-match": "*" })).status).toBe(204);
    expect(store.calls.filter((call) => call === "documents.delete")).toHaveLength(2);
    const gone = memory();
    await putState(gone, "hello");
    gone.interfere = () => gone.documents.clear();
    expect((await remove(gone, { "if-match": "*" })).status).toBe(412);
    const anyone = memory();
    await putState(anyone, "hello");
    anyone.interfere = () => anyone.documents.clear();
    expect((await remove(anyone)).status).toBe(204);
  });

  it("answers 409 after the tries of the limit when every try loses", async () => {
    const store = memory();
    await putState(store, "hello");
    let count = 0;
    store.interfere = () => {
      count += 1;
      rewrite(store, "changed", `"tag-${count}"`);
    };
    const response = await remove(store, { "if-match": "*" });
    expect(response.status).toBe(409);
    expect(reasonOf(response)).toBe(
      "The document was changed by other requests while this one was removed: read it again and retry.",
    );
    expect(count).toBe(3);
  });

  it("removes every State of an Activity and an Agent without a precondition, and no other document", async () => {
    const store = memory();
    const registration = "6690e6c9-3ef0-4ed3-8b37-7f3964730bee";
    await putState(store, "x", {}, { ...STATE, stateId: "one" });
    await putState(store, "x", {}, { ...STATE, stateId: "two", registration });
    await putState(store, "x", {}, { ...STATE, stateId: "other", activityId: "https://example.org/other" });
    await send(store, "PUT", "/agents/profile", {
      query: { agent: AGENT, profileId: "one" },
      headers: { "content-type": "text/plain" },
    });
    const response = await send(store, "DELETE", "/activities/state", {
      query: { activityId: ACTIVITY, agent: AGENT },
    });
    expect(response.status).toBe(204);
    expect(
      [...store.documents.values()].map(({ key }) => (key.resource === "state" ? key.stateId : key.profileId)),
    ).toStrictEqual(["other", "one"]);
  });

  it("removes the States of one registration only when the request names it", async () => {
    const store = memory();
    const registration = "6690e6c9-3ef0-4ed3-8b37-7f3964730bee";
    await putState(store, "x", {}, { ...STATE, stateId: "one" });
    await putState(store, "x", {}, { ...STATE, stateId: "two", registration });
    await send(store, "DELETE", "/activities/state", { query: { activityId: ACTIVITY, agent: AGENT, registration } });
    expect([...store.documents.values()].map(({ key }) => (key.resource === "state" ? key.stateId : ""))).toStrictEqual(
      ["one"],
    );
  });
});

describe("handleLrsRequest: the profiles", () => {
  it("keeps Agent Profile and Activity Profile documents of one id apart from each other and from States", async () => {
    const store = memory();
    const write = (path: string, query: Record<string, string>, body: string) =>
      send(store, "PUT", path, { query, headers: { "content-type": "text/plain", "if-none-match": "*" }, body });
    await write("/agents/profile", { agent: AGENT, profileId: "p" }, "agent");
    await write("/activities/profile", { activityId: ACTIVITY, profileId: "p" }, "activity");
    await write("/activities/state", { ...STATE, stateId: "p" }, "state");
    const read = async (path: string, query: Record<string, string>) =>
      textOf(await send(store, "GET", path, { query }));
    expect(await read("/agents/profile", { agent: AGENT, profileId: "p" })).toBe("agent");
    expect(await read("/activities/profile", { activityId: ACTIVITY, profileId: "p" })).toBe("activity");
    expect(await read("/activities/state", { ...STATE, stateId: "p" })).toBe("state");
  });

  it("changes and removes an Activity Profile under ETags and lists its ids", async () => {
    const store = memory();
    const query = { activityId: ACTIVITY, profileId: "p" };
    const created = await send(store, "PUT", "/activities/profile", {
      query,
      headers: { "content-type": "text/plain", "if-none-match": "*" },
      body: "hello",
    });
    expect(jsonOf(await send(store, "GET", "/activities/profile", { query: { activityId: ACTIVITY } }))).toStrictEqual([
      "p",
    ]);
    const removed = await send(store, "DELETE", "/activities/profile", {
      query,
      headers: { "if-match": created.headers.etag ?? "" },
    });
    expect(removed.status).toBe(204);
    expect((await send(store, "GET", "/activities/profile", { query })).status).toBe(404);
  });
});

describe("handleLrsRequest: who may read and write documents", () => {
  const only = (...actions: readonly ("state.read" | "state.write" | "profiles.read" | "profiles.write")[]) => ({
    access: async () => ({
      allowed: true as const,
      authority: { account: { homePage: "https://lrs.example.org", name: "client-1" } },
      actions,
    }),
  });

  it.each([
    ["GET", "/activities/state", "state.read", STATE],
    ["HEAD", "/activities/state", "state.read", STATE],
    ["PUT", "/activities/state", "state.write", STATE],
    ["POST", "/activities/state", "state.write", STATE],
    ["DELETE", "/activities/state", "state.write", STATE],
    ["GET", "/agents/profile", "profiles.read", { agent: AGENT, profileId: "p" }],
    ["PUT", "/agents/profile", "profiles.write", { agent: AGENT, profileId: "p" }],
    ["DELETE", "/activities/profile", "profiles.write", { activityId: ACTIVITY, profileId: "p" }],
  ] as const)("needs %s %s to be granted %s", async (method, path, action, query) => {
    const store = memory();
    const denied = await send(store, method, path, { query }, only());
    expect(denied.status).toBe(403);
    if (method !== "HEAD") expect(reasonOf(denied)).toBe(`The credentials do not allow ${action}.`);
    expect(store.calls).toStrictEqual([]);
    const other = action.endsWith("read") ? action.replace("read", "write") : action.replace("write", "read");
    const wrong = await send(store, method, path, { query }, only(other as "state.read"));
    expect(wrong.status).toBe(403);
  });
});

describe("handleLrsRequest: a store of documents that fails or breaks its contract", () => {
  const rejecting = (store: Memory, name: "get" | "write" | "delete" | "list" | "deleteAll"): Partial<LrsOptions> => ({
    documents: {
      ...store.documentStore,
      [name]: async () => {
        throw new Error("the database is down");
      },
    },
  });

  it.each([
    ["get", "GET", "/activities/state", STATE],
    ["write", "PUT", "/activities/state", STATE],
    ["delete", "DELETE", "/activities/state", STATE],
    ["list", "GET", "/agents/profile", { agent: AGENT }],
    ["deleteAll", "DELETE", "/activities/state", { activityId: ACTIVITY, agent: AGENT }],
  ] as const)("answers 500 with no cause when %s rejects", async (name, method, path, query) => {
    const store = memory();
    if (name === "write" || name === "delete") await putState(store, "hello");
    const response = await send(
      store,
      method,
      path,
      { query, headers: { "content-type": "text/plain", "if-match": "*" }, body: "x" },
      rejecting(store, name),
    );
    expect(response.status).toBe(500);
    expect(reasonOf(response)).toBe(FAILED);
  });

  it("answers 500 when get rejects during a write or a removal", async () => {
    const store = memory();
    const post = await send(
      store,
      "POST",
      "/activities/state",
      {
        query: STATE,
        headers: { "content-type": JSON_TYPE },
        body: "{}",
      },
      rejecting(store, "get"),
    );
    expect(post.status).toBe(500);
    const remove = await send(
      store,
      "DELETE",
      "/activities/state",
      { query: STATE, headers: { "if-match": "*" } },
      rejecting(store, "get"),
    );
    expect(remove.status).toBe(500);
  });

  it("passes the signal of the options to every method", async () => {
    const store = memory();
    const controller = new AbortController();
    const seen: unknown[] = [];
    const watch =
      (inner: unknown) =>
      async (...args: readonly unknown[]) => {
        seen.push(args.at(-1));
        return (inner as (...values: readonly unknown[]) => unknown)(...args);
      };
    const documents = Object.fromEntries(
      Object.entries(store.documentStore).map(([name, method]) => [name, watch(method)]),
    );
    await putState(store, "hello");
    const changes = { documents: documents as never, signal: controller.signal };
    await send(
      store,
      "PUT",
      "/activities/state",
      { query: STATE, headers: { "content-type": "text/plain", "if-match": "*" }, body: "x" },
      changes,
    );
    await send(store, "DELETE", "/activities/state", { query: STATE, headers: { "if-match": "*" } }, changes);
    await send(store, "GET", "/agents/profile", { query: { agent: AGENT } }, changes);
    await send(store, "DELETE", "/activities/state", { query: { activityId: ACTIVITY, agent: AGENT } }, changes);
    expect(seen).toHaveLength(6);
    for (const options of seen) expect(options).toStrictEqual({ signal: controller.signal });
  });

  it.each([
    ["a document that is no object", () => "x", /The answer of DocumentStore\.get is invalid/u],
    [
      "a document without an ETag",
      () => ({ contentType: "a/b", body: new Uint8Array(), etag: "", updated: "2026-01-15T10:30:00Z" }),
      /etag/u,
    ],
    [
      "a document with a body that is text",
      () => ({ contentType: "a/b", body: "x", etag: '"x"', updated: "2026-01-15T10:30:00Z" }),
      /body/u,
    ],
    [
      "a document with a time that is no time",
      () => ({ contentType: "a/b", body: new Uint8Array(), etag: '"x"', updated: "soon" }),
      /updated/u,
    ],
  ])("throws a DataError for %s from get", async (_name, answer, message) => {
    const store = memory();
    const documents = { ...store.documentStore, get: async () => answer() as never };
    const request = send(store, "GET", "/activities/state", { query: STATE }, { documents });
    await expect(request).rejects.toThrow(DataError);
    await expect(request).rejects.toThrow(message);
  });

  it("throws a DataError for answers of write, delete and list that the contract does not have", async () => {
    const store = memory();
    await putState(store, "hello");
    const write = send(
      store,
      "PUT",
      "/activities/state",
      { query: STATE, headers: { "content-type": "a/b", "if-match": "*" } },
      {
        documents: { ...store.documentStore, write: async () => "maybe" as never },
      },
    );
    await expect(write).rejects.toThrow("The answer of DocumentStore.write is invalid");
    const remove = send(
      store,
      "DELETE",
      "/activities/state",
      { query: STATE, headers: { "if-match": "*" } },
      {
        documents: { ...store.documentStore, delete: async () => 3 as never },
      },
    );
    await expect(remove).rejects.toThrow("The answer of DocumentStore.delete is invalid");
    const list = send(
      store,
      "GET",
      "/agents/profile",
      { query: { agent: AGENT } },
      {
        documents: { ...store.documentStore, list: async () => [1] as never },
      },
    );
    await expect(list).rejects.toThrow("The answer of DocumentStore.list is invalid");
  });
});

describe("handleLrsRequest: Agents", () => {
  const ask = (agent: string, changes: Partial<LrsOptions> = {}, method = "GET") =>
    send(memory(), method, "/agents", { query: { agent } }, changes);

  it("returns a Person with the identifiers of the Agent as lists when the LRS knows no more", async () => {
    const cases = [
      [{ mbox: "mailto:a@example.org" }, { objectType: "Person", mbox: ["mailto:a@example.org"] }],
      [
        { name: "A", mbox_sha1sum: "a".repeat(40) },
        { objectType: "Person", name: ["A"], mbox_sha1sum: ["a".repeat(40)] },
      ],
      [{ openid: "https://a.example.org/" }, { objectType: "Person", openid: ["https://a.example.org/"] }],
      [
        { account: { homePage: "https://example.org", name: "a" } },
        { objectType: "Person", account: [{ homePage: "https://example.org", name: "a" }] },
      ],
    ] as const;
    for (const [agent, person] of cases) {
      const response = await ask(JSON.stringify(agent));
      expect(response.status).toBe(200);
      expect(jsonOf(response)).toStrictEqual(person);
    }
  });

  it("asks the store of Agents when the options have one, and checks what it answers", async () => {
    const asked: unknown[] = [];
    const agents = {
      person: async (agent: unknown) => {
        asked.push(agent);
        return { objectType: "Person", name: ["A", "B"], mbox: ["mailto:a@example.org", "mailto:b@example.org"] };
      },
    } as const;
    const response = await ask('{"mbox":"mailto:a@example.org"}', { agents: agents as never });
    expect(jsonOf(response)).toStrictEqual({
      objectType: "Person",
      name: ["A", "B"],
      mbox: ["mailto:a@example.org", "mailto:b@example.org"],
    });
    expect(asked).toStrictEqual([{ mbox: "mailto:a@example.org" }]);
    const bad = ask('{"mbox":"mailto:a@example.org"}', {
      agents: { person: async () => ({ objectType: "Person", name: "A" }) } as never,
    });
    await expect(bad).rejects.toThrow("The answer of AgentStore.person is invalid");
    const failing = await ask('{"mbox":"mailto:a@example.org"}', {
      agents: {
        person: async () => {
          throw new Error("down");
        },
      },
    });
    expect(failing.status).toBe(500);
    expect(reasonOf(failing)).toBe(FAILED);
  });

  it("answers 400 for no agent, an agent that is not an Agent, and a parameter that is not the resource's", async () => {
    const missing = await send(memory(), "GET", "/agents");
    expect(missing.status).toBe(400);
    expect(reasonOf(missing)).toBe("The request needs the parameter agent, the JSON of an Agent.");
    expect((await ask("{}")).status).toBe(400);
    expect((await ask('{"objectType":"Group","mbox":"mailto:g@x.org"}')).status).toBe(400);
    expect((await ask("nope")).status).toBe(400);
    const extra = await send(memory(), "GET", "/agents", { query: { agent: '{"mbox":"mailto:a@b.org"}', other: "1" } });
    expect(extra.status).toBe(400);
  });

  it("answers HEAD with no body, needs agents.read, and has no other method", async () => {
    const head = await ask('{"mbox":"mailto:a@example.org"}', {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    const denied = await send(
      memory(),
      "GET",
      "/agents",
      { query: { agent: '{"mbox":"mailto:a@example.org"}' } },
      {
        access: async () => ({
          allowed: true,
          authority: { mbox: "mailto:c@example.org" },
          actions: ["activities.read"],
        }),
      },
    );
    expect(denied.status).toBe(403);
    const put = await send(memory(), "PUT", "/agents");
    expect(put.status).toBe(405);
    expect(put.headers.allow).toBe("GET, HEAD");
  });
});

describe("handleLrsRequest: Activities", () => {
  const ask = (store: Memory, activityId: string | undefined, method = "GET") =>
    send(store, method, "/activities", { query: activityId === undefined ? {} : { activityId } });

  it("returns an Activity with only its id where the store holds no description", async () => {
    const response = await ask(memory(), ACTIVITY);
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual({ objectType: "Activity", id: ACTIVITY });
  });

  it("returns the Activity that the store holds, with its objectType", async () => {
    const store = memory();
    const definition = { name: { "en-US": "Course" }, type: "http://adlnet.gov/expapi/activities/course" };
    store.definitions.set(ACTIVITY, { id: ACTIVITY, definition });
    const response = await ask(store, ACTIVITY);
    expect(jsonOf(response)).toStrictEqual({ id: ACTIVITY, objectType: "Activity", definition });
  });

  it("accepts the Activity of the store whose id differs only in the case of its host", async () => {
    const store = memory();
    store.definitions.set(ACTIVITY, { id: "https://EXAMPLE.org/activities/course-1" });
    expect((await ask(store, ACTIVITY)).status).toBe(200);
  });

  it("throws a DataError for an Activity of another id, or one that is no Activity", async () => {
    const other = memory();
    other.definitions.set(ACTIVITY, { id: "https://example.org/activities/other" });
    await expect(ask(other, ACTIVITY)).rejects.toThrow(
      "The answer of ActivityStore.get is the Activity https://example.org/activities/other, and the request asked for https://example.org/activities/course-1.",
    );
    const broken = memory();
    broken.definitions.set(ACTIVITY, { id: ACTIVITY, definition: 5 } as never);
    await expect(ask(broken, ACTIVITY)).rejects.toThrow("The answer of ActivityStore.get is invalid");
  });

  it("answers 500 where the store rejects", async () => {
    const store = memory();
    const response = await send(
      store,
      "GET",
      "/activities",
      { query: { activityId: ACTIVITY } },
      {
        activities: {
          ...store.activities,
          get: async () => {
            throw new Error("down");
          },
        },
      },
    );
    expect(response.status).toBe(500);
    expect(reasonOf(response)).toBe(FAILED);
  });

  it("answers 400 for no activityId, one that is no IRI, and another parameter", async () => {
    expect((await ask(memory(), undefined)).status).toBe(400);
    expect((await ask(memory(), "relative")).status).toBe(400);
    const extra = await send(memory(), "GET", "/activities", { query: { activityId: ACTIVITY, other: "1" } });
    expect(extra.status).toBe(400);
  });

  it("answers HEAD with no body and needs activities.read", async () => {
    const head = await ask(memory(), ACTIVITY, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    const denied = await send(
      memory(),
      "GET",
      "/activities",
      { query: { activityId: ACTIVITY } },
      {
        access: async () => ({ allowed: true, authority: { mbox: "mailto:c@example.org" }, actions: ["agents.read"] }),
      },
    );
    expect(denied.status).toBe(403);
  });
});

describe("handleLrsRequest: About", () => {
  it("lists the versions of xAPI the LRS speaks, for a request with no version header or another one", async () => {
    const versions: readonly Record<string, string>[] = [
      { "x-experience-api-version": "" },
      { "x-experience-api-version": "3.0.0" },
      {},
    ];
    for (const headers of versions) {
      const request = { ...requestOf("GET", "/about"), headers };
      const response = await handleLrsRequest(request, optionsOf(memory()));
      expect(response.status).toBe(200);
      expect(response.headers["x-experience-api-version"]).toBe("2.0.0");
      expect(jsonOf(response)).toStrictEqual({ version: ["2.0.0", "1.0.3"] });
    }
  });

  it("adds the extensions of the options", async () => {
    const aboutExtensions = { "https://example.org/extensions/build": "42" };
    const response = await send(memory(), "GET", "/about", {}, { aboutExtensions });
    expect(jsonOf(response)).toStrictEqual({ version: ["2.0.0", "1.0.3"], extensions: aboutExtensions });
  });

  it("asks access, and needs no action", async () => {
    const asked: string[] = [];
    const allowed = await send(
      memory(),
      "GET",
      "/about",
      {},
      {
        access: async (request) => {
          asked.push(request.url);
          return { allowed: true, authority: { mbox: "mailto:c@example.org" }, actions: [] };
        },
      },
    );
    expect(allowed.status).toBe(200);
    expect(asked).toStrictEqual(["https://lrs.example.org/xapi/about"]);
    const refused = await send(
      memory(),
      "GET",
      "/about",
      {},
      {
        access: async () => ({ allowed: false, status: 401, reason: "Sign in.", challenge: 'Basic realm="xAPI"' }),
      },
    );
    expect(refused.status).toBe(401);
    expect(refused.headers["www-authenticate"]).toBe('Basic realm="xAPI"');
  });

  it("answers HEAD with no body, 400 for a parameter, and 405 for another method", async () => {
    const head = await send(memory(), "HEAD", "/about");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect((await send(memory(), "GET", "/about", { query: { a: "1" } })).status).toBe(400);
    const post = await send(memory(), "POST", "/about");
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
  });

  it("still asks for the version header on every other resource", async () => {
    const request = { ...requestOf("GET", "/agents", { query: { agent: AGENT } }), headers: {} };
    const response = await handleLrsRequest(request, optionsOf(memory()));
    expect(response.status).toBe(400);
  });
});

describe("handleLrsRequest: the options of the documents", () => {
  it("throws a DataError for a store of documents that is missing a method or has the wrong type", async () => {
    const store = memory();
    const { documents: _documents, ...rest } = optionsOf(store);
    await expect(handleLrsRequest(requestOf("GET", "/about"), rest as never)).rejects.toThrow(
      'The configuration of the LRS is invalid: missing the property "documents".',
    );
    await expect(
      handleLrsRequest(
        requestOf("GET", "/about"),
        optionsOf(store, { documents: { get: async () => undefined } as never }),
      ),
    ).rejects.toThrow("documents");
    await expect(
      handleLrsRequest(requestOf("GET", "/about"), optionsOf(store, { agents: { other: 1 } as never })),
    ).rejects.toThrow("agents");
  });

  it("throws a DataError for extensions that are no JSON object and limits that are no positive whole numbers", async () => {
    const store = memory();
    const bad = (changes: Record<string, unknown>) =>
      handleLrsRequest(requestOf("GET", "/about"), optionsOf(store, changes as never));
    await expect(bad({ aboutExtensions: [] })).rejects.toThrow("aboutExtensions");
    await expect(bad({ limits: { maxDocumentBytes: 0 } })).rejects.toThrow("maxDocumentBytes");
    await expect(bad({ limits: { mergeRetries: 1.5 } })).rejects.toThrow("mergeRetries");
  });
});
