// biome-ignore-all lint/style/useNamingConvention: the names of the bodies of AGS and of its query parameters are those of the specification.

import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACTIVITY_PROGRESS, GRADING_PROGRESS, type LineItem, type Result, type Score } from "../src/index.js";
import {
  parseZonedDateTime,
  readLineItem,
  readLineItemInput,
  readLineItemQuery,
  readLineItems,
  readResult,
  readResultQuery,
  readResults,
  readScore,
  writeLineItem,
  writeLineItemInput,
  writeLineItemQuery,
  writeLineItems,
  writeResult,
  writeResultQuery,
  writeResults,
  writeScore,
} from "../src/protocol/internal.js";
import { FUZZ, fuzzJson } from "./fuzz.js";
import { expectRefusals, expectRefusesOtherTypes, plainJson } from "./services.js";

const URL_ = "https://lms.example.com/context/2923/lineitems/1";
const lineItem = {
  id: URL_,
  scoreMaximum: 60,
  label: "Chapter 5 Test",
  resourceId: "quiz-231",
  tag: "grade",
  resourceLinkId: "1g3k4dlk49fk",
  startDateTime: "2018-03-06T20:05:02Z",
  endDateTime: "2018-04-06T22:05:03Z",
};
const score = {
  timestamp: "2017-04-16T18:54:36.736+00:00",
  activityProgress: "Completed",
  gradingProgress: "PendingManual",
  userId: "5323497",
};
const result = { id: `${URL_}/results/5323497`, scoreOf: URL_, userId: "5323497", resultScore: 0.83, resultMaximum: 1 };

describe("the line item", () => {
  it("is read with every property that AGS 3.2 names, a map for the custom properties of its submission review, and the extensions", () => {
    const read = readLineItem({
      ...lineItem,
      activityId: "act-1",
      gradesReleased: true,
      submissionReview: {
        label: "Open",
        url: "https://tool.example.com/review",
        custom: { action: "review", __proto__x: "1" },
      },
      "https://www.toolexample.com/lti/lineitem": { weight: 2 },
      vendorThing: "ignored",
    });
    expect(read).toEqual({
      ...lineItem,
      activityId: "act-1",
      gradesReleased: true,
      submissionReview: {
        label: "Open",
        url: "https://tool.example.com/review",
        custom: new Map([
          ["action", "review"],
          ["__proto__x", "1"],
        ]),
      },
      extensions: { "https://www.toolexample.com/lti/lineitem": { weight: 2 } },
    });
    expect(Object.keys(read)).not.toContain("vendorThing");
  });

  it("reads a null or blank resourceId, tag, activityId, start and end as absent, as AGS 3.2 lets a platform send them", () => {
    const blank = {
      id: URL_,
      scoreMaximum: 1,
      label: "L",
      resourceId: null,
      resourceLinkId: "",
      tag: null,
      activityId: "",
      startDateTime: null,
      endDateTime: "",
    };
    expect(readLineItem(blank)).toEqual({ id: URL_, scoreMaximum: 1, label: "L" });
  });

  it("reads an empty submissionReview as a line item that supports review without options", () => {
    expect(readLineItem({ ...lineItem, submissionReview: {} }).submissionReview).toEqual({});
  });

  it("is refused when it breaks a rule of AGS 3.2", () => {
    expectRefusals(readLineItem, lineItem, [
      ["no id", { id: undefined }],
      ["an id that is not https", { id: "http://lms.example.com/li/1" }],
      ["no label", { label: undefined }],
      ["a blank label", { label: "  " }],
      ["no scoreMaximum", { scoreMaximum: undefined }],
      ["a scoreMaximum of 0", { scoreMaximum: 0 }],
      ["a negative scoreMaximum", { scoreMaximum: -1 }],
      ["a scoreMaximum that is a string", { scoreMaximum: "60" }],
      ["a start without a time zone designator", { startDateTime: "2018-03-06T20:05:02" }],
      ["an end that is a number", { endDateTime: 5 }],
      ["a resourceId that is a number", { resourceId: 5 }],
      ["a gradesReleased that is a string", { gradesReleased: "yes" }],
      ["a submission review URL that is http", { submissionReview: { url: "http://x.example/" } }],
      ["a submission review custom that holds a number", { submissionReview: { custom: { a: 1 } } }],
    ]);
    expectRefusesOtherTypes(readLineItem);
  });

  it("is read by the reader of a tool's input without the id, which a tool may echo", () => {
    const { id: _id, ...input } = lineItem;
    expect(readLineItemInput(input)).toEqual(input);
    expect(readLineItemInput(lineItem)).toEqual(input);
    expect(() => readLineItemInput({ ...input, scoreMaximum: 0 })).toThrow(DataError);
    expectRefusesOtherTypes(readLineItemInput);
  });

  it("is written as it is read, and refused when it breaks a rule of the sender", () => {
    expect(writeLineItem(readLineItem(lineItem))).toEqual(lineItem);
    const input = readLineItemInput(lineItem);
    for (const [name, change] of [
      ["a scoreMaximum of 0", { scoreMaximum: 0 }],
      ["a blank label", { label: " " }],
      ["an extension that is not a URL", { extensions: { vendor: 1 } }],
      ["an extension that names a member", { extensions: { id: 1 } }],
      ["a submission review URL that is http", { submissionReview: { url: "http://x.example/" } }],
    ] as const) {
      expect(() => writeLineItemInput({ ...input, ...change } as never), name).toThrow(DataError);
    }
    expect(() => writeLineItem({ ...readLineItem(lineItem), id: "http://x.example/" })).toThrow(DataError);
  });

  it("is read from and written to a container, which is a JSON array", () => {
    const items = readLineItems([lineItem, { ...lineItem, id: `${URL_}2` }]);
    expect(items.map(({ id }) => id)).toEqual([URL_, `${URL_}2`]);
    expect(writeLineItems(items)).toEqual([lineItem, { ...lineItem, id: `${URL_}2` }]);
    expect(readLineItems([])).toEqual([]);
    expect(() => readLineItems([lineItem, { ...lineItem, label: undefined }])).toThrow(/\[1\]/u);
    expectRefusesOtherTypes(readLineItems, [], ["[]"]);
  });
});

