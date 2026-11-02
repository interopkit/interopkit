import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { type FrameworkStore, handleCaseRequest } from "../src/provider/index.js";
import { id } from "./full-package.js";
import { DISCOVERY, jsonOf, memoryStore, request, serve, V11 } from "./provider-fixture.js";

const ITEM = `${V11}/CFItems/${id(2)}`;
const LIST = `${V11}/CFDocuments`;
const FILE = `${V11}/discovery/imscasev1p1_openapi3_v1p0.json`;
const DENIED = '{"allowed":false,"status":403}';
const UNAUTHENTICATED = '{"allowed":false,"status":401}';

/** An error with a message that the provider must not pass on. */
const SECRET = "connection to db.internal.example failed: password=hunter2";

/** Asserts the answer for a port that failed, which says nothing of the failure. */
function expectServerError(response: { status: number; body: string | Uint8Array }): void {
  expect(response.status).toBe(500);
  const text = String(response.body);
  expect(text).not.toContain("hunter2");
  expect(JSON.parse(text)).toMatchObject({
    imsx_codeMajor: "failure",
    imsx_severity: "error",
    imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldValue: "internal_server_error" }] },
  });
}

describe("authorize", () => {
  it("lets a request through that it allows", async () => {
    const authorize = () => Promise.resolve({ allowed: true } as const);
    expect((await serve(ITEM, { authorize })).status).toBe(200);
    expect((await serve(LIST, { authorize })).status).toBe(200);
  });

  it("is given the request and the signal of the options", async () => {
    const controller = new AbortController();
    const seen: { url: string; signal: AbortSignal | undefined }[] = [];
    const authorize = (asked: { url: string }, options?: { signal?: AbortSignal }) => {
      seen.push({ url: asked.url, signal: options?.signal });
      return Promise.resolve({ allowed: true } as const);
    };
    await serve(ITEM, { authorize, signal: controller.signal }, { headers: { authorization: "Bearer t" } });
    expect(seen).toStrictEqual([{ url: `https://case.example.org${ITEM}`, signal: controller.signal }]);
  });

  it("answers 401 with the challenge of a bearer token, and does not ask the store", async () => {
    const response = await serve(ITEM, { authorize: () => Promise.resolve(JSON.parse(UNAUTHENTICATED)) });
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(jsonOf(response)).toMatchObject({
      imsx_codeMajor: "failure",
      imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldValue: "unauthorised_request" }] },
    });
  });

  it("answers with the reason and the challenge that it gives", async () => {
    const decision =
      '{"allowed":false,"status":401,"reason":"The token expired.","challenge":"Bearer error=\\"invalid_token\\""}';
    const response = await serve(ITEM, { authorize: () => Promise.resolve(JSON.parse(decision)) });
    expect(response.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
    expect(jsonOf(response)).toMatchObject({ imsx_description: "The token expired." });
    const denied = await serve(LIST, {
      authorize: () => Promise.resolve(JSON.parse('{"allowed":false,"status":403,"reason":"Not for this tenant."}')),
    });
    expect(jsonOf(denied)).toMatchObject({ imsx_description: "Not for this tenant." });
  });

  it("answers 403 when the request is not allowed", async () => {
    const response = await serve(LIST, { authorize: () => Promise.resolve(JSON.parse(DENIED)) });
    expect(response.status).toBe(403);
    expect(jsonOf(response)).toMatchObject({
      imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldValue: "forbidden" }] },
    });
  });

  it("answers 429 server_busy for one request too many, with Retry-After when it gives the seconds", async () => {
    const busy = await serve(LIST, { authorize: () => Promise.resolve(JSON.parse('{"allowed":false,"status":429}')) });
    expect(busy.status).toBe(429);
    expect(busy.headers["retry-after"]).toBeUndefined();
    expect(jsonOf(busy)).toMatchObject({
      imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldValue: "server_busy" }] },
    });
    const later = await serve(ITEM, {
      authorize: () => Promise.resolve(JSON.parse('{"allowed":false,"status":429,"retryAfterSeconds":30}')),
    });
    expect(later.status).toBe(429);
    expect(later.headers["retry-after"]).toBe("30");
  });

  it("is not asked for a request to a path that is no endpoint, or a method that is not served", async () => {
    let asks = 0;
    const authorize = () => {
      asks += 1;
      return Promise.resolve(JSON.parse(DENIED));
    };
    expect((await serve("/other", { authorize })).status).toBe(404);
    expect((await serve(ITEM, { authorize }, { method: "POST" })).status).toBe(405);
    expect(asks).toBe(0);
  });

  it("is not asked for the discovery file, which a consumer reads to learn how to authenticate", async () => {
    const response = await serve(FILE, { authorize: () => Promise.resolve(JSON.parse(DENIED)) });
    expect(response.status).toBe(200);
  });

  it("answers 500 without the cause when it rejects, or throws", async () => {
    expectServerError(await serve(ITEM, { authorize: () => Promise.reject(new Error(SECRET)) }));
    expectServerError(
      await serve(ITEM, {
        authorize: () => {
          throw new Error(SECRET);
        },
      }),
    );
  });

  it.each([
    ["nothing", "undefined"],
    ["null", "null"],
    ["a boolean", "true"],
    ["a decision with no status", '{"allowed":false}'],
    ["a status that is not 401, 403 or 429", '{"allowed":false,"status":500}'],
    ["a wait that is not a whole number of seconds", '{"allowed":false,"status":429,"retryAfterSeconds":1.5}'],
    ["a decision that is not allowed or refused", '{"allowed":"yes"}'],
  ])("is a broken contract when it answers %s", async (_, json) => {
    const authorize = () => Promise.resolve(json === "undefined" ? undefined : JSON.parse(json));
    await expect(serve(ITEM, { authorize })).rejects.toThrow(DataError);
  });
});

