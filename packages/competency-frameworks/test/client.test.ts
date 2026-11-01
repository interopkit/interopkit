import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import {
  type CaseClient,
  type CaseClientConfig,
  caseFilter,
  createCaseClient,
  readStatusInfo,
} from "../src/client/index.js";
import { hasNextLink, totalCountOf } from "../src/client/internal.js";
import type { CasePackage, CFDocument } from "../src/index.js";
import { type FakeProvider, fakeProvider, type Reply } from "./fake-provider.js";
import { copyOf } from "./fixture.js";
import { fullEntities, fullPackage, id } from "./full-package.js";

const BASE = "https://case.example.edu";
const ROOT = `${BASE}/ims/case/v1p1`;
const entities = fullEntities();

/** The calls that fetch one entity by identifier, with the path each uses and what the provider answers. */
const ENDPOINTS = [
  { call: "document", collection: "CFDocuments", answer: entities.CFDocument },
  { call: "package", collection: "CFPackages", answer: fullPackage() },
  { call: "item", collection: "CFItems", answer: entities.CFItem },
  { call: "itemAssociations", collection: "CFItemAssociations", answer: entities.CFAssociationSet },
  { call: "association", collection: "CFAssociations", answer: entities.CFAssociation },
  { call: "associationGrouping", collection: "CFAssociationGroupings", answer: entities.CFAssociationGrouping },
  { call: "concept", collection: "CFConcepts", answer: entities.CFConceptSet },
  { call: "subject", collection: "CFSubjects", answer: entities.CFSubjectSet },
  { call: "license", collection: "CFLicenses", answer: entities.CFLicense },
  { call: "itemType", collection: "CFItemTypes", answer: entities.CFItemTypeSet },
  { call: "rubric", collection: "CFRubrics", answer: entities.CFRubric },
] as const;

/** A client of a provider, with the configuration of a test. */
function clientOf(provider: FakeProvider, config: Partial<CaseClientConfig> = {}): CaseClient {
  return createCaseClient({ baseUrl: BASE, fetch: provider.fetch, ...config });
}

/** What a rejected promise rejected with. */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("The promise resolved.");
}

/** Everything that an iteration gives, or the error it ends with. */
async function collect<TItem>(items: AsyncIterable<TItem>): Promise<TItem[]> {
  const found: TItem[] = [];
  for await (const item of items) found.push(item);
  return found;
}

/** Configuration as a host passes it from JavaScript or JSON. */
const fromJson = <TValue>(text: string): TValue => JSON.parse(text);

describe("createCaseClient: the configuration", () => {
  const provider = fakeProvider(() => ({ status: 404 }));

  it("accepts a base and a fetch, and nothing else", () => {
    expect(createCaseClient({ baseUrl: BASE, fetch: provider.fetch })).toBeDefined();
  });

  it("refuses a configuration that is not an object, and an option that it does not have", () => {
    expect(() => createCaseClient(fromJson("null"))).toThrow("The configuration of the client is invalid");
    expect(() => createCaseClient(fromJson("[]"))).toThrow(DataError);
    expect(() =>
      createCaseClient({ baseUrl: BASE, fetch: provider.fetch, ...fromJson<object>('{"baseURL":"x"}') }),
    ).toThrow('The configuration of the client is invalid: unexpected property "baseURL".');
  });

  it("refuses a base that is not an https address without credentials, a query or a fragment", () => {
    for (const baseUrl of [
      "http://case.example.edu",
      "case.example.edu",
      `${BASE}?a=1`,
      `${BASE}#x`,
      "https://user:secret@case.example.edu",
      `${ROOT}`,
      `${BASE}/ims/case/v1p0/`,
    ]) {
      expect(() => createCaseClient({ baseUrl, fetch: provider.fetch })).toThrow(DataError);
    }
    expect(() => createCaseClient(fromJson('{"baseUrl":5}'))).toThrow("baseUrl: expected a string");
  });

  it("refuses a fetch, an authorization, a signal, a version and limits of the wrong kind", () => {
    const base = { baseUrl: BASE, fetch: provider.fetch };
    const bad = (extra: string) => () => createCaseClient({ ...base, ...fromJson<object>(extra) });
    expect(() => createCaseClient(fromJson<CaseClientConfig>(`{"baseUrl":"${BASE}","fetch":"x"}`))).toThrow(
      "fetch: expected a function",
    );
    expect(bad('{"authorization":"Bearer x"}')).toThrow("authorization: expected a function");
    expect(bad('{"signal":{}}')).toThrow("signal: expected an AbortSignal");
    expect(bad('{"version":"2.0"}')).toThrow('version: expected "1.0" or "1.1"');
    for (const option of ["timeoutMs", "maxBytes", "pageSize"]) {
      for (const value of ["0", "-1", "1.5", '"5"', "null"]) expect(bad(`{"${option}":${value}}`)).toThrow(DataError);
    }
  });
});