describe("the score", () => {
  it("is read with every property of AGS 3.4 and the extensions, and written as it is read", () => {
    const body = {
      ...score,
      scoringUserId: "inst-1",
      scoreGiven: 83,
      scoreMaximum: 100,
      comment: "Good",
      submission: { startedAt: "2017-04-16T18:00:00Z", submittedAt: "2017-04-16T18:30:00Z" },
      "https://www.toolexample.com/lti/score": { originality: 94 },
    };
    expect(writeScore(readScore(body))).toEqual(body);
  });

  it("orders the times of a submission by their instants, whatever offsets of AGS 3.4.8 they are written with", () => {
    const submission = (startedAt: string, submittedAt: string) =>
      readScore({ ...score, submission: { startedAt, submittedAt } });
    expect(submission("2017-04-16T18:54:36.736+00", "2017-04-16T19:00:00+00").submission).toEqual({
      startedAt: "2017-04-16T18:54:36.736+00",
      submittedAt: "2017-04-16T19:00:00+00",
    });
    expect(submission("2017-04-17T01:00:00+0700", "2017-04-16T18:30:00Z").submission?.startedAt).toBe(
      "2017-04-17T01:00:00+0700",
    );
    expect(() => submission("2017-04-16T19:00:00+00", "2017-04-17T01:59:00+07")).toThrow(
      /submittedAt not before startedAt/u,
    );
  });

  it("reads every activityProgress and gradingProgress that AGS names, and no other", () => {
    for (const activityProgress of ACTIVITY_PROGRESS)
      expect(readScore({ ...score, activityProgress }).activityProgress).toBe(activityProgress);
    for (const gradingProgress of GRADING_PROGRESS)
      expect(readScore({ ...score, gradingProgress }).gradingProgress).toBe(gradingProgress);
    expect(ACTIVITY_PROGRESS).toHaveLength(5);
    expect(GRADING_PROGRESS).toHaveLength(5);
    expect(() => readScore({ ...score, activityProgress: "Done" })).toThrow(DataError);
    expect(() => readScore({ ...score, gradingProgress: "Graded" })).toThrow(DataError);
  });

  it("reads a score that has no value, a null one included, as one that clears the score the platform holds", () => {
    expect(readScore({ ...score, scoreGiven: null, scoreMaximum: null, comment: null })).toEqual({
      ...score,
      scoreGiven: undefined,
      scoreMaximum: undefined,
      comment: undefined,
      scoringUserId: undefined,
      submission: undefined,
      extensions: undefined,
    });
  });

  it("accepts a scoreGiven above the scoreMaximum and a scoreGiven of 0, as AGS requires of a platform", () => {
    expect(readScore({ ...score, scoreGiven: 1.1, scoreMaximum: 1 }).scoreGiven).toBe(1.1);
    expect(readScore({ ...score, scoreGiven: 0, scoreMaximum: 1 }).scoreGiven).toBe(0);
  });

  it("reads the timestamps that AGS lists as valid, the one with +00 included, and refuses the ones that have no zone", () => {
    for (const timestamp of [
      "2017-04-16T18:54:36.736+00:00",
      "2017-04-16T18:54:36.736Z",
      "2017-04-16T18:54:36.736+00",
      "2017-04-16T18:54:36Z",
    ]) {
      expect(readScore({ ...score, timestamp }).timestamp, timestamp).toBe(timestamp);
    }
    for (const timestamp of ["2017-04-16T18:54:36", "2017-04-16", "yesterday", "2017-04-16T18:54:36.736+25"]) {
      expect(() => readScore({ ...score, timestamp }), timestamp).toThrow(DataError);
    }
  });

  // PHP writes `DATE_ISO8601` with an offset of `+hhmm`, and Moodle posts its scores with it: `2026-11-02T14:55:32+0000`. AGS has the
  // timestamp be ISO 8601 with a time zone, so the offset is read as the instant it names.
  it("reads an offset of +hhmm as the instant it names, and refuses an offset that is not one", () => {
    const instant = Date.parse("2017-04-16T18:54:36+05:30");
    expect(parseZonedDateTime("2017-04-16T18:54:36+0530")).toBe(instant);
    expect(parseZonedDateTime("2017-04-16T18:54:36.736-0000")).toBe(Date.parse("2017-04-16T18:54:36.736Z"));
    expect(readScore({ ...score, timestamp: "2026-11-02T14:55:32+0000" }).timestamp).toBe("2026-11-02T14:55:32+0000");
    for (const timestamp of [
      "2017-04-16T18:54:36+0099",
      "2017-04-16T18:54:36+25",
      "2017-04-16T18:54:36+053",
      "2017-04-16T185436+0530",
    ]) {
      expect(() => readScore({ ...score, timestamp }), timestamp).toThrow(DataError);
    }
  });

  it("is refused when it breaks a rule of AGS 3.4", () => {
    expectRefusals(readScore, score, [
      ["no timestamp", { timestamp: undefined }],
      ["no userId", { userId: undefined }],
      ["an empty userId", { userId: "" }],
      ["a userId of 256 characters", { userId: "u".repeat(256) }],
      ["a null scoringUserId", { scoringUserId: null }],
      ["an empty scoringUserId", { scoringUserId: "" }],
      ["no activityProgress", { activityProgress: undefined }],
      ["no gradingProgress", { gradingProgress: undefined }],
      ["a scoreGiven without a scoreMaximum", { scoreGiven: 5 }],
      ["a scoreGiven with a null scoreMaximum", { scoreGiven: 5, scoreMaximum: null }],
      ["a scoreGiven of -1", { scoreGiven: -1, scoreMaximum: 1 }],
      ["a scoreMaximum of 0", { scoreGiven: 1, scoreMaximum: 0 }],
      ["a comment that is a number", { comment: 5 }],
      [
        "a submittedAt before the startedAt",
        { submission: { startedAt: "2017-04-16T18:30:00Z", submittedAt: "2017-04-16T18:00:00Z" } },
      ],
      ["a startedAt without a zone", { submission: { startedAt: "2017-04-16T18:30:00" } }],
    ]);
    expectRefusesOtherTypes(readScore);
  });

  it("is written only with a user, a scoreMaximum beside a scoreGiven, and named extensions", () => {
    const body = readScore(score);
    for (const [name, change] of [
      ["an empty userId", { userId: "" }],
      ["a scoringUserId of 256 characters", { scoringUserId: "u".repeat(256) }],
      ["a scoreGiven without a scoreMaximum", { scoreGiven: 1 }],
      ["a scoreGiven with a scoreMaximum of 0", { scoreGiven: 1, scoreMaximum: 0 }],
      ["an extension that is not a URL", { extensions: { vendor: 1 } }],
    ] as const) {
      expect(() => writeScore({ ...body, ...change } as Score), name).toThrow(DataError);
    }
  });
});

