import type { HttpResponse } from "@interopkit/core/http";
import { describe, expect, it } from "vitest";
import type { CFDocument } from "../src/index.js";
import { handleCaseRequest } from "../src/provider/index.js";
import { id } from "./full-package.js";
import { type Asked, DISCOVERY, documents, jsonOf, memoryStore, request, V11 } from "./provider-fixture.js";

const LIST = `${V11}/CFDocuments`;
const ORIGIN = "https://case.example.org";

/** Twenty-five documents, numbered, whose titles sort in the order of their numbers. */
function numbered(count: number): readonly CFDocument[] {
  const [base] = documents();
  if (base === undefined) throw new Error("The fixture has documents.");
  return Array.from({ length: count }, (_, index) => ({
    ...base,
    identifier: id(200 + index),
    title: `Document ${String(index).padStart(3, "0")}`,
  }));
}

/** Sends a request for the list to a provider over a store of numbered documents. */
async function page(query: string, options: { count?: number; pageSize?: number; maxPageSize?: number } = {}) {
  const asked: Asked[] = [];
  const { count = 25, ...limits } = options;
  const response = await handleCaseRequest(request(`${LIST}${query}`), {
    store: memoryStore(numbered(count), asked),
    discovery: DISCOVERY,
    ...limits,
  });
  return { response, asked };
}

/** Reads the `Link` header into the URL of each relation. */
function linksOf(header: string | undefined): Record<string, string> {
  const links: Record<string, string> = {};
  for (const [, url, relation] of (header ?? "").matchAll(/<([^>]+)>; rel="([a-z]+)"/gu)) {
    if (url !== undefined && relation !== undefined) links[relation] = url;
  }
  return links;
}

const titles = (response: HttpResponse): string[] =>
  (jsonOf(response) as { CFDocuments: { title: string }[] }).CFDocuments.map(({ title }) => title);