describe("the calls that fetch one entity", () => {
  it.each(ENDPOINTS)("$call asks GET $collection/{id} and reads the answer", async ({ call, collection, answer }) => {
    const provider = fakeProvider(() => ({ body: answer }));
    const found = await clientOf(provider)[call](id(7));
    expect(found).toStrictEqual(answer);
    expect(provider.requests).toHaveLength(1);
    const [request] = provider.requests;
    expect(request?.url).toBe(`${ROOT}/${collection}/${id(7)}`);
    expect(request?.init).toMatchObject({ method: "GET", redirect: "manual", headers: { accept: "application/json" } });
  });

  it.each(ENDPOINTS)("$call gives undefined for an object that the provider does not know", async ({ call }) => {
    const provider = fakeProvider(() => ({ status: 404, body: entities.imsx_StatusInfo }));
    expect(await clientOf(provider)[call](id(7))).toBeUndefined();
  });

  it.each(ENDPOINTS)("$call returns a copy that shares nothing with the answer", async ({ call, answer }) => {
    const served = copyOf(answer);
    const found = await clientOf(fakeProvider(() => ({ body: served })))[call](id(7));
    expect(found).not.toBe(served);
  });

  it("asks for the path of 1.0 and reads the answer by the rules of 1.0 when the version is 1.0", async () => {
    const provider = fakeProvider(() => ({ body: entities.CFItem }));
    const client = clientOf(provider, { version: "1.0" });
    const error = await failureOf(client.item(id(7)));
    expect(provider.requests[0]?.url).toBe(`${BASE}/ims/case/v1p0/CFItems/${id(7)}`);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain("answered with data that is not valid CASE");
    const plain = { ...entities.CFItem } as Record<string, unknown>;
    delete plain.extensions;
    delete plain.subject;
    delete plain.subjectURI;
    const answered = fakeProvider(() => ({ body: plain }));
    expect(await clientOf(answered, { version: "1.0" }).item(id(7))).toMatchObject({ identifier: plain.identifier });
  });

  it("keeps the path of the base", async () => {
    const provider = fakeProvider(() => ({ body: entities.CFItem }));
    await clientOf(provider, { baseUrl: `${BASE}/standards/` }).item(id(7));
    expect(provider.requests[0]?.url).toBe(`${BASE}/standards/ims/case/v1p1/CFItems/${id(7)}`);
  });

  it("encodes an identifier that is not a UUID so that it stays one segment of the path", async () => {
    const provider = fakeProvider(() => ({ status: 404 }));
    await clientOf(provider).item("a/b?c#d e");
    expect(provider.requests[0]?.url).toBe(`${ROOT}/CFItems/a%2Fb%3Fc%23d%20e`);
  });

  it("refuses an identifier that is empty, not a string, or would change the path, before any request", async () => {
    const provider = fakeProvider(() => ({ status: 404 }));
    const client = clientOf(provider);
    for (const identifier of ["", "..", ".", fromJson<string>("5"), fromJson<string>("null")]) {
      expect(await failureOf(client.item(identifier))).toBeInstanceOf(DataError);
    }
    expect(provider.requests).toHaveLength(0);
  });

  it("throws a ServiceError with the status, the headers and the body for any other status", async () => {
    const status = { ...entities.imsx_StatusInfo };
    const provider = fakeProvider(() => ({ status: 429, headers: { "Retry-After": "30" }, body: status }));
    const error = await failureOf(clientOf(provider).item(id(7)));
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 429, headers: { "retry-after": "30" }, body: JSON.stringify(status) });
  });

  it("throws a ServiceError for a redirect and does not follow it", async () => {
    const provider = fakeProvider(() => ({ status: 302, headers: { location: "http://elsewhere.example/" } }));
    const error = await failureOf(clientOf(provider).item(id(7)));
    expect(error).toMatchObject({ status: 302 });
    expect(provider.requests).toHaveLength(1);
  });

  it("throws a DataError that names the provider and the first fault for an answer that is not valid CASE", async () => {
    const invalid = { ...entities.CFItem, fullStatement: 5 };
    const provider = fakeProvider(() => ({ body: invalid }));
    const error = await failureOf(clientOf(provider).item(id(7)));
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toBe(
      `The CASE provider at ${ROOT}/CFItems/${id(7)} answered with data that is not valid CASE: The CFItem is invalid at fullStatement: expected a string, found 5.`,
    );
  });

  it("throws a DataError for an answer that is not JSON, and for one that is not UTF-8", async () => {
    for (const body of ["<html>", ""]) {
      const error = await failureOf(clientOf(fakeProvider(() => ({ body }))).item(id(7)));
      expect(error).toMatchObject({
        message: `The CASE provider at ${ROOT}/CFItems/${id(7)} answered with a body that is not JSON.`,
      });
    }
    const bytes = fakeProvider(() => ({ body: "x" }));
    const latin = async () => new Response(new Uint8Array([0x7b, 0xe9, 0x7d]), { status: 200 });
    const client = createCaseClient({ baseUrl: BASE, fetch: latin });
    expect(await failureOf(client.item(id(7)))).toBeInstanceOf(DataError);
    expect(bytes.requests).toHaveLength(0);
  });

  it("refuses an answer of more than the most bytes, naming the limit", async () => {
    const provider = fakeProvider(() => ({ body: entities.CFItem }));
    const error = await failureOf(clientOf(provider, { maxBytes: 100 }).item(id(7)));
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).message).toContain("answered with more than 100 bytes");
  });

  it("reads a package as large as the default limit allows", async () => {
    const pkg: CasePackage = fullPackage();
    const provider = fakeProvider(() => ({ body: pkg }));
    expect(await clientOf(provider).package(id(1))).toStrictEqual(pkg);
  });
});