describe("the result", () => {
  it("is read with a null score and comment as absent, and written as it is read", () => {
    expect(readResult({ ...result, resultScore: null, comment: null })).toMatchObject({
      resultScore: undefined,
      comment: undefined,
    });
    const body = {
      ...result,
      scoringUserId: "inst-1",
      comment: "Fine",
      "https://www.toolexample.com/lti/result": { rank: 1 },
    };
    expect(writeResult(readResult(body))).toEqual(body);
    expect(writeResults(readResults([body]))).toEqual([body]);
  });

  it("is refused when it breaks a rule of AGS 3.3", () => {
    expectRefusals(readResult, result, [
      ["no id", { id: undefined }],
      ["no scoreOf", { scoreOf: undefined }],
      ["a scoreOf that is http", { scoreOf: "http://lms.example.com/li/1" }],
      ["no userId", { userId: undefined }],
      ["a resultScore that is a string", { resultScore: "0.8" }],
      ["a resultMaximum of 0", { resultMaximum: 0 }],
      ["a negative resultMaximum", { resultMaximum: -2 }],
      ["an empty scoringUserId", { scoringUserId: "" }],
    ]);
    expectRefusesOtherTypes(readResult);
    expectRefusesOtherTypes(readResults, ["[null]"], ["[]"]);
  });

  it("is written only with https addresses and named extensions", () => {
    const body = readResult(result);
    expect(() => writeResult({ ...body, id: "http://x.example/" })).toThrow(DataError);
    expect(() => writeResult({ ...body, scoreOf: "x" })).toThrow(DataError);
    expect(() => writeResult({ ...body, extensions: { vendor: 1 } })).toThrow(DataError);
  });
});