describe("the pages of the list of documents", () => {
  it("holds 100 documents unless the limit says otherwise, and tells how many there are", async () => {
    const { response, asked } = await page("", { count: 130 });
    expect(titles(response)).toHaveLength(100);
    expect(response.headers["x-total-count"]).toBe("130");
    expect(asked[0]?.argument).toMatchObject({ page: { limit: 100, offset: 0 } });
  });

  it("pages 503 documents as the binding shows, with the same limit in the last link", async () => {
    const { response } = await page("?limit=10&offset=10", { count: 503 });
    expect(response.headers["x-total-count"]).toBe("503");
    const links = linksOf(response.headers.link);
    expect(links.next).toBe(`${ORIGIN}${LIST}?limit=10&offset=20`);
    expect(links.prev).toBe(`${ORIGIN}${LIST}?limit=10&offset=0`);
    expect(links.first).toBe(`${ORIGIN}${LIST}?limit=10&offset=0`);
    expect(links.last).toBe(`${ORIGIN}${LIST}?limit=10&offset=500`);
  });

  it("takes the limit and the offset of the request", async () => {
    const { response } = await page("?limit=10&offset=10");
    expect(titles(response)).toStrictEqual(
      Array.from({ length: 10 }, (_, index) => `Document ${String(10 + index).padStart(3, "0")}`),
    );
    expect(response.headers["x-total-count"]).toBe("25");
  });

  it("gives the first, previous, next and last pages in Link", async () => {
    const { response } = await page("?limit=10&offset=10");
    expect(linksOf(response.headers.link)).toStrictEqual({
      first: `${ORIGIN}${LIST}?limit=10&offset=0`,
      prev: `${ORIGIN}${LIST}?limit=10&offset=0`,
      next: `${ORIGIN}${LIST}?limit=10&offset=20`,
      last: `${ORIGIN}${LIST}?limit=10&offset=20`,
    });
  });

  it("gives no previous page on the first page and no next page on the last", async () => {
    expect(Object.keys(linksOf((await page("?limit=10")).response.headers.link))).toStrictEqual([
      "first",
      "next",
      "last",
    ]);
    expect(Object.keys(linksOf((await page("?limit=10&offset=20")).response.headers.link))).toStrictEqual([
      "first",
      "prev",
      "last",
    ]);
  });

  it("puts the last page at the last whole multiple of the limit below the total", async () => {
    expect(linksOf((await page("?limit=10")).response.headers.link).last).toBe(`${ORIGIN}${LIST}?limit=10&offset=20`);
    expect(linksOf((await page("?limit=5")).response.headers.link).last).toBe(`${ORIGIN}${LIST}?limit=5&offset=20`);
    expect(linksOf((await page("?limit=25")).response.headers.link).last).toBe(`${ORIGIN}${LIST}?limit=25&offset=0`);
  });

  it("walks back by a page, and not below the first", async () => {
    expect(linksOf((await page("?limit=10&offset=15")).response.headers.link).prev).toBe(
      `${ORIGIN}${LIST}?limit=10&offset=5`,
    );
    expect(linksOf((await page("?limit=10&offset=3")).response.headers.link).prev).toBe(
      `${ORIGIN}${LIST}?limit=10&offset=0`,
    );
  });

  it("keeps the other parameters in the links, and writes the limit and offset once", async () => {
    const { response } = await page(
      "?limit=10&filter=title~%27Document%27&sort=title&orderBy=desc&offset=0&fields=title",
    );
    const { next } = linksOf(response.headers.link);
    expect(new URL(next ?? "").searchParams.getAll("limit")).toStrictEqual(["10"]);
    expect(new URL(next ?? "").searchParams.getAll("offset")).toStrictEqual(["10"]);
    expect(Object.fromEntries(new URL(next ?? "").searchParams)).toStrictEqual({
      limit: "10",
      filter: "title~'Document'",
      sort: "title",
      orderBy: "desc",
      offset: "10",
      fields: "title",
    });
  });

  it("answers a page past the end with an empty list and the total", async () => {
    const { response } = await page("?limit=10&offset=100");
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual({ CFDocuments: [] });
    expect(response.headers["x-total-count"]).toBe("25");
    expect(Object.keys(linksOf(response.headers.link))).toStrictEqual(["first", "prev", "last"]);
  });

  it("answers a list with nothing in it with an empty list, a total of 0 and the first page as the last", async () => {
    const { response } = await page("", { count: 0 });
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual({ CFDocuments: [] });
    expect(response.headers["x-total-count"]).toBe("0");
    expect(linksOf(response.headers.link)).toStrictEqual({
      first: `${ORIGIN}${LIST}?limit=100&offset=0`,
      last: `${ORIGIN}${LIST}?limit=100&offset=0`,
    });
  });

  it("uses the pageSize of the options for a request with no limit", async () => {
    const { response, asked } = await page("", { pageSize: 7 });
    expect(titles(response)).toHaveLength(7);
    expect(asked[0]?.argument).toMatchObject({ page: { limit: 7 } });
    expect(linksOf(response.headers.link).next).toContain("limit=7");
  });

  it("lowers a limit above maxPageSize to it, in the page and in the links", async () => {
    const { response, asked } = await page("?limit=50", { maxPageSize: 10 });
    expect(titles(response)).toHaveLength(10);
    expect(asked[0]?.argument).toMatchObject({ page: { limit: 10, offset: 0 } });
    expect(linksOf(response.headers.link).next).toBe(`${ORIGIN}${LIST}?limit=10&offset=10`);
  });

  it("lowers the pageSize to maxPageSize when it is above it", async () => {
    const { asked } = await page("", { pageSize: 50, maxPageSize: 20 });
    expect(asked[0]?.argument).toMatchObject({ page: { limit: 20 } });
  });

  it("takes 1 as the least limit and 0 as the least offset", async () => {
    const { response } = await page("?limit=1&offset=0");
    expect(titles(response)).toStrictEqual(["Document 000"]);
  });

  it.each([
    ["a limit of 0", "limit=0", "limit", "1"],
    ["a negative limit", "limit=-1", "limit", "1"],
    ["a limit that is not whole", "limit=1.5", "limit", "1"],
    ["a limit that is text", "limit=ten", "limit", "1"],
    ["an empty limit", "limit=", "limit", "1"],
    ["a limit in exponent form", "limit=1e2", "limit", "1"],
    ["a limit with a sign", "limit=%2B5", "limit", "1"],
    ["a limit beyond the safe integers", "limit=99999999999999999999", "limit", "1"],
    ["a negative offset", "offset=-1", "offset", "0"],
    ["an offset that is not whole", "offset=0.5", "offset", "0"],
    ["an offset that is text", "offset=x", "offset", "0"],
    ["an empty offset", "offset=", "offset", "0"],
  ])("answers 400, and does not ask the store, for %s", async (_, query, name, least) => {
    const { response, asked } = await page(`?${query}`);
    expect(response.status).toBe(400);
    expect(jsonOf(response)).toMatchObject({
      imsx_codeMajor: "failure",
      imsx_severity: "error",
      imsx_description: expect.stringContaining(
        `The parameter ${name} must be a whole number of at least ${least}, found `,
      ),
    });
    expect(jsonOf(response)).not.toHaveProperty("imsx_codeMinor");
    expect(asked).toStrictEqual([]);
  });

  it("answers 400 for a parameter that occurs twice", async () => {
    const { response, asked } = await page("?limit=1&limit=2");
    expect(response.status).toBe(400);
    expect(jsonOf(response)).toMatchObject({
      imsx_description: 'The query of the request has the parameter "limit" more than once.',
    });
    expect(asked).toStrictEqual([]);
  });

  it("reads a limit with leading zeros as the number", async () => {
    const { response } = await page("?limit=007");
    expect(titles(response)).toHaveLength(7);
  });
});
