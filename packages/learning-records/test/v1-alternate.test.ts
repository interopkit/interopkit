import type { HttpRequest } from "@interopkit/core/http";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Statement } from "../src/index.js";
import { type Access, handleLrsRequest, type LrsOptions } from "../src/store/index.js";
import { minimalStatement, uuid } from "./full-statement.js";
import { RUNS } from "./fuzz.js";
import { ALLOW_ALL, jsonOf, type Memory, memory, optionsOf, reasonOf, requestOf } from "./memory-lrs.js";

const FORM = { "content-type": "application/x-www-form-urlencoded" };
const V1 = { "x-experience-api-version": "1.0.3" };
const VERSION_FIELD = "X-Experience-API-Version";
const ACTIVITY = "https://example.org/activities/course-1";
const AGENT = JSON.stringify({ mbox: "mailto:learner@example.org" });

/** Encodes a form. */
function formOf(fields: Readonly<Record<string, string>>): string {
  return new URLSearchParams(fields).toString();
}

/** Builds a POST in the alternate syntax. */
function alternate(
  method: string,
  path: string,
  fields: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = { ...FORM, ...V1 },
): HttpRequest {
  return requestOf("POST", path, { query: { method }, headers, body: formOf(fields) });
}

/** Sends a POST in the alternate syntax to the stores of a memory. */
function send(store: Memory, request: HttpRequest, changes: Partial<LrsOptions> = {}) {
  return handleLrsRequest(request, optionsOf(store, changes));
}

/** The statement of a form, under an id. */
function statementOf(id: string): Statement {
  return { ...minimalStatement(), id };
}