describe("the filters of a request", () => {
  it("read the five filters of line items of AGS, and the two of its results", () => {
    const search = new URLSearchParams(
      "resource_id=d0d6&resource_link_id=l1&tag=grade&activity_id=a1&limit=25&other=1",
    );
    expect(readLineItemQuery(search)).toEqual({
      resourceId: "d0d6",
      resourceLinkId: "l1",
      tag: "grade",
      activityId: "a1",
      limit: 25,
    });
    expect(readLineItemQuery(new URLSearchParams())).toEqual({
      resourceId: undefined,
      resourceLinkId: undefined,
      tag: undefined,
      activityId: undefined,
      limit: undefined,
    });
    expect(readResultQuery(new URLSearchParams("user_id=u1&limit=1"))).toEqual({ userId: "u1", limit: 1 });
  });

  it("are written as read, and a parameter that is not given is not written", () => {
    expect(writeLineItemQuery({ resourceId: "d0d6", activityId: "a1", limit: 3 }).toString()).toBe(
      "resource_id=d0d6&activity_id=a1&limit=3",
    );
    expect(writeLineItemQuery({}).toString()).toBe("");
    expect(writeResultQuery({ userId: "u 1" }).toString()).toBe("user_id=u+1");
    const query = { resourceId: "a b&c", resourceLinkId: "x", tag: "t", activityId: "y", limit: 9 };
    expect(readLineItemQuery(writeLineItemQuery(query))).toEqual(query);
  });

  it("refuse a parameter that is given twice and a limit that is not a positive integer", () => {
    for (const text of [
      "tag=a&tag=b",
      "limit=1&limit=2",
      "limit=0",
      "limit=-1",
      "limit=1.5",
      "limit=abc",
      "limit=",
      "limit=1e3",
      "limit=99999999999999999999",
    ]) {
      expect(() => readLineItemQuery(new URLSearchParams(text)), text).toThrow(DataError);
    }
    expect(() => readResultQuery(new URLSearchParams("user_id=a&user_id=b"))).toThrow(DataError);
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => writeLineItemQuery({ limit }), String(limit)).toThrow(DataError);
      expect(() => writeResultQuery({ limit }), String(limit)).toThrow(DataError);
    }
  });
});

