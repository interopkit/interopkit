import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataError, hasNextLink, linkTarget, retryAfterSeconds, ServiceError, totalCountOf } from "../src/index.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_106, numRuns: 400 };

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
    expect(hasNextLink({ link: '<https://x.example/a;rel=next;b=c>; rel="first"' })).toBe(false);
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

describe("the address of a link", () => {
  const Page = "https://lms.example.edu/api/lti/courses/7/line_items?limit=2";

  it("is the address of the relation, resolved against the request, on the request's origin", () => {
    const link =
      '<https://lms.example.edu/api/lti/courses/7/line_items?page=2&limit=2>; rel="next", <https://lms.example.edu/api/lti/courses/7/line_items?page=1&limit=2>; rel="first"';
    expect(linkTarget({ link }, "next", Page)).toBe(
      "https://lms.example.edu/api/lti/courses/7/line_items?page=2&limit=2",
    );
    expect(linkTarget({ link }, "first", Page)).toBe(
      "https://lms.example.edu/api/lti/courses/7/line_items?page=1&limit=2",
    );
    expect(linkTarget({ link: "</api/lti/courses/7/line_items?page=3>; rel=NEXT" }, "next", Page)).toBe(
      "https://lms.example.edu/api/lti/courses/7/line_items?page=3",
    );
    expect(linkTarget({ link: "<line_items?page=4>; rel=next" }, "next", Page)).toBe(
      "https://lms.example.edu/api/lti/courses/7/line_items?page=4",
    );
    expect(linkTarget({ link: '<memberships?since=abc>; rel="differences"' }, "Differences", Page)).toBe(
      "https://lms.example.edu/api/lti/courses/7/memberships?since=abc",
    );
  });

  it("is nothing when it leaves the origin, the scheme or carries user information, so that a token stays with its server", () => {
    for (const target of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "http://lms.example.edu/api",
      "https://lms.example.edu:8443/api",
      "https://lms.example.edu.evil.example/api",
      "https://user:secret@lms.example.edu/api",
      "https://user@lms.example.edu/api",
      "javascript:alert(1)",
      "https://[::1/",
    ]) {
      expect(linkTarget({ link: `<${target}>; rel="next"` }, "next", Page), target).toBeUndefined();
    }
  });

  it("is that of the first value with the relation, and nothing without one or without a header", () => {
    const link = '<https://evil.example/a>; rel="next", <https://lms.example.edu/b>; rel="next"';
    expect(linkTarget({ link }, "next", Page)).toBeUndefined();
    expect(linkTarget({ link: '<https://lms.example.edu/a>; rel="prev"' }, "next", Page)).toBeUndefined();
    expect(linkTarget({ link: '<https://lms.example.edu/a?rel=next;rel=next>; rel="first"' }, "next", Page)).toBe(
      undefined,
    );
    expect(linkTarget({}, "next", Page)).toBeUndefined();
  });

  it("refuses a relation or a request URL of other types", () => {
    expect(() => linkTarget({}, "", Page)).toThrow(new DataError('The relation must be a non-empty string, found "".'));
    expect(() => linkTarget({}, "next", "http://lms.example.edu/")).toThrow(
      new DataError('The request URL must be an absolute https URL, found "http://lms.example.edu/".'),
    );
    expect(() => linkTarget({}, JSON.parse("null"), Page)).toThrow(DataError);
  });

  it("is an https address on the origin of the request, or nothing, for any header", () => {
    fc.assert(
      fc.property(fc.string(), fc.webUrl(), (text, url) => {
        for (const link of [text, `<${url}>; rel="next"`]) {
          const target = linkTarget({ link }, "next", Page);
          if (target !== undefined) expect(new URL(target).origin).toBe("https://lms.example.edu");
        }
      }),
      RUNS,
    );
  });
});

describe("the retry header", () => {
  it("is read when it gives a number of seconds, and not when it gives a date or anything else", () => {
    expect(retryAfterSeconds({ "retry-after": "30" })).toBe(30);
    expect(retryAfterSeconds({ "retry-after": " 7 " })).toBe(7);
    expect(retryAfterSeconds({ "retry-after": "0" })).toBe(0);
    for (const value of ["Wed, 21 Oct 2026 07:28:00 GMT", "-5", "1e3", "soon", "", "9999999999999999", "1 2"]) {
      expect(retryAfterSeconds({ "retry-after": value })).toBeUndefined();
    }
    expect(retryAfterSeconds({})).toBeUndefined();
  });

  it("reads the headers of a ServiceError as the call gave them", () => {
    const error = new ServiceError("Busy.", 429, "", { headers: { "retry-after": "12", "x-total-count": "3" } });
    expect(retryAfterSeconds(error.headers)).toBe(12);
    expect(totalCountOf(error.headers)).toBe(3);
  });
});

describe("the readers of the headers on any text", () => {
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

  it("give a number of seconds or nothing", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const seconds = retryAfterSeconds({ "retry-after": text });
        expect(seconds === undefined || (Number.isSafeInteger(seconds) && seconds >= 0)).toBe(true);
      }),
      RUNS,
    );
  });
});
