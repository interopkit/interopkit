import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CaseCondition, type CaseFilter, FILTER_PREDICATES } from "../src/index.js";
import { handleCaseRequest, queryEntities } from "../src/provider/index.js";
import { parseCaseQuery } from "../src/provider/internal.js";
import { DISCOVERY, documents, jsonOf, memoryStore, ORIGIN, V10, V11 } from "./provider-fixture.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_103, numRuns: 300 };

/** Text that stresses the grammar: quotes, the words AND and OR, operators, white space, and any characters. */
const PIECES = fc.constantFrom(
  "'",
  "''",
  " AND ",
  " OR ",
  " and ",
  "=",
  "!=",
  ">=",
  "<",
  "~",
  ",",
  ".",
  " ",
  "\t",
  "\n",
  "%",
  "&",
  "é",
  "日",
);
const WORDS = fc.oneof(fc.string({ maxLength: 20 }), fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/u));
const TEXT = fc.array(fc.oneof(PIECES, WORDS), { maxLength: 12 }).map((parts) => parts.join(""));

const FIELDS = [
  "identifier",
  "title",
  "creator",
  "lastChangeDateTime",
  "subject",
  "licenseURI.title",
  "extensions.sourceDocumentIdentifier",
];
const condition: fc.Arbitrary<CaseCondition> = fc.record(
  { field: fc.constantFrom(...FIELDS), predicate: fc.constantFrom(...FILTER_PREDICATES), value: TEXT },
  { noNullPrototype: true },
);
const filter: fc.Arbitrary<CaseFilter> = fc.oneof(
  condition,
  fc.tuple(condition, condition).map(([left, right]) => ({ and: [left, right] }) as const),
  fc.tuple(condition, condition).map(([left, right]) => ({ or: [left, right] }) as const),
);

/** Writes a filter in the grammar of the binding, with each quote of a value written twice. */
function write(each: CaseFilter): string {
  const one = ({ field, predicate, value }: CaseCondition) => `${field}${predicate}'${value.replaceAll("'", "''")}'`;
  if ("and" in each) return `${one(each.and[0])} AND ${one(each.and[1])}`;
  if ("or" in each) return `${one(each.or[0])} OR ${one(each.or[1])}`;
  return one(each);
}

describe("the parser of a query on any text", () => {
  it("reads a filter that it has written back to the same filter", () => {
    fc.assert(
      fc.property(filter, (each) => {
        expect(parseCaseQuery(new Map([["filter", write(each)]]))).toStrictEqual({ filter: each });
      }),
      RUNS,
    );
  });

  it("returns a query or a refusal for any parameters, and throws nothing", () => {
    fc.assert(
      fc.property(TEXT, TEXT, TEXT, TEXT, fc.string(), (filterText, fields, sort, orderBy, other) => {
        const parameters = new Map([
          ["filter", filterText],
          ["fields", fields],
          ["sort", sort],
          ["orderBy", orderBy],
          [other, other],
        ]);
        const result = parseCaseQuery(parameters);
        if ("reason" in result) {
          expect(["invalid_filter_field", "invalid_selection_field"]).toContain(result.reason);
          expect(result.message.length).toBeGreaterThan(0);
        } else {
          expect(Object.keys(result).every((key) => ["filter", "fields", "sort", "orderBy"].includes(key))).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("returns for the longest filter and for a filter that is all quotes, white space or operators", () => {
    for (const unit of ["'", " ", " AND ", "=", "''", "a='", "' OR "]) {
      const text = unit.repeat(Math.ceil(2048 / unit.length)).slice(0, 2048);
      expect(parseCaseQuery(new Map([["filter", text]]))).toBeDefined();
    }
  });
});

describe("the handler on any request", () => {
  const options = { store: memoryStore(), discovery: DISCOVERY, versions: ["1.0", "1.1"] } as const;
  const get = (url: string, method = "GET") =>
    handleCaseRequest({ method, url, headers: {}, body: new Uint8Array() }, options);

  it("answers a list request with 200 or 400 for any parameters", () =>
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom(V10, V11),
        fc.array(fc.tuple(fc.constantFrom("filter", "fields", "sort", "orderBy", "limit", "offset", "x"), TEXT), {
          maxLength: 6,
        }),
        async (root, pairs) => {
          const query = new URLSearchParams(pairs).toString();
          const response = await get(`${ORIGIN}${root}/CFDocuments?${query}`);
          expect([200, 400]).toContain(response.status);
          const body = jsonOf(response) as Record<string, unknown>;
          if (response.status === 400)
            expect(body).toMatchObject({ imsx_codeMajor: "failure", imsx_severity: "error" });
          else expect(body).toHaveProperty("CFDocuments");
        },
      ),
      { ...RUNS, numRuns: 150 },
    ));

  it("answers any path and method with an answer of the binding, and throws nothing", () =>
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.constantFrom("ims", "case", "v1p1", "v1p0", "CFDocuments", "CFItems", "discovery", ".", "..", ""),
            fc.string({ maxLength: 6 }),
          ),
          { maxLength: 7 },
        ),
        fc.constantFrom("GET", "POST", "HEAD"),
        async (segments, method) => {
          const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
          const response = await get(`${ORIGIN}/${path}`, method);
          expect([200, 404, 405]).toContain(response.status);
          expect(() => JSON.parse(String(response.body))).not.toThrow();
        },
      ),
      { ...RUNS, numRuns: 200 },
    ));
});