describe("the deadline and the signals", () => {
  it("ends a request at timeoutMs with a ServiceError of status 0", async () => {
    const hanging = fakeProvider(() => new Promise<Reply>(() => undefined));
    const error = await failureOf(clientOf(hanging, { timeoutMs: 20 }).item(id(7)));
    expect(error).toMatchObject({ status: 0 });
    expect((error as ServiceError).message).toContain("did not answer within 20 ms");
  });

  it("ends the wait of a caller whose signal aborts, with the reason of the signal", async () => {
    const hanging = fakeProvider(() => new Promise<Reply>(() => undefined));
    const abort = new AbortController();
    const waiting = failureOf(clientOf(hanging).item(id(7), { signal: abort.signal }));
    await Promise.resolve();
    abort.abort(new Error("stop"));
    expect(await waiting).toMatchObject({ message: "stop" });
  });

  it("ends the wait of every call when the signal of the configuration aborts", async () => {
    const abort = new AbortController();
    abort.abort(new Error("shut down"));
    const provider = fakeProvider(() => ({ body: entities.CFItem }));
    expect(await failureOf(clientOf(provider, { signal: abort.signal }).item(id(7)))).toMatchObject({
      message: "shut down",
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("refuses options that are not an object and a signal that is not one", async () => {
    const client = clientOf(fakeProvider(() => ({ status: 404 })));
    expect(await failureOf(client.item(id(7), fromJson("null")))).toBeInstanceOf(DataError);
    expect(await failureOf(client.item(id(7), fromJson('{"signal":{}}')))).toBeInstanceOf(DataError);
  });
});

describe("the credential", () => {
  it("is asked for before every request and sent as the Authorization header", async () => {
    let issued = 0;
    const provider = fakeProvider(() => ({ body: entities.CFItem }));
    const client = clientOf(provider, { authorization: async () => `Bearer token-${++issued}` });
    await client.item(id(7));
    await client.item(id(7));
    expect(provider.requests.map(({ init }) => init.headers.authorization)).toStrictEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  it("sends none when the function gives undefined", async () => {
    const provider = fakeProvider(() => ({ body: entities.CFItem }));
    await clientOf(provider, { authorization: async () => undefined }).item(id(7));
    expect(provider.requests[0]?.init.headers).toStrictEqual({ accept: "application/json" });
  });

  it("hands the function the signal of the call and of the configuration", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const provider = fakeProvider(() => ({ body: entities.CFItem }));
    const control = new AbortController();
    const client = clientOf(provider, {
      authorization: async (options) => {
        seen.push(options?.signal);
        return undefined;
      },
    });
    await client.item(id(7));
    await client.item(id(7), { signal: control.signal });
    expect(seen[0]).toBeUndefined();
    control.abort();
    expect(seen[1]?.aborted).toBe(true);
  });

  it("refuses a value that could split the header, an empty value and a value that is not text, before any request", async () => {
    for (const value of ["Bearer a\r\nX-Evil: 1", "Bearer a\nb", "", 5]) {
      const provider = fakeProvider(() => ({ body: entities.CFItem }));
      const client = clientOf(provider, { authorization: async () => value as never });
      expect(await failureOf(client.item(id(7)))).toBeInstanceOf(DataError);
      expect(provider.requests).toHaveLength(0);
    }
  });

  it("lets the error of the function through and sends nothing", async () => {
    const provider = fakeProvider(() => ({ body: entities.CFItem }));
    const client = clientOf(provider, {
      authorization: async () => {
        throw new Error("The token service is down.");
      },
    });
    expect(await failureOf(client.item(id(7)))).toMatchObject({ message: "The token service is down." });
    expect(provider.requests).toHaveLength(0);
  });

  it("does not print the credential in an error", async () => {
    const provider = fakeProvider(() => ({ status: 401, body: "denied" }));
    const client = clientOf(provider, { authorization: async () => "Bearer secret-token-value" });
    const error = (await failureOf(client.item(id(7)))) as ServiceError;
    expect(`${error.message} ${error.body}`).not.toContain("secret-token-value");
  });
});

describe("the discovery file", () => {
  const document = {
    openapi: "3.0.1",
    info: { title: "CASE", version: "1.1" },
    paths: { "/CFDocuments": {} },
    servers: [],
  };

  it("is fetched from the discovery folder of the version and read", async () => {
    const provider = fakeProvider(() => ({ body: document }));
    expect(await clientOf(provider).discovery()).toStrictEqual(document);
    expect(provider.requests[0]?.url).toBe(`${ROOT}/discovery/imscasev1p1_openapi3_v1p0.json`);
  });

  it("is refused for a client of 1.0, which defines no such file", async () => {
    const provider = fakeProvider(() => ({ body: document }));
    expect(await failureOf(clientOf(provider, { version: "1.0" }).discovery())).toMatchObject({
      message: 'CASE 1.0 defines no discovery file: create the client with the option version "1.1".',
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("throws a DataError for a file that is not an OpenAPI 3 document, and a ServiceError for a missing one", async () => {
    const invalid = fakeProvider(() => ({ body: { openapi: "2.0" } }));
    expect(await failureOf(clientOf(invalid).discovery())).toBeInstanceOf(DataError);
    const missing = fakeProvider(() => ({ status: 404 }));
    expect(await failureOf(clientOf(missing).discovery())).toMatchObject({ status: 404 });
  });
});

/** The documents of a provider with `count` documents, numbered from 100. */
function manyDocuments(count: number): CFDocument[] {
  return Array.from({ length: count }, (_, at) => ({
    ...entities.CFDocument,
    identifier: id(100 + at),
    title: `Framework ${at}`,
  }));
}

/** The reply of a provider that serves `documents` by `limit` and `offset`, with the headers a test asks for. */
function page(documents: readonly CFDocument[], url: URL, headers: "count" | "link" | "none" | "both"): Reply {
  const limit = Number(url.searchParams.get("limit"));
  const offset = Number(url.searchParams.get("offset"));
  const slice = documents.slice(offset, offset + limit);
  const next = offset + limit < documents.length;
  const reply: Record<string, string> = {};
  if (headers === "count" || headers === "both") reply["X-Total-Count"] = String(documents.length);
  if ((headers === "link" || headers === "both") && next) {
    reply.Link = `<${ROOT}/CFDocuments?limit=${limit}&offset=${offset + limit}>; rel="next", <${ROOT}/CFDocuments?limit=${limit}&offset=0>; rel="first"`;
  }
  if (headers === "link" && !next) reply.Link = `<${ROOT}/CFDocuments?limit=${limit}&offset=0>; rel="first"`;
  return slice.length === 0 ? { status: 404 } : { headers: reply, body: { CFDocuments: slice } };
}

describe("documents: paging", () => {
  const all = manyDocuments(250);
  const offsets = (provider: FakeProvider) =>
    provider.requests.map(({ url }) => new URL(url).searchParams.get("offset"));

  it.each(["count", "link", "both", "none"] as const)(
    "reads every page in order when the provider sends %s",
    async (headers) => {
      const provider = fakeProvider((url) => page(all, url, headers));
      const found = await collect(clientOf(provider).documents());
      expect(found.map(({ identifier }) => identifier)).toStrictEqual(all.map(({ identifier }) => identifier));
      expect(offsets(provider).slice(0, 3)).toStrictEqual(["0", "100", "200"]);
    },
  );

  it("asks for no page after the last one when the provider gives the count", async () => {
    const provider = fakeProvider((url) => page(all, url, "count"));
    await collect(clientOf(provider).documents());
    expect(offsets(provider)).toStrictEqual(["0", "100", "200"]);
  });

  it("asks for no page after the last one when the provider's Link has no next", async () => {
    const provider = fakeProvider((url) => page(all, url, "link"));
    await collect(clientOf(provider).documents());
    expect(offsets(provider)).toStrictEqual(["0", "100", "200"]);
  });

  it("stops at a Link without next even when the page is full", async () => {
    const exact = manyDocuments(200);
    const provider = fakeProvider((url) => page(exact, url, "link"));
    expect(await collect(clientOf(provider).documents())).toHaveLength(200);
    expect(offsets(provider)).toStrictEqual(["0", "100"]);
  });

  it("asks once more when a page is full and nothing else says it is the last, and stops at the answer of 404", async () => {
    const exact = manyDocuments(200);
    const provider = fakeProvider((url) => page(exact, url, "none"));
    expect(await collect(clientOf(provider).documents())).toHaveLength(200);
    expect(offsets(provider)).toStrictEqual(["0", "100", "200"]);
  });

  it("stops at an empty list for an offset past the end", async () => {
    const exact = manyDocuments(100);
    const provider = fakeProvider((url) =>
      Number(url.searchParams.get("offset")) >= 100 ? { body: { CFDocuments: [] } } : page(exact, url, "none"),
    );
    expect(await collect(clientOf(provider).documents())).toHaveLength(100);
  });

  it("follows the page size of the configuration, and stops by the count even when the provider caps the page lower", async () => {
    const provider = fakeProvider((url) => {
      const capped = new URL(url);
      capped.searchParams.set("limit", "30");
      return page(all, capped, "count");
    });
    const found = await collect(clientOf(provider, { pageSize: 500 }).documents());
    expect(found).toHaveLength(250);
    expect(new URL(provider.requests[0]?.url ?? "").searchParams.get("limit")).toBe("500");
    expect(offsets(provider)).toStrictEqual(["0", "30", "60", "90", "120", "150", "180", "210", "240"]);
  });

  it("gives a document once when the collection shifts between pages", async () => {
    let calls = 0;
    const provider = fakeProvider((url) => {
      calls += 1;
      // A document arrives before the second request, so the last of page one is the first of page two.
      const shifted = calls === 1 ? all : [manyDocuments(1)[0] as CFDocument, ...all];
      const reply = page(shifted, url, "none");
      return reply;
    });
    const found = await collect(clientOf(provider, { pageSize: 100 }).documents());
    const identifiers = found.map(({ identifier }) => identifier);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it("stops when a page holds only documents already given, as a provider that ignores the offset does", async () => {
    const same = manyDocuments(100);
    const provider = fakeProvider(() => ({ body: { CFDocuments: same } }));
    expect(await collect(clientOf(provider).documents())).toHaveLength(100);
    expect(provider.requests).toHaveLength(2);
  });

  it("asks for nothing more when the caller stops the iteration", async () => {
    const provider = fakeProvider((url) => page(all, url, "count"));
    for await (const document of clientOf(provider).documents()) {
      expect(document.identifier).toBe(id(100));
      break;
    }
    expect(provider.requests).toHaveLength(1);
  });

  it("gives nothing for an empty first page and fails for a collection that is missing", async () => {
    const empty = fakeProvider(() => ({ body: { CFDocuments: [] } }));
    expect(await collect(clientOf(empty).documents())).toStrictEqual([]);
    const missing = fakeProvider(() => ({ status: 404 }));
    expect(await failureOf(collect(clientOf(missing).documents()))).toMatchObject({ status: 404 });
  });

  it("ends with the signal of the call between pages", async () => {
    const abort = new AbortController();
    const provider = fakeProvider((url) => {
      const reply = page(all, url, "count");
      abort.abort(new Error("enough"));
      return reply;
    });
    expect(await failureOf(collect(clientOf(provider).documents(undefined, { signal: abort.signal })))).toMatchObject({
      message: "enough",
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("carries the headers of a refusal on the second page, so that Retry-After is known", async () => {
    const provider = fakeProvider((url) =>
      Number(url.searchParams.get("offset")) === 0
        ? page(all, url, "count")
        : { status: 429, headers: { "Retry-After": "12" }, body: entities.imsx_StatusInfo },
    );
    const error = await failureOf(collect(clientOf(provider).documents()));
    expect(error).toMatchObject({ status: 429, headers: { "retry-after": "12" } });
  });

  it("throws a DataError for a page that is not valid CASE, and names the document", async () => {
    const provider = fakeProvider(() => ({ body: { CFDocuments: [{ ...entities.CFDocument, title: 5 }] } }));
    const error = await failureOf(collect(clientOf(provider).documents()));
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain("CFDocuments[0].title: expected a string, found 5");
  });
});

describe("documents: the query", () => {
  const found = async (query: object | undefined) => {
    const provider = fakeProvider(() => ({
      body: { CFDocuments: [entities.CFDocument] },
      headers: { "X-Total-Count": "1" },
    }));
    await collect(clientOf(provider).documents(query as never));
    return new URL(provider.requests[0]?.url ?? "");
  };

  it("sends the limit and the offset first", async () => {
    expect((await found(undefined)).search).toBe("?limit=100&offset=0");
  });

  it("sends the sort, the order, the filter and the fields as the binding writes them", async () => {
    const url = await found({
      sort: "title",
      orderBy: "desc",
      filter: { field: "version", predicate: "=", value: "1.0" },
      fields: ["identifier", "extensions.level"],
    });
    expect(url.search).toBe(
      "?limit=100&offset=0&sort=title&orderBy=desc&filter=version%3D%271.0%27&fields=identifier,extensions.level",
    );
  });

  it("encodes a space as %20 and the quote and the marks of RFC 3986 as the binding's example does", async () => {
    const url = await found({
      filter: {
        and: [
          { field: "version", predicate: "=", value: "1.0" },
          { field: "lastChangeDateTime", predicate: ">", value: "2016-12-12T00:00:00Z" },
        ],
      },
    });
    expect(url.search).toBe(
      "?limit=100&offset=0&filter=version%3D%271.0%27%20AND%20lastChangeDateTime%3E%272016-12-12T00%3A00%3A00Z%27",
    );
    expect(url.searchParams.get("filter")).toBe("version='1.0' AND lastChangeDateTime>'2016-12-12T00:00:00Z'");
    const marks = await found({ filter: { field: "title", predicate: "~", value: "a (b)*!&=#" } });
    expect(marks.search).toContain("filter=title~%27a%20%28b%29%2A%21%26%3D%23%27");
  });

  it("keeps the query on every page", async () => {
    const all = manyDocuments(150);
    const provider = fakeProvider((url) => page(all, url, "count"));
    await collect(clientOf(provider).documents({ sort: "title" }));
    expect(provider.paths()).toStrictEqual([
      "/ims/case/v1p1/CFDocuments?limit=100&offset=0&sort=title",
      "/ims/case/v1p1/CFDocuments?limit=100&offset=100&sort=title",
    ]);
  });

  it.each([
    ["a query that is not an object", "5"],
    ["a property that a query does not have", '{"limit":5}'],
    ["a sort that is not a field", '{"sort":"title desc"}'],
    ["a sort that is empty", '{"sort":""}'],
    ["an order that is neither asc nor desc", '{"orderBy":"up"}'],
    ["fields that are not a list", '{"fields":"identifier"}'],
    ["fields that are empty", '{"fields":[]}'],
    ["a field that is not a name", '{"fields":["a,b"]}'],
    ["a filter that is not an object", '{"filter":"a=b"}'],
    ["a predicate that does not exist", '{"filter":{"field":"a","predicate":"==","value":"b"}}'],
    ["a value that is not text", '{"filter":{"field":"a","predicate":"=","value":5}}'],
    ["a comparison with another property", '{"filter":{"field":"a","predicate":"=","value":"b","extra":1}}'],
    ["a logical operator with one comparison", '{"filter":{"and":[{"field":"a","predicate":"=","value":"b"}]}}'],
    [
      "a logical operator with three comparisons",
      '{"filter":{"or":[{"field":"a","predicate":"=","value":"b"},{"field":"a","predicate":"=","value":"b"},{"field":"a","predicate":"=","value":"b"}]}}',
    ],
    ["both logical operators", '{"filter":{"and":[],"or":[]}}'],
  ])("refuses %s before any request", (_, text) => {
    const provider = fakeProvider(() => ({ body: { CFDocuments: [entities.CFDocument] } }));
    expect(() => clientOf(provider).documents(fromJson(text))).toThrow(DataError);
    expect(provider.requests).toHaveLength(0);
  });
});

describe("documents: the fields asked for", () => {
  const query = { fields: ["identifier", "lastChangeDateTime"] };

  it("gives the documents with only those fields, which a whole document would not be", async () => {
    const selected = [
      { identifier: id(1), lastChangeDateTime: "2024-06-13T18:46:03+00:00" },
      { identifier: id(2), lastChangeDateTime: "2024-06-14T18:46:03+00:00" },
    ];
    const provider = fakeProvider(() => ({ body: { CFDocuments: selected }, headers: { "X-Total-Count": "2" } }));
    const found = await collect(clientOf(provider).documents(query));
    expect(found).toStrictEqual(selected);
    expect(found[0]?.lastChangeDateTime).toBe("2024-06-13T18:46:03+00:00");
  });

  it("refuses a field that has the wrong form and a property that the class does not have", async () => {
    for (const bad of [{ identifier: id(1), lastChangeDateTime: 5 }, { identifier: id(1), color: "red" }, "text"]) {
      const provider = fakeProvider(() => ({ body: { CFDocuments: [bad] } }));
      const error = await failureOf(collect(clientOf(provider).documents(query)));
      expect(error).toBeInstanceOf(DataError);
      expect((error as DataError).message).toContain(
        "answered with data that is not valid CASE: CFDocuments[0] is invalid",
      );
    }
  });

  it("refuses an answer that is not an object with a list of documents", async () => {
    for (const body of [{ CFDocuments: "x" }, [], { other: [] }]) {
      const provider = fakeProvider(() => ({ body }));
      expect(await failureOf(collect(clientOf(provider).documents(query)))).toBeInstanceOf(DataError);
    }
  });

  it("gives every document that has no identifier, since it cannot tell a repeat", async () => {
    const provider = fakeProvider(() => ({
      body: { CFDocuments: [{ title: "A" }, { title: "A" }] },
      headers: { "X-Total-Count": "2" },
    }));
    expect(await collect(clientOf(provider).documents({ fields: ["title"] }))).toHaveLength(2);
  });
});

describe("caseFilter", () => {
  const equals = (field: string, value: string) => ({ field, predicate: "=", value }) as const;

  it("writes a comparison as the field, the predicate and the value in single quotes", () => {
    expect(caseFilter(equals("version", "1.0"))).toBe("version='1.0'");
    for (const predicate of ["=", "!=", ">", ">=", "<", "<=", "~"] as const) {
      expect(caseFilter({ field: "title", predicate, value: "Math" })).toBe(`title${predicate}'Math'`);
    }
  });

  it("joins two comparisons with one AND or one OR between single spaces", () => {
    const two = [
      equals("version", "1.0"),
      { field: "lastChangeDateTime", predicate: ">", value: "2016-12-12T00:00:00Z" },
    ] as const;
    expect(caseFilter({ and: two })).toBe("version='1.0' AND lastChangeDateTime>'2016-12-12T00:00:00Z'");
    expect(caseFilter({ or: two })).toBe("version='1.0' OR lastChangeDateTime>'2016-12-12T00:00:00Z'");
  });

  it("writes a path through nested objects with dots", () => {
    expect(caseFilter(equals("extensions.sourceItemIdentifier", "x"))).toBe("extensions.sourceItemIdentifier='x'");
  });

  it("writes a single quote in a value twice", () => {
    expect(caseFilter(equals("title", "children's 'quoted' text"))).toBe("title='children''s ''quoted'' text'");
    expect(caseFilter(equals("title", "'"))).toBe("title=''''");
  });

  it("writes an empty value and a value that holds the operators and the punctuation of a filter", () => {
    expect(caseFilter(equals("title", ""))).toBe("title=''");
    expect(caseFilter(equals("title", 'a AND b OR c=d, e~f (g) \\ " é'))).toBe(
      "title='a AND b OR c=d, e~f (g) \\ \" é'",
    );
  });

  it("refuses what the binding cannot carry, with a sentence that names the part", () => {
    const refused = (filter: string) => () => caseFilter(fromJson(filter));
    expect(refused('{"field":"a b","predicate":"=","value":"x"}')).toThrow(
      'The field of the filter must be a field of the entity or a path of fields with dots, such as extensions.level, found "a b".',
    );
    expect(refused('{"field":"a","predicate":"?","value":"x"}')).toThrow(
      'The predicate of the filter must be one of = != > >= < <= ~, found "?".',
    );
    expect(refused('{"field":"a","predicate":"=","value":5}')).toThrow(
      "The value of the filter must be a string, found 5.",
    );
    expect(refused('{"and":[{"field":"a","predicate":"=","value":"x"}]}')).toThrow(
      "The and of the filter must have two comparisons, because the binding recommends one logical operator, found 1.",
    );
    expect(refused('{"and":"x"}')).toThrow('The and of the filter must be a list of two comparisons, found "x".');
    expect(refused("null")).toThrow("The filter must be an object, found null.");
  });
});

describe("readStatusInfo", () => {
  const refusal = (body: string, headers: Record<string, string> = {}, status = 429) =>
    new ServiceError("The CASE provider answered.", status, body, { headers });
  const busy = { ...entities.imsx_StatusInfo, imsx_description: "Slow down." };

  it("reads the status of the answer and the seconds that Retry-After asks for", () => {
    const detail = readStatusInfo(refusal(JSON.stringify(busy), { "retry-after": "30" }));
    expect(detail).toStrictEqual({ info: busy, retryAfterSeconds: 30 });
  });

  it("reads the status alone when the answer asks for no wait", () => {
    expect(readStatusInfo(refusal(JSON.stringify(busy)))).toStrictEqual({ info: busy });
  });

  it("gives no delay for a date, a negative number or text, and gives the delay when the body is no status", () => {
    for (const value of ["Wed, 21 Oct 2026 07:28:00 GMT", "-5", "1e3", "soon", "", "9999999999999999"]) {
      expect(readStatusInfo(refusal("{}", { "retry-after": value }))).toStrictEqual({});
    }
    expect(readStatusInfo(refusal("<html>busy</html>", { "retry-after": " 7 " }))).toStrictEqual({
      retryAfterSeconds: 7,
    });
    expect(readStatusInfo(refusal(""))).toStrictEqual({});
    expect(readStatusInfo(refusal('{"imsx_codeMajor":"failure"}'))).toStrictEqual({});
  });

  it("reads the error that a call of the client threw", async () => {
    const provider = fakeProvider(() => ({ status: 429, headers: { "Retry-After": "12" }, body: busy }));
    const error = await failureOf(clientOf(provider).item(id(7)));
    expect(readStatusInfo(error as ServiceError)).toStrictEqual({ info: busy, retryAfterSeconds: 12 });
  });

  it("refuses an argument that is not a ServiceError", () => {
    expect(() => readStatusInfo(fromJson("null"))).toThrow("The error must be a ServiceError.");
    expect(() => readStatusInfo(new Error("x") as never)).toThrow(DataError);
  });
});

describe("the paging headers", () => {
  it("find a next page in the Link header of the binding's example", () => {
    const link =
      '<https://imsglobal.org/ims/case/v1p0/CFDocuments?limit=10&offset=20>; rel="next", <https://imsglobal.org/ims/case/v1p0/CFDocuments?limit=3&offset=500>; rel="last", <https://imsglobal.org/ims/case/v1p0/CFDocuments?limit=10&offset=0>; rel="first", <https://imsglobal.org/ims/case/v1p0/CFDocuments?limit=10&offset=0>; rel="prev"';
    expect(hasNextLink({ link })).toBe(true);
    expect(hasNextLink({ link: link.replace('rel="next"', 'rel="last"') })).toBe(false);
  });

  it("read the relation quoted or not, in any case, among several, and with commas and semicolons in the address", () => {
    expect(hasNextLink({ link: "<https://x.example/a>; rel=next" })).toBe(true);
    expect(hasNextLink({ link: '<https://x.example/a>; REL="NEXT"' })).toBe(true);
    expect(hasNextLink({ link: '<https://x.example/a>; rel="prev next"' })).toBe(true);
    expect(hasNextLink({ link: '<https://x.example/a?fields=a,b;rel=next>; rel="first"' })).toBe(false);
    expect(hasNextLink({ link: '<https://x.example/a>; title="x"; rel="next"' })).toBe(true);
    expect(hasNextLink({ link: '<https://x.example/a>; rel="nexus"' })).toBe(false);
    expect(hasNextLink({ link: '<https://x.example/a>; rel="first", <https://x.example/b>; rel="next"' })).toBe(true);
  });

  it("find nothing without a Link header, and no next in a value that is not a link", () => {
    expect(hasNextLink({})).toBeUndefined();
    expect(hasNextLink({ link: "" })).toBe(false);
    expect(hasNextLink({ link: "rel=next" })).toBe(false);
    expect(hasNextLink({ link: '<https://x.example/a>; title="x"' })).toBe(false);
  });

  it("read the count of a collection when it is a number and give nothing otherwise", () => {
    expect(totalCountOf({ "x-total-count": "503" })).toBe(503);
    expect(totalCountOf({ "x-total-count": " 12 " })).toBe(12);
    expect(totalCountOf({ "x-total-count": "0" })).toBe(0);
    for (const value of ["", "-1", "1.5", "abc", "12 13", "1e3", "9999999999999999"]) {
      expect(totalCountOf({ "x-total-count": value })).toBeUndefined();
    }
    expect(totalCountOf({})).toBeUndefined();
  });
});
