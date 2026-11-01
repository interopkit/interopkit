import { DataError, ServiceError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { caseFilter, readStatusInfo } from "../src/client/index.js";
import { hasNextLink, queryString, totalCountOf } from "../src/client/internal.js";
import { type CaseFilter, FILTER_PREDICATES } from "../src/index.js";
import { parseCaseQuery } from "../src/provider/index.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_105, numRuns: 400 };

/** Values of every kind that JSON or JavaScript can hand over. */
const anything = fc.oneof(fc.jsonValue(), fc.anything({ withNullPrototype: true, withBigInt: true, withDate: true }));

/** Fields of a document, which the provider of this package accepts in a filter. */
const FIELDS = [
  "identifier",
  "title",
  "creator",
  "version",
  "adoptionStatus",
  "lastChangeDateTime",
  "licenseURI.title",
  "extensions.level",
];
const condition = fc.record({
  field: fc.constantFrom(...FIELDS),
  predicate: fc.constantFrom(...FILTER_PREDICATES),
  // Free text, and text made of the pieces that a filter is made of, so that quotes next to operators are common.
  value: fc.oneof(
    fc.string({ unit: "grapheme", maxLength: 24 }),
    fc
      .array(fc.constantFrom("a", "'", " ", " AND ", " OR ", "=", "~", "''"), { maxLength: 8 })
      .map((pieces) => pieces.join("")),
  ),
});
const filter: fc.Arbitrary<CaseFilter> = fc.oneof(
  condition,
  fc.tuple(condition, condition).map(([first, second]) => ({ and: [first, second] }) as const),
  fc.tuple(condition, condition).map(([first, second]) => ({ or: [first, second] }) as const),
);

describe("caseFilter and the filter of the binding", () => {
  it("writes what the provider of this package reads back as the same filter", () => {
    fc.assert(
      fc.property(filter, (original) => {
        const read = parseCaseQuery(new Map([["filter", caseFilter(original)]]));
        // `toEqual`: the generator may build objects without a prototype, which the comparison would tell apart.
        expect(read).toEqual({ filter: original });
      }),
      RUNS,
    );
  });

  it("answers with text or a DataError for a value of any kind, and no other error", () => {
    fc.assert(
      fc.property(anything, (value) => {
        try {
          expect(typeof caseFilter(value as never)).toBe("string");
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      RUNS,
    );
  });
});

describe("the parameters of a request on any query", () => {
  it("are text or a DataError for a query of any kind, and encode every character that is not safe", () => {
    fc.assert(
      fc.property(anything, (value) => {
        try {
          const text = queryString(value, { limit: 100, offset: 0 });
          expect(text).toMatch(/^limit=100&offset=0(&[A-Za-z]+=[A-Za-z0-9_.~%,-]*)*$/u);
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      RUNS,
    );
  });
});

describe("the readers of the headers and of an error on any text", () => {
  it("give a count or nothing, and a flag or nothing", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const count = totalCountOf({ "x-total-count": text });
        expect(count === undefined || (Number.isSafeInteger(count) && count >= 0)).toBe(true);
        expect([true, false]).toContain(hasNextLink({ link: text }));
      }),
      RUNS,
    );
  });

  it("find a next page in a Link header of well-formed values, wherever the next one is", () => {
    const address = fc.stringMatching(/^https:\/\/[a-z]{1,8}\.example\/[a-z?=&,;]{0,12}$/u);
    const relation = fc.constantFrom("first", "last", "prev", "self");
    fc.assert(
      fc.property(
        fc.array(fc.tuple(address, relation), { maxLength: 4 }),
        fc.nat(4),
        address,
        (others, place, next) => {
          const values = others.map(([target, rel]) => `<${target}>; rel="${rel}"`);
          expect(hasNextLink({ link: values.join(", ") })).toBe(false);
          values.splice(Math.min(place, values.length), 0, `<${next}>; rel="next"`);
          expect(hasNextLink({ link: values.join(", ") })).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("read the status of an error whose body is any text, and throw nothing", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (body, delay) => {
        const detail = readStatusInfo(new ServiceError("Busy.", 429, body, { headers: { "retry-after": delay } }));
        expect(detail.retryAfterSeconds === undefined || Number.isSafeInteger(detail.retryAfterSeconds)).toBe(true);
      }),
      RUNS,
    );
  });
});
