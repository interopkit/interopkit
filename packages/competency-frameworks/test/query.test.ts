import { DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { describe, expect, it } from "vitest";
import type { CaseFilter, CFDocument } from "../src/index.js";
import {
  type CaseProviderOptions,
  handleCaseRequest,
  type ParsedCaseQuery,
  parseCaseQuery,
  queryEntities,
} from "../src/provider/index.js";
import { type Asked, DISCOVERY, documents, jsonOf, memoryStore, request, serve, V10, V11 } from "./provider-fixture.js";

/** Parses the parameters of a request that a test writes as a list of pairs. */
const parse = (...pairs: [string, string][]) => parseCaseQuery(new Map(pairs));
const filterOf = (text: string) => parse(["filter", text]);

const docs = documents();
const titlesOf = (found: readonly CFDocument[]): string[] => found.map(({ title }) => title);

/** Runs a filter given as the text of the parameter over the documents of the tests. */
function filtered(text: string, options?: { collation?: string }): string[] {
  const query = filterOf(text);
  if ("refused" in query) throw new Error(`The filter was refused: ${query.detail}`);
  return titlesOf(queryEntities(docs, query, options));
}

describe("the filter of a request", () => {
  it.each([
    ["=", "title='Mathematics'", { field: "title", predicate: "=", value: "Mathematics" }],
    ["!=", "title!='Mathematics'", { field: "title", predicate: "!=", value: "Mathematics" }],
    [">", "version>'2023'", { field: "version", predicate: ">", value: "2023" }],
    [">=", "version>='2023'", { field: "version", predicate: ">=", value: "2023" }],
    ["<", "version<'2023'", { field: "version", predicate: "<", value: "2023" }],
    ["<=", "version<='2023'", { field: "version", predicate: "<=", value: "2023" }],
    ["~", "title~'math'", { field: "title", predicate: "~", value: "math" }],
  ])("reads the predicate %s", (_, text, condition) => {
    expect(filterOf(text)).toStrictEqual({ filter: condition });
  });

  it("reads the example of the binding with a version and a time", () => {
    expect(filterOf("version='1.0' AND lastChangeDateTime>'2016-12-12T00:00:00Z'")).toStrictEqual({
      filter: {
        and: [
          { field: "version", predicate: "=", value: "1.0" },
          { field: "lastChangeDateTime", predicate: ">", value: "2016-12-12T00:00:00Z" },
        ],
      },
    });
  });

  it("reads OR, and reads AND and OR in either case", () => {
    expect(filterOf("title='a' OR title='b'")).toHaveProperty("filter.or");
    expect(filterOf("title='a' or title='b'")).toHaveProperty("filter.or");
    expect(filterOf("title='a' and title='b'")).toHaveProperty("filter.and");
    expect(filterOf("title='a'   AND\ttitle='b'")).toHaveProperty("filter.and");
  });

  it("reads a path with a dot through nested objects", () => {
    expect(filterOf("licenseURI.title='CC BY'")).toStrictEqual({
      filter: { field: "licenseURI.title", predicate: "=", value: "CC BY" },
    });
    expect(filterOf("extensions.sourceDocumentIdentifier='x'")).toHaveProperty(
      "filter.field",
      "extensions.sourceDocumentIdentifier",
    );
  });

  it("reads white space around the predicate", () => {
    expect(filterOf("title = 'a'")).toStrictEqual({ filter: { field: "title", predicate: "=", value: "a" } });
    expect(filterOf("title >=  'a'")).toStrictEqual({ filter: { field: "title", predicate: ">=", value: "a" } });
  });

  it.each([
    ["a quote written twice", "title='It''s'", "It's"],
    ["a value that is only a quote", "title=''''", "'"],
    ["an empty value", "title=''", ""],
    ["a value that ends with a quote", "title='a'''", "a'"],
    ["an apostrophe written once", "title='It's'", "It's"],
    ["the word AND inside the value", "title='rock AND roll'", "rock AND roll"],
    ["the word OR at the end of the value", "title='rock OR'", "rock OR"],
    ["a quote and AND inside the value", "title='a'' AND b'", "a' AND b"],
    ["white space at both ends", "title='  a  '", "  a  "],
    ["characters of the grammar", "title='a=b>c~d!=e'", "a=b>c~d!=e"],
    ["text that is not Latin", "title='日本語 text'", "日本語 text"],
  ])("reads %s in a value", (_, text, value) => {
    expect(filterOf(text)).toStrictEqual({ filter: { field: "title", predicate: "=", value } });
  });

  it.each([
    ["is empty", ""],
    ["is white space", "   "],
    ["has no predicate", "title"],
    ["has a predicate and no value", "title="],
    ["has a value with no quotes", "title=Math"],
    ["has a value with double quotes", 'title="Math"'],
    ["has a value that is not closed", "title='Math"],
    ["has no field", "='x'"],
    ["has a lone exclamation mark", "title!'x'"],
    ["ends after AND", "title='a' AND"],
    ["has a second condition with no field", "title='a' AND ='b'"],
    ["has a second condition with no value", "title='a' AND version"],
    ["has text after a value", "title='a' b"],
    ["has a field with a quote", "ti'tle='a'"],
    ["has a path with an empty name", "licenseURI..title='a'"],
    ["has a path that ends with a dot", "licenseURI.='a'"],
    ["has a path that starts with a dot", ".title='a'"],
  ])("refuses a filter that %s, with invalid_filter_field and a sentence that says what to write", (_, text) => {
    const result = filterOf(text);
    expect(result).toMatchObject({
      refused: "invalid_filter_field",
      detail: expect.stringMatching(/^The (filter|value).*[.:]/u),
    });
  });

  it("refuses more than one logical operator", () => {
    expect(filterOf("title='a' AND title='b' AND title='c'")).toStrictEqual({
      refused: "invalid_filter_field",
      detail: "The filter has more than one logical operator: use at most one AND or OR.",
    });
    expect(filterOf("title='a' AND title='b' OR title='c'")).toHaveProperty("refused", "invalid_filter_field");
  });

  it("refuses a field that a CFDocument does not have, and names it", () => {
    expect(filterOf("nonsense='a'")).toStrictEqual({
      refused: "invalid_filter_field",
      detail: 'The filter names the field "nonsense", which a CFDocument of CASE 1.1 does not have.',
    });
    expect(filterOf("title='a' AND CFItems='x'")).toHaveProperty("refused", "invalid_filter_field");
  });

  it("refuses a name that only the prototype of an object has", () => {
    expect(filterOf("constructor='a'")).toHaveProperty("refused", "invalid_filter_field");
    expect(filterOf("__proto__.x='a'")).toHaveProperty("refused", "invalid_filter_field");
  });

  it("reads every property of a CFDocument of 1.1, and refuses a field of an item", () => {
    for (const name of Object.keys(docs[0] ?? {})) expect(filterOf(`${name}='x'`)).toHaveProperty("filter.field", name);
    expect(filterOf("fullStatement='x'")).toHaveProperty("refused", "invalid_filter_field");
  });

  it("takes a fields list of 2,048 characters and refuses one of 2,049", () => {
    const at = (length: number) => `title,${" ".repeat(length - "title,identifier".length)}identifier`;
    expect(parse(["fields", at(2048)])).toStrictEqual({ fields: ["title", "identifier"] });
    expect(parse(["fields", at(2049)])).toStrictEqual({
      refused: "invalid_selection_field",
      detail: "The fields list has 2049 characters; the most is 2048.",
    });
  });

  it("takes a filter of 2,048 characters and refuses one of 2,049", () => {
    const at = (length: number) => `title='${"x".repeat(length - "title=''".length)}'`;
    expect(filterOf(at(2048))).toHaveProperty("filter.predicate", "=");
    expect(filterOf(at(2049))).toStrictEqual({
      refused: "invalid_filter_field",
      detail: "The filter has 2049 characters; the most is 2048.",
    });
  });

  it("reads a long filter of many quotes in the time of a short one", () => {
    const start = performance.now();
    filterOf(`title='${"''".repeat(1000)}`);
    filterOf(`title='${"' AND ".repeat(300)}`);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("the fields of a request", () => {
  it("lists the fields in the order of the request, once each", () => {
    expect(parse(["fields", "title,identifier,title"])).toStrictEqual({ fields: ["title", "identifier"] });
    expect(parse(["fields", " title , identifier "])).toStrictEqual({ fields: ["title", "identifier"] });
  });

  it("leaves out a name that a CFDocument does not have, and all of them when none is one", () => {
    expect(parse(["fields", "title,nonsense"])).toStrictEqual({ fields: ["title"] });
    expect(parse(["fields", "nonsense,other"])).toStrictEqual({});
  });

  it("leaves out a path, which selects whole properties only", () => {
    expect(parse(["fields", "licenseURI.title"])).toStrictEqual({});
  });

  it.each([
    ["is empty", ""],
    ["is white space", "  "],
    ["has an empty name between commas", "title,,identifier"],
    ["ends with a comma", "title,"],
    ["starts with a comma", ",title"],
  ])("refuses a list that %s, with invalid_selection_field", (_, text) => {
    expect(parse(["fields", text])).toStrictEqual({
      refused: "invalid_selection_field",
      detail: "The fields list has a blank name: write the names with a comma between them, such as identifier,title.",
    });
  });
});

describe("the sort of a request", () => {
  it("keeps a sort on a property, with the direction", () => {
    expect(parse(["sort", "title"])).toStrictEqual({ sort: "title" });
    expect(parse(["sort", "title"], ["orderBy", "desc"])).toStrictEqual({ sort: "title", orderBy: "desc" });
    expect(parse(["sort", "title"], ["orderBy", "asc"])).toStrictEqual({ sort: "title", orderBy: "asc" });
    expect(parse(["sort", "licenseURI.title"])).toStrictEqual({ sort: "licenseURI.title" });
  });

  it("leaves the order of the provider for a property that does not exist", () => {
    expect(parse(["sort", "nonsense"], ["orderBy", "desc"])).toStrictEqual({});
    expect(parse(["sort", ""])).toStrictEqual({});
    expect(parse(["sort", "a..b"])).toStrictEqual({});
    expect(parse(["sort", "constructor"])).toStrictEqual({});
  });

  it("leaves out a direction that is not asc or desc, and one with no sort", () => {
    expect(parse(["sort", "title"], ["orderBy", "up"])).toStrictEqual({ sort: "title" });
    expect(parse(["sort", "title"], ["orderBy", "DESC"])).toStrictEqual({ sort: "title" });
    expect(parse(["orderBy", "desc"])).toStrictEqual({});
  });

  it("reads the filter, the fields and the sort together, and ignores other parameters", () => {
    expect(
      parse(["filter", "title~'a'"], ["fields", "title"], ["sort", "title"], ["limit", "5"], ["other", "x"]),
    ).toStrictEqual({ filter: { field: "title", predicate: "~", value: "a" }, fields: ["title"], sort: "title" });
  });

  it("refuses the filter before the fields", () => {
    expect(parse(["fields", ""], ["filter", "x"])).toHaveProperty("refused", "invalid_filter_field");
  });
});

describe("the arguments of parseCaseQuery", () => {
  it.each([
    ["null", "null"],
    ["an object", "{}"],
    ["an array", '[["filter","x"]]'],
    ["a string", '"filter=x"'],
  ])("refuses %s for the parameters", (_, json) => {
    expect(() => parseCaseQuery(JSON.parse(json))).toThrow("The parameters must be a Map of strings");
  });

  it("refuses a parameter whose value is not a string", () => {
    expect(() => parseCaseQuery(new Map(Object.entries(JSON.parse('{"limit":5}'))) as never)).toThrow(
      'The parameter "limit" must be a string, found 5.',
    );
  });
});

describe("queryEntities on the documents", () => {
  it("returns every entity, in its order, for a query with no filter and no sort", () => {
    expect(queryEntities(docs, {})).toStrictEqual(docs);
    expect(queryEntities(docs, {})).not.toBe(docs);
  });

  it("returns the entities themselves and changes nothing in its arguments", () => {
    const query: ParsedCaseQuery = { filter: { field: "creator", predicate: "=", value: "ministry" }, sort: "title" };
    const frozen = Object.freeze(docs.map((each) => Object.freeze({ ...each })));
    const copy = structuredClone(query);
    const found = queryEntities(frozen, query);
    expect(found.length).toBe(2);
    for (const each of found) expect(frozen).toContain(each);
    expect(query).toStrictEqual(copy);
  });

  describe("compares text", () => {
    it("without regard to case", () => {
      expect(filtered("title='MATHEMATICS'")).toStrictEqual(["Mathematics"]);
      expect(filtered("title='zebra STUDIES'")).toStrictEqual(["Zebra studies"]);
    });

    it("with regard to accents", () => {
      expect(filtered("title='älg i skogen'")).toStrictEqual(["Älg i skogen"]);
      expect(filtered("title='alg i skogen'")).toStrictEqual([]);
    });

    it("by canonical equivalence, so that composed and decomposed letters are one", () => {
      expect(filtered("title='Älg i skogen'")).toStrictEqual(["Älg i skogen"]);
      expect(filtered("title~'Älg'")).toStrictEqual(["Älg i skogen"]);
    });

    it("for !=, as the opposite of =", () => {
      expect(filtered("title!='mathematics'")).toStrictEqual([
        "Zebra studies",
        "apple basics",
        "Älg i skogen",
        "Mathematics 2",
      ]);
    });

    it("for ~, as a part of the text without regard to case", () => {
      expect(filtered("title~'MATH'")).toStrictEqual(["Mathematics", "Mathematics 2"]);
      expect(filtered("title~'ICS 2'")).toStrictEqual(["Mathematics 2"]);
    });

    it("for the order of text, by the collation", () => {
      expect(filtered("title>'mathematics 2'")).toStrictEqual(["Zebra studies"]);
      expect(filtered("title<='apple basics'")).toStrictEqual(["apple basics", "Älg i skogen"]);
    });

    it("by the collation of the locale for the order of text", () => {
      expect(filtered("title>'zebra studies'", { collation: "sv" })).toStrictEqual(["Älg i skogen"]);
      expect(filtered("title>'zebra studies'", { collation: "und" })).toStrictEqual([]);
    });
  });

  describe("compares dates and numbers", () => {
    it("by the instant that a date and time names, whatever its offset", () => {
      expect(filtered("lastChangeDateTime>'2024-06-13T18:46:03+00:00'")).toStrictEqual(["Zebra studies"]);
      expect(filtered("lastChangeDateTime>='2024-06-13T18:46:03Z'")).toStrictEqual(["Mathematics", "Zebra studies"]);
      expect(filtered("lastChangeDateTime='2024-06-13T23:46:03+05:00'")).toStrictEqual(["Mathematics"]);
      expect(filtered("lastChangeDateTime<'2023-01-01T07:59:59Z'")).toStrictEqual(["apple basics"]);
    });

    it("by the order of text for dates without a time", () => {
      expect(filtered("statusStartDate>'2022-06-01'")).toStrictEqual([
        "Mathematics",
        "Zebra studies",
        "apple basics",
        "Älg i skogen",
      ]);
    });

    it("as numbers when the value is a number, and the property too", () => {
      const rows = [{ n: 9 }, { n: 10 }, { n: 2.5 }];
      const run = (predicate: ">" | "<" | "=", value: string) =>
        queryEntities(rows, { filter: { field: "n", predicate, value } }).map(({ n }) => n);
      expect(run(">", "9")).toStrictEqual([10]);
      expect(run("<", "9")).toStrictEqual([2.5]);
      expect(run("=", "10")).toStrictEqual([10]);
      expect(run("=", "1e1")).toStrictEqual([10]);
      expect(run("=", "2.50")).toStrictEqual([2.5]);
    });

    it("as text when the property is text, even if it looks like a number", () => {
      const rows = [{ n: "10" }, { n: "9" }];
      const found = queryEntities(rows, { filter: { field: "n", predicate: "<", value: "9" } });
      expect(found).toStrictEqual([{ n: "10" }]);
    });

    it("as the text of a boolean", () => {
      const rows = [{ flag: true }, { flag: false }];
      expect(queryEntities(rows, { filter: { field: "flag", predicate: "=", value: "TRUE" } })).toStrictEqual([
        { flag: true },
      ]);
    });
  });

  describe("reads a path", () => {
    const rows = [
      {
        id: 1,
        meta: { owner: { name: "Ada" }, tags: ["x", "y"] },
        links: [{ title: "One" }, { title: "Two" }],
        note: null,
      },
      { id: 2, meta: { owner: { name: "Bo" } }, links: [{ title: "Two" }] },
      { id: 3, meta: "text", links: [] },
    ];
    const ids = (filter: CaseFilter) => queryEntities(rows, { filter }).map(({ id }) => id);

    it("through nested objects", () => {
      expect(ids({ field: "meta.owner.name", predicate: "=", value: "bo" })).toStrictEqual([2]);
    });

    it("through a list of objects, as the values of the list", () => {
      expect(ids({ field: "links.title", predicate: "=", value: "One,Two" })).toStrictEqual([1]);
      expect(ids({ field: "links.title", predicate: "~", value: "one" })).toStrictEqual([1]);
      expect(ids({ field: "links.title", predicate: "=", value: "Two" })).toStrictEqual([2]);
    });

    it("finds nothing at a path that does not exist, is null, or leads to an object", () => {
      expect(ids({ field: "meta.nothing", predicate: "=", value: "x" })).toStrictEqual([]);
      expect(ids({ field: "note", predicate: "=", value: "null" })).toStrictEqual([]);
      expect(ids({ field: "meta", predicate: "~", value: "owner" })).toStrictEqual([]);
      expect(ids({ field: "meta.owner", predicate: "~", value: "Ada" })).toStrictEqual([]);
      expect(ids({ field: "meta.tags.deep", predicate: "=", value: "x" })).toStrictEqual([]);
    });

    it("does not read what an object inherits", () => {
      const inheriting = Object.create({ secret: "inherited" });
      expect(
        queryEntities([inheriting], { filter: { field: "secret", predicate: "=", value: "inherited" } }),
      ).toStrictEqual([]);
    });

    it("does not reach what the prototype of an object holds", () => {
      expect(ids({ field: "constructor", predicate: "~", value: "" })).toStrictEqual([]);
      expect(ids({ field: "__proto__", predicate: "~", value: "" })).toStrictEqual([]);
      expect(ids({ field: "meta.constructor.name", predicate: "~", value: "Object" })).toStrictEqual([]);
      expect(ids({ field: "toString", predicate: "!=", value: "x" })).toStrictEqual([1, 2, 3]);
    });

    it("treats a property that is absent as not equal", () => {
      expect(ids({ field: "meta.owner.name", predicate: "!=", value: "Ada" })).toStrictEqual([2, 3]);
      expect(ids({ field: "links.title", predicate: "!=", value: "Two" })).toStrictEqual([1, 3]);
    });
  });

  describe("compares a list", () => {
    const record = [{ subject: ["subject1", "subject2", "subject3"] }];
    const matches = (predicate: "=" | "~" | "!=", value: string) =>
      queryEntities(record, { filter: { field: "subject", predicate, value } }).length === 1;

    it.each([
      ["=", "subject1", false],
      ["=", "subject1,subject2", false],
      ["=", "subject1,subject2,subject3", true],
      ["~", "subject1", true],
      ["~", "subject1,subject2", true],
      ["~", "subject1,subject2,subject3", true],
    ] as const)("as the binding says: %s with %s returns the record: %s", (predicate, value, expected) => {
      expect(matches(predicate, value)).toBe(expected);
    });

    it("by the members as a set for =, whatever their order or the white space between them", () => {
      expect(matches("=", "subject3, subject1 ,subject2")).toBe(true);
      expect(matches("=", "SUBJECT1,subject2,subject3,subject1")).toBe(true);
      expect(matches("=", "subject1,subject2,subject4")).toBe(false);
    });

    it("by the opposite of = for !=", () => {
      expect(matches("!=", "subject1")).toBe(true);
      expect(matches("!=", "subject1,subject2,subject3")).toBe(false);
    });

    it("by any member for ~, and any term", () => {
      expect(matches("~", "subject")).toBe(true);
      expect(matches("~", "nothing,subject3")).toBe(true);
      expect(matches("~", "nothing,other")).toBe(false);
    });

    it("by one member for the order", () => {
      const rows = [{ n: [1, 5] }, { n: [2, 3] }];
      const run = (predicate: ">" | "<", value: string) =>
        queryEntities(rows, { filter: { field: "n", predicate, value } }).length;
      expect(run(">", "4")).toBe(1);
      expect(run("<", "2")).toBe(1);
      expect(run(">", "5")).toBe(0);
    });

    it("as no match for = when the list is empty", () => {
      expect(
        queryEntities([{ subject: [] }], { filter: { field: "subject", predicate: "=", value: "" } }),
      ).toStrictEqual([]);
    });

    it("as one value when the property is not a list, even if the filter holds a comma", () => {
      const rows = [{ title: "Reading, writing" }];
      expect(
        queryEntities(rows, { filter: { field: "title", predicate: "=", value: "reading, writing" } }),
      ).toHaveLength(1);
      expect(queryEntities(rows, { filter: { field: "title", predicate: "~", value: "reading, w" } })).toHaveLength(1);
      expect(queryEntities(rows, { filter: { field: "title", predicate: "~", value: "x, reading" } })).toHaveLength(0);
    });
  });

  describe("joins conditions", () => {
    const rows = docs;
    const run = (text: string) => titlesOf(queryEntities(rows, filterOf(text) as ParsedCaseQuery));

    it("with AND, when both hold", () => {
      expect(run("creator='agency' AND title~'2'")).toStrictEqual(["Mathematics 2"]);
    });

    it("with OR, when either holds", () => {
      expect(run("title='zebra studies' OR title='apple basics'")).toStrictEqual(["Zebra studies", "apple basics"]);
    });
  });

  describe("sorts", () => {
    const sorted = (query: ParsedCaseQuery, options?: { collation?: string }) =>
      titlesOf(queryEntities(docs, query, options));

    it("ascending by default, by the collation, and not by code point", () => {
      expect(sorted({ sort: "title" })).toStrictEqual([
        "Älg i skogen",
        "apple basics",
        "Mathematics",
        "Mathematics 2",
        "Zebra studies",
      ]);
    });

    it("descending when asked", () => {
      expect(sorted({ sort: "title", orderBy: "desc" })).toStrictEqual([
        "Zebra studies",
        "Mathematics 2",
        "Mathematics",
        "apple basics",
        "Älg i skogen",
      ]);
    });

    it("by the collation that the options or the query name", () => {
      const swedish = ["apple basics", "Mathematics", "Mathematics 2", "Zebra studies", "Älg i skogen"];
      expect(sorted({ sort: "title" }, { collation: "sv" })).toStrictEqual(swedish);
      expect(sorted({ sort: "title", collation: "sv" })).toStrictEqual(swedish);
      expect(sorted({ sort: "title", collation: "und" }, { collation: "sv" })).toStrictEqual(swedish);
    });

    it("by the instant of a date and time", () => {
      expect(sorted({ sort: "lastChangeDateTime" })).toStrictEqual([
        "apple basics",
        "Mathematics 2",
        "Älg i skogen",
        "Mathematics",
        "Zebra studies",
      ]);
    });

    it("by a number as a number", () => {
      const rows = [{ n: 10 }, { n: 9 }, { n: 100 }];
      expect(queryEntities(rows, { sort: "n" }).map(({ n }) => n)).toStrictEqual([9, 10, 100]);
    });

    it("by a path, and by the first value of a list", () => {
      const rows = [
        { a: { b: "z" }, l: ["b", "a"] },
        { a: { b: "m" }, l: ["a"] },
      ];
      expect(queryEntities(rows, { sort: "a.b" }).map(({ a }) => a.b)).toStrictEqual(["m", "z"]);
      expect(queryEntities(rows, { sort: "l" }).map(({ l }) => l.join())).toStrictEqual(["a", "b,a"]);
    });

    it("with the entities that have no value last, whichever the direction", () => {
      const rows = [{ k: "b" }, {}, { k: "a" }, { k: null }];
      expect(queryEntities(rows, { sort: "k" })).toStrictEqual([{ k: "a" }, { k: "b" }, {}, { k: null }]);
      expect(queryEntities(rows, { sort: "k", orderBy: "desc" })).toStrictEqual([
        { k: "b" },
        { k: "a" },
        {},
        { k: null },
      ]);
    });

    it("keeping the order of entities that compare equal", () => {
      const rows = [
        { k: "A", n: 1 },
        { k: "a", n: 2 },
        { k: "A", n: 3 },
      ];
      expect(queryEntities(rows, { sort: "k" }).map(({ n }) => n)).toStrictEqual([2, 1, 3]);
      expect(queryEntities(rows, { sort: "n", orderBy: "desc" }).map(({ n }) => n)).toStrictEqual([3, 2, 1]);
      const same = [
        { k: "a", n: 1 },
        { k: "a", n: 2 },
        { k: "a", n: 3 },
      ];
      expect(queryEntities(same, { sort: "k", orderBy: "desc" }).map(({ n }) => n)).toStrictEqual([1, 2, 3]);
    });

    it("after the filter", () => {
      expect(
        sorted({ filter: { field: "creator", predicate: "=", value: "agency" }, sort: "title", orderBy: "desc" }),
      ).toStrictEqual(["Mathematics 2", "Älg i skogen"]);
    });

    it("by a path that nothing has, which leaves the order", () => {
      expect(sorted({ sort: "nothing" })).toStrictEqual(titlesOf(docs));
    });
  });

  describe("refuses", () => {
    it.each([
      ["a query that is null", "null", "The query is invalid: expected an object, found null."],
      ["a query that is an array", "[]", "The query is invalid: expected an object, found an array."],
      ["a property the query does not have", '{"limit":5}', "The query is invalid"],
      ["a sort that is a number", '{"sort":5}', "The query is invalid at sort: expected a string, found 5."],
      ["a direction that is not one", '{"orderBy":"up"}', "The query is invalid at orderBy"],
      ["fields that are text", '{"fields":"title"}', "The query is invalid at fields"],
      ["a collation that is a number", '{"collation":5}', "The query is invalid at collation"],
      ["a filter that is text", '{"filter":"title"}', "The query is invalid at filter"],
      [
        "a condition with a predicate that is not one",
        '{"filter":{"field":"a","predicate":"??","value":"x"}}',
        "The query is invalid at filter",
      ],
      [
        "a condition with a number for the value",
        '{"filter":{"field":"a","predicate":"=","value":5}}',
        "The query is invalid at filter",
      ],
      [
        "a filter that joins three conditions",
        '{"filter":{"and":[{"field":"a","predicate":"=","value":"x"},{"field":"a","predicate":"=","value":"x"},{"field":"a","predicate":"=","value":"x"}]}}',
        "The query is invalid at filter",
      ],
    ])("%s", (_, json, message) => {
      expect(() => queryEntities(docs, JSON.parse(json))).toThrow(message);
    });

    it.each([
      ["a collation that is not a language tag", "not a tag"],
      ["an empty collation", ""],
    ])("%s", (_, collation) => {
      expect(() => queryEntities(docs, { sort: "title" }, { collation })).toThrow(
        `The collation must be a BCP 47 language tag such as "und" or "sv-SE", found "${collation}".`,
      );
      expect(() => queryEntities(docs, { sort: "title", collation })).toThrow(DataError);
    });

    it("options that are not an object, or have a property it does not know", () => {
      expect(() => queryEntities(docs, {}, JSON.parse("null"))).toThrow("The options is invalid");
      expect(() => queryEntities(docs, {}, JSON.parse('{"locale":"sv"}'))).toThrow("The options is invalid");
    });

    it.each([
      ["null", "null", "The entities must be an array, found null."],
      ["an object", "{}", "The entities must be an array, found an object."],
      ["a list with a string", '[{"a":1},"x"]', 'The entity at 1 must be an object, found "x".'],
      ["a list with null", "[null]", "The entity at 0 must be an object, found null."],
      ["a list with a list", "[[]]", "The entity at 0 must be an object, found an array."],
    ])("entities that are %s", (_, json, message) => {
      expect(() => queryEntities(JSON.parse(json), {})).toThrow(message);
    });
  });
});

describe("the list of documents with a query", () => {
  const LIST = `${V11}/CFDocuments`;
  const ask = (path: string, options: Partial<CaseProviderOptions> = {}) => serve(path, options);
  const bodyTitles = (response: HttpResponse) =>
    (jsonOf(response) as { CFDocuments: { title: string }[] }).CFDocuments.map(({ title }) => title);

  it("filters, sorts and counts what matches before it pages", async () => {
    const response = await ask(
      `${LIST}?filter=${encodeURIComponent("creator='ministry'")}&sort=title&limit=1&offset=1`,
    );
    expect(bodyTitles(response)).toStrictEqual(["Zebra studies"]);
    expect(response.headers["x-total-count"]).toBe("2");
  });

  it("gives the store the query that it read, with the collation of the options", async () => {
    const asked: Asked[] = [];
    await handleCaseRequest(
      request(`${LIST}?sort=title&orderBy=desc&fields=title&filter=${encodeURIComponent("title~'a'")}`),
      {
        store: memoryStore(documents(), asked),
        discovery: DISCOVERY,
        collation: "sv-SE",
      },
    );
    expect(asked[0]?.argument).toStrictEqual({
      query: {
        sort: "title",
        orderBy: "desc",
        fields: ["title"],
        filter: { field: "title", predicate: "~", value: "a" },
        collation: "sv-SE",
      },
      page: { limit: 100, offset: 0 },
    });
  });

  it("sorts by the collation of the options", async () => {
    const swedish = await ask(`${LIST}?sort=title`, { collation: "sv" });
    expect(bodyTitles(swedish).at(-1)).toBe("Älg i skogen");
    const root = await ask(`${LIST}?sort=title`);
    expect(bodyTitles(root).at(0)).toBe("Älg i skogen");
  });

  it("returns only the fields that were asked for", async () => {
    const response = await ask(`${LIST}?fields=identifier,title&limit=2`);
    expect(jsonOf(response)).toStrictEqual({
      CFDocuments: [
        { identifier: documents()[0]?.identifier, title: "Mathematics" },
        { identifier: documents()[1]?.identifier, title: "Zebra studies" },
      ],
    });
  });

  it("returns every field when no name in fields is a property", async () => {
    const response = await ask(`${LIST}?fields=nonsense&limit=1`);
    expect(jsonOf(response)).toStrictEqual({ CFDocuments: [JSON.parse(JSON.stringify(documents()[0]))] });
  });

  it("returns the order of the store for a sort by a property that does not exist", async () => {
    const response = await ask(`${LIST}?sort=nonsense&orderBy=desc`);
    expect(bodyTitles(response)).toStrictEqual(titlesOf(docs));
  });

  it("returns an empty list, and a total of 0, when the filter matches nothing", async () => {
    const response = await ask(`${LIST}?filter=${encodeURIComponent("title='nothing'")}`);
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual({ CFDocuments: [] });
    expect(response.headers["x-total-count"]).toBe("0");
  });

  it.each([
    ["names a field that a CFDocument does not have", "nonsense='x'"],
    ["cannot be read", "title"],
    ["has two logical operators", "title='a' AND title='b' OR title='c'"],
    ["is empty", ""],
  ])("answers 400 with invalid_filter_field for a filter that %s, and does not ask the store", async (_, filter) => {
    const asked: Asked[] = [];
    const response = await handleCaseRequest(request(`${LIST}?filter=${encodeURIComponent(filter)}`), {
      store: memoryStore(documents(), asked),
      discovery: DISCOVERY,
    });
    expect(response.status).toBe(400);
    expect(jsonOf(response)).toStrictEqual({
      imsx_codeMajor: "failure",
      imsx_severity: "error",
      imsx_description: expect.stringMatching(/^The (filter|value)/u),
      imsx_codeMinor: {
        imsx_codeMinorField: [
          { imsx_codeMinorFieldName: "TargetEndSystem", imsx_codeMinorFieldValue: "invalid_filter_field" },
        ],
      },
    });
    expect(asked).toStrictEqual([]);
  });

  it.each(["", "title,,identifier", "title,"])(
    "answers 400 with invalid_selection_field for the fields %j",
    async (fields) => {
      const response = await ask(`${LIST}?fields=${encodeURIComponent(fields)}`);
      expect(response.status).toBe(400);
      expect(jsonOf(response)).toMatchObject({
        imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldValue: "invalid_selection_field" }] },
      });
    },
  );

  it("answers the same on the path of 1.0, with the names of 1.0", async () => {
    const both = { versions: ["1.0", "1.1"] } as const;
    const filter = encodeURIComponent("frameworkType='CourseCodes'");
    expect((await ask(`${V10}/CFDocuments?filter=${filter}`, both)).status).toBe(400);
    expect(bodyTitles(await ask(`${V11}/CFDocuments?filter=${filter}`, both))).toStrictEqual([
      "Mathematics",
      "Zebra studies",
      "apple basics",
      "Älg i skogen",
      "Mathematics 2",
    ]);
    expect(jsonOf(await ask(`${V10}/CFDocuments?fields=frameworkType,title&limit=1`, both))).toStrictEqual({
      CFDocuments: [JSON.parse(JSON.stringify(documents()[0]))].map(({ title }) => ({ title })),
    });
    expect(jsonOf(await ask(`${V10}/CFDocuments?fields=frameworkType`, both))).toHaveProperty(
      "CFDocuments.0.identifier",
    );
    expect(bodyTitles(await ask(`${V10}/CFDocuments?sort=frameworkType`, both))).toStrictEqual(titlesOf(docs));
  });
});