describe("the alternate request syntax", () => {
  it("answers a GET whose parameters are in the form", async () => {
    const store = memory();
    for (const id of [uuid(1), uuid(2)]) {
      await send(store, alternate("PUT", "/statements", { statementId: id, content: JSON.stringify(statementOf(id)) }));
    }
    const answer = await send(store, alternate("GET", "/statements", { limit: "1" }));
    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toMatchObject({ statements: [{ id: uuid(2) }], more: expect.any(String) });
  });

  it("stores the content of a PUT, whose type is application/json when the form names none", async () => {
    const store = memory();
    const id = uuid(3);
    const answer = await send(
      store,
      alternate("PUT", "/statements", { statementId: id, content: JSON.stringify(statementOf(id)) }),
    );
    expect(answer.status).toBe(204);
    expect(store.held.has(id)).toBe(true);
  });

  it("reads the content as UTF-8", async () => {
    const store = memory();
    const id = uuid(4);
    const statement = { ...statementOf(id), verb: { id: "https://example.org/v", display: { id: "completed é" } } };
    const form = { statementId: id, content: JSON.stringify(statement) };
    expect((await send(store, alternate("PUT", "/statements", form))).status).toBe(204);
    expect(store.held.get(id)?.statement.verb.display).toStrictEqual({ id: "completed é" });
  });

  it("takes the version from the form, over the header of the request, and names it in the answer", async () => {
    const store = memory();
    const refused = await send(store, alternate("GET", "/statements", { [VERSION_FIELD]: "0.8" }));
    expect(refused.status).toBe(400);
    const answer = await send(store, alternate("GET", "/statements", { [VERSION_FIELD]: "1.0.1" }, FORM));
    expect(answer.status).toBe(200);
    expect(answer.headers["x-experience-api-version"]).toBe("1.0.3");
  });

  it("gives access the credential of the form, as a header", async () => {
    const store = memory();
    const seen: (string | undefined)[] = [];
    const access = async (request: HttpRequest): Promise<Access> => {
      seen.push(request.headers.authorization);
      return ALLOW_ALL;
    };
    await send(store, alternate("GET", "/statements", { Authorization: "Basic abc" }), { access });
    expect(seen).toStrictEqual(["Basic abc"]);
  });

  it("matches the names of the headers of the form in any case, and does not take them for parameters", async () => {
    const store = memory();
    const answer = await send(store, alternate("GET", "/statements", { "x-experience-api-version": "1.0.3" }, FORM));
    expect(answer.status).toBe(200);
  });

  it("does not take the length of the form for the length of the content, or for a parameter", async () => {
    const store = memory();
    const answer = await send(store, alternate("GET", "/statements", { "Content-Length": "7" }));
    expect(answer.status).toBe(200);
  });

  it("takes the preconditions of a document from the form", async () => {
    const store = memory();
    const document = { activityId: ACTIVITY, agent: AGENT, profileId: "notes" };
    const made = alternate("PUT", "/agents/profile", {
      ...document,
      "If-None-Match": "*",
      "Content-Type": "text/plain",
      content: "one",
    });
    const refused = await send(
      store,
      alternate("PUT", "/activities/profile", { ...document, agent: "", content: "x" }),
    );
    expect(refused.status).toBe(400);
    const { activityId: _activityId, ...agentProfile } = document;
    const written = await send(store, {
      ...made,
      body: new TextEncoder().encode(
        formOf({ ...agentProfile, "If-None-Match": "*", "Content-Type": "text/plain", content: "one" }),
      ),
    });
    expect(written.status).toBe(204);
    const [held] = store.documents.values();
    expect(held?.document.contentType).toBe("text/plain");
    const stale = await send(
      store,
      alternate("PUT", "/agents/profile", { ...agentProfile, "If-Match": '"stale"', content: "two" }),
    );
    expect(stale.status).toBe(412);
    const again = await send(
      store,
      alternate("PUT", "/agents/profile", { ...agentProfile, "If-None-Match": "*", content: "two" }),
    );
    expect(again.status).toBe(412);
  });

  it("answers a HEAD without a body, and About with its versions", async () => {
    const store = memory();
    const head = await send(store, alternate("HEAD", "/statements", {}));
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    const about = await send(store, alternate("GET", "/about", {}));
    expect(jsonOf(about)).toStrictEqual({ version: ["2.0.0", "1.0.3"] });
  });

  it("removes a document with a DELETE in the form", async () => {
    const store = memory();
    const state = { activityId: ACTIVITY, agent: AGENT, stateId: "bookmark" };
    await send(store, alternate("PUT", "/activities/state", { ...state, content: "{}" }));
    expect(store.documents.size).toBe(1);
    expect((await send(store, alternate("DELETE", "/activities/state", state))).status).toBe(204);
    expect(store.documents.size).toBe(0);
  });

  it("refuses a query parameter other than method, and says that it goes in the form", async () => {
    const store = memory();
    const id = uuid(5);
    const request = requestOf("POST", "/statements", {
      query: { method: "PUT", statementId: id },
      headers: { ...FORM, ...V1 },
      body: formOf({ content: JSON.stringify(statementOf(id)) }),
    });
    const answer = await send(store, request);
    expect(answer.status).toBe(400);
    expect(reasonOf(answer)).toBe(
      'A request in the alternate syntax has no query parameter but method, found "statementId": send them as form parameters.',
    );
    expect(store.held.size).toBe(0);
  });

  it.each(["get", "PATCH", "", "OPTIONS"])("refuses the method %j", async (method) => {
    const answer = await send(memory(), alternate(method, "/statements", {}));
    expect(answer.status).toBe(400);
    expect(reasonOf(answer)).toContain("The parameter method must be one of GET, HEAD, PUT, POST, DELETE");
  });

  it("refuses a body that is not a form, whatever its header says of it", async () => {
    const store = memory();
    const notForm = requestOf("POST", "/statements", {
      query: { method: "PUT" },
      headers: { "content-type": "application/json", ...V1 },
      body: "{}",
    });
    expect((await send(store, notForm)).status).toBe(400);
    const noType = requestOf("POST", "/statements", { query: { method: "PUT" }, headers: V1 });
    expect((await send(store, noType)).status).toBe(400);
    const json = requestOf("POST", "/statements", {
      query: { method: "PUT" },
      headers: { ...FORM, ...V1 },
      body: JSON.stringify({ statementId: uuid(6), content: "x" }),
    });
    expect((await send(store, json)).status).toBe(400);
    const bytes = requestOf("POST", "/statements", {
      query: { method: "PUT" },
      headers: { ...FORM, ...V1 },
      body: new Uint8Array([0xff, 0xfe]),
    });
    expect((await send(store, bytes)).status).toBe(400);
  });

  it("refuses a parameter given twice in the form", async () => {
    const store = memory();
    const request = requestOf("POST", "/statements", {
      query: { method: "GET" },
      headers: { ...FORM, ...V1 },
      body: "limit=1&limit=2",
    });
    expect((await send(store, request)).status).toBe(400);
  });

  it("refuses a parameter of the form that the resource does not have", async () => {
    const answer = await send(memory(), alternate("GET", "/statements", { color: "blue" }));
    expect(answer.status).toBe(400);
    expect(reasonOf(answer)).toContain('"color"');
  });

  it("refuses a form of more parameters than a request has, unread", async () => {
    const fields = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`name${index}`, "x"]));
    const answer = await send(memory(), alternate("GET", "/statements", fields));
    expect(answer.status).toBe(400);
    expect(reasonOf(answer)).toBe("The form has more than 32 parameters.");
  });

  it("takes a form of as many parameters as the limit", async () => {
    const fields = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`name${index}`, "x"]));
    const answer = await send(memory(), alternate("GET", "/statements", fields));
    expect(reasonOf(answer)).toContain('"name0"');
  });

  it("refuses a PUT with no content", async () => {
    const answer = await send(memory(), alternate("PUT", "/statements", { statementId: uuid(7) }));
    expect(answer.status).toBe(400);
  });

  it("refuses a body over the limit with 413 before anything is read or asked", async () => {
    const store = memory();
    let asked = false;
    const access = async (): Promise<Access> => {
      asked = true;
      return ALLOW_ALL;
    };
    const answer = await send(store, alternate("PUT", "/statements", { content: "x".repeat(64) }), {
      access,
      limits: { maxBodyBytes: 16 },
    });
    expect(answer.status).toBe(413);
    expect(asked).toBe(false);
  });

  it("refuses the syntax on the route of 2.0, which has none", async () => {
    const answer = await send(
      memory(),
      alternate("GET", "/statements", {}, { ...FORM, "x-experience-api-version": "2.0.0" }),
    );
    expect(answer.status).toBe(400);
    expect(reasonOf(answer)).toBe(
      "The alternate request syntax is a part of xAPI 1.0.3, and xAPI 2.0.0 has no such syntax.",
    );
    expect(answer.headers["x-experience-api-version"]).toBe("2.0.0");
  });

  it("refuses the syntax when the LRS does not serve 1.0.3", async () => {
    const answer = await send(memory(), alternate("GET", "/statements", {}), { versions: ["2.0.0"] });
    expect(answer.status).toBe(400);
  });

  it("does not take a method in the query of a request that is not a POST for the syntax", async () => {
    const request = requestOf("PUT", "/statements", {
      query: { method: "POST" },
      headers: { ...FORM, ...V1 },
      body: formOf({ content: "{}" }),
    });
    expect((await send(memory(), request)).status).toBe(400);
  });

  it("answers every form with a status and throws nothing, whatever the method, the fields and the body", async () => {
    const field = fc.constantFrom(
      "content",
      "statementId",
      "limit",
      VERSION_FIELD,
      "Authorization",
      "Content-Type",
      "Content-Length",
      "If-Match",
      "If-None-Match",
      "activityId",
      "agent",
      "__proto__",
      "constructor",
    );
    const value = fc.oneof(fc.string({ maxLength: 40 }), fc.constantFrom("1.0.3", "2.0.0", "application/json", "*"));
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", ""),
        fc.constantFrom("/statements", "/activities/state", "/agents/profile", "/about", "/agents", "/activities"),
        fc.dictionary(field, value, { maxKeys: 6 }),
        fc.boolean(),
        async (method, path, fields, form) => {
          const answer = await send(memory(), alternate(method, path, fields, form ? { ...FORM, ...V1 } : V1));
          expect(answer.status).toBeGreaterThanOrEqual(200);
          expect(answer.status).toBeLessThan(500);
          expect(["2.0.0", "1.0.3"]).toContain(answer.headers["x-experience-api-version"]);
        },
      ),
      RUNS,
    );
  });
});