describe("queryEntities on any entities and any query", () => {
  const entities = fc.array(
    fc.dictionary(
      fc.constantFrom(...FIELDS.map((name) => name.split(".")[0] ?? name), "constructor", "__proto__"),
      fc.jsonValue({ maxDepth: 3 }),
    ),
    { maxLength: 12 },
  );
  const query = fc.record({ filter, sort: fc.constantFrom(...FIELDS) }, { requiredKeys: [] });

  it("returns some of the entities, in their order, when it filters", () => {
    fc.assert(
      fc.property(entities, filter, (rows, each) => {
        const found = queryEntities(rows, { filter: each });
        let index = 0;
        for (const row of found) {
          index = rows.indexOf(row, index);
          expect(index).toBeGreaterThanOrEqual(0);
          index += 1;
        }
      }),
      RUNS,
    );
  });

  it("splits the entities between = and != for a value", () => {
    fc.assert(
      fc.property(entities, fc.constantFrom(...FIELDS), TEXT, (rows, field, value) => {
        const equal = queryEntities(rows, { filter: { field, predicate: "=", value } });
        const unequal = queryEntities(rows, { filter: { field, predicate: "!=", value } });
        expect(equal.length + unequal.length).toBe(rows.length);
        for (const row of equal) expect(unequal).not.toContain(row);
      }),
      RUNS,
    );
  });

  it("returns the same entities, rearranged, when it sorts", () => {
    fc.assert(
      fc.property(
        entities,
        fc.constantFrom(...FIELDS),
        fc.constantFrom("asc", "desc", undefined),
        (rows, sort, orderBy) => {
          const found = queryEntities(rows, orderBy === undefined ? { sort } : { sort, orderBy });
          expect(found).toHaveLength(rows.length);
          expect([...found].sort((left, right) => rows.indexOf(left) - rows.indexOf(right))).toStrictEqual(rows);
        },
      ),
      RUNS,
    );
  });

  it("answers the same query with the same result", () => {
    fc.assert(
      fc.property(entities, query, (rows, each) => {
        expect(queryEntities(rows, each)).toStrictEqual(queryEntities(rows, each));
      }),
      RUNS,
    );
  });

  it("throws a DataError, and nothing else, for any query value", () => {
    fc.assert(
      fc.property(
        fc.anything({ withNullPrototype: true, withBigInt: true, withDate: true, withMap: true }),
        (value) => {
          try {
            queryEntities(documents(), value as never);
          } catch (error) {
            expect(error).toBeInstanceOf(DataError);
          }
        },
      ),
      RUNS,
    );
  });
});