describe("a store that fails", () => {
  const failing = (method: keyof FrameworkStore, failure: () => never | Promise<never>): FrameworkStore => ({
    ...memoryStore(),
    [method]: failure,
  });

  it("answers 500 without the cause when a lookup rejects", async () => {
    const store = failing("item", () => Promise.reject(new Error(SECRET)));
    expectServerError(await handleCaseRequest(request(ITEM), { store, discovery: DISCOVERY }));
  });

  it("answers 500 without the cause when a lookup throws before it returns a promise", async () => {
    const store = failing("item", () => {
      throw new Error(SECRET);
    });
    expectServerError(await handleCaseRequest(request(ITEM), { store, discovery: DISCOVERY }));
  });

  it("answers 500 without the cause when the list rejects", async () => {
    const store = failing("documents", () => Promise.reject(new Error(SECRET)));
    expectServerError(await handleCaseRequest(request(LIST), { store, discovery: DISCOVERY }));
  });

  it("answers 500 for a rejection that is not an error", async () => {
    const store = failing("item", () => Promise.reject(SECRET));
    expectServerError(await handleCaseRequest(request(ITEM), { store, discovery: DISCOVERY }));
  });

  it("is asked again by the next request", async () => {
    let asks = 0;
    const store: FrameworkStore = {
      ...memoryStore(),
      item: (...args) => {
        asks += 1;
        return asks === 1 ? Promise.reject(new Error(SECRET)) : memoryStore().item(...args);
      },
    };
    const options = { store, discovery: DISCOVERY };
    expect((await handleCaseRequest(request(ITEM), options)).status).toBe(500);
    expect((await handleCaseRequest(request(ITEM), options)).status).toBe(200);
  });

  it("ends the wait with the reason of the signal when it aborts, whatever the store does", async () => {
    const controller = new AbortController();
    const store = failing("item", () => new Promise<never>(() => undefined));
    const pending = handleCaseRequest(request(ITEM), { store, discovery: DISCOVERY, signal: controller.signal });
    controller.abort(new Error("the caller left"));
    await expect(pending).rejects.toThrow("the caller left");
  });

  it("rejects with the reason of a signal that aborted before the request", async () => {
    const reason = new Error("already aborted");
    const signal = AbortSignal.abort(reason);
    await expect(serve(ITEM, { signal })).rejects.toBe(reason);
    await expect(serve(LIST, { signal })).rejects.toBe(reason);
  });

  it("ends the wait for authorize when the signal aborts", async () => {
    const controller = new AbortController();
    const authorize = () => new Promise<never>(() => undefined);
    const pending = serve(ITEM, { authorize, signal: controller.signal });
    controller.abort(new Error("stop"));
    await expect(pending).rejects.toThrow("stop");
  });

  it("rejects with the abort and not with a 500 when the store fails because the signal aborted", async () => {
    const controller = new AbortController();
    const store = failing("item", () => {
      controller.abort(new Error("stopped"));
      return Promise.reject(new Error(SECRET));
    });
    const pending = handleCaseRequest(request(ITEM), { store, discovery: DISCOVERY, signal: controller.signal });
    await expect(pending).rejects.toThrow("stopped");
  });
});

describe("a store that breaks its contract", () => {
  const answering = (method: keyof FrameworkStore, value: string): FrameworkStore => ({
    ...memoryStore(),
    [method]: () => Promise.resolve(value === "undefined" ? undefined : JSON.parse(value)),
  });

  it.each([
    ["null for an identifier it does not hold", "null"],
    ["a string", '"item"'],
    ["a number", "5"],
    ["an array", "[]"],
  ])("is refused when a lookup answers %s", async (_, value) => {
    await expect(
      handleCaseRequest(request(ITEM), { store: answering("item", value), discovery: DISCOVERY }),
    ).rejects.toThrow("The answer of FrameworkStore is invalid: expected an object");
  });

  it.each([
    ["nothing", "undefined"],
    ["a list", "[]"],
    ["documents that are not a list", '{"documents":{},"total":0}'],
    ["a document that is not an object", '{"documents":[1],"total":1}'],
    ["no total", '{"documents":[]}'],
    ["a total that is negative", '{"documents":[],"total":-1}'],
    ["a total that is not whole", '{"documents":[],"total":1.5}'],
    ["a total that is a string", '{"documents":[],"total":"1"}'],
    ["a property it does not have", '{"documents":[],"total":0,"more":true}'],
  ])("is refused when the list answers %s", async (_, value) => {
    await expect(
      handleCaseRequest(request(LIST), { store: answering("documents", value), discovery: DISCOVERY }),
    ).rejects.toThrow("The answer of FrameworkStore.documents is invalid");
  });

  it("is refused when the list answers more documents than the limit", async () => {
    const store: FrameworkStore = {
      ...memoryStore(),
      documents: async (query, _page, options) => memoryStore().documents(query, { limit: 5, offset: 0 }, options),
    };
    await expect(handleCaseRequest(request(`${LIST}?limit=2`), { store, discovery: DISCOVERY })).rejects.toThrow(
      "The answer of FrameworkStore.documents has 5 documents for a limit of 2: it must return at most the limit.",
    );
  });
});