const text = fc.string({ minLength: 1, maxLength: 10 });
const link = text.map((path) => `https://lms.example.com/${encodeURIComponent(path)}`);
const some = <TValue>(value: fc.Arbitrary<TValue>) => fc.option(value, { nil: undefined });
const zoned = fc
  .date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true })
  .map((date) => date.toISOString());
const extensions = some(fc.dictionary(link, plainJson, { minKeys: 1, maxKeys: 2 }));

describe("the bodies of AGS", () => {
  it("read back what was written, for any line item, score and result", () => {
    const review = fc.record({
      label: some(text),
      url: some(link),
      custom: some(fc.dictionary(text, text, { maxKeys: 2 }).map((entries) => new Map(Object.entries(entries)))),
    });
    const item = fc.record({
      id: link,
      scoreMaximum: fc.double({ min: 0.001, max: 1e6, noNaN: true }),
      label: text.filter((label) => label.trim() !== ""),
      resourceId: some(text),
      resourceLinkId: some(text),
      tag: some(text),
      startDateTime: some(zoned),
      endDateTime: some(zoned),
      activityId: some(text),
      gradesReleased: some(fc.boolean()),
      submissionReview: some(review),
      extensions,
    });
    const scores = fc.record({
      userId: text,
      scoringUserId: some(text),
      scoreGiven: some(fc.double({ min: 0, max: 1e6, noNaN: true })),
      comment: some(text),
      timestamp: zoned,
      activityProgress: fc.constantFrom(...ACTIVITY_PROGRESS),
      gradingProgress: fc.constantFrom(...GRADING_PROGRESS),
      submission: some(fc.record({ startedAt: some(zoned), submittedAt: fc.constant(undefined) })),
      extensions,
    });
    const results = fc.record({
      id: link,
      scoreOf: link,
      userId: text,
      resultScore: some(
        fc.double({ noNaN: true, noDefaultInfinity: true }).map((number) => (Object.is(number, -0) ? 0 : number)),
      ),
      resultMaximum: some(fc.double({ min: 0.001, max: 1e6, noNaN: true })),
      scoringUserId: some(text),
      comment: some(text),
      extensions,
    });
    const clean = <TValue extends object>(value: TValue): TValue =>
      JSON.parse(JSON.stringify(value, (_, member) => (member instanceof Map ? Object.fromEntries(member) : member)));
    fc.assert(
      fc.property(item, scores, results, (lineItemValue: LineItem, scoreValue, resultValue: Result) => {
        const fullScore: Score = { ...scoreValue, scoreMaximum: scoreValue.scoreGiven === undefined ? undefined : 100 };
        expect(readLineItem(clean(writeLineItem(lineItemValue)))).toEqual(lineItemValue);
        expect(readScore(clean(writeScore(fullScore)))).toEqual(fullScore);
        expect(readResult(clean(writeResult(resultValue)))).toEqual(resultValue);
      }),
      FUZZ,
    );
  });

  it("return a value or throw a DataError for any JSON, and for the examples with any value replaced", () => {
    fuzzJson(readLineItem, [lineItem]);
    fuzzJson(readLineItemInput, [lineItem]);
    fuzzJson(readLineItems, [[lineItem]]);
    fuzzJson(readScore, [score]);
    fuzzJson(readResult, [result]);
    fuzzJson(readResults, [[result]]);
  });
});
