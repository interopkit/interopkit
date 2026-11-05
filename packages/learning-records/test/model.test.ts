import { DataError } from "@interopkit/core";
import { formatDateTime, isDateTime, parseDateTime } from "@interopkit/core/checks";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_ACTIVITY_TYPES,
  findStatementTime,
  formatDuration,
  INTERACTION_TYPES,
  isDuration,
  parseDuration,
  RULE_ROLES,
  VERB_VOIDED,
} from "../src/index.js";
import {
  durationKey,
  hasFinerThanCentiseconds,
  hasMillisecondPrecision,
  isMailtoIri,
  isMediaType,
  isSha1Hex,
  isSha2Hex,
  isUtc,
  splitDuration,
} from "../src/model/internal.js";
import { minimalStatement } from "./full-statement.js";

describe("the vocabularies", () => {
  it("are those of the tables of the standard", () => {
    expect(INTERACTION_TYPES).toStrictEqual([
      "true-false",
      "choice",
      "fill-in",
      "long-fill-in",
      "matching",
      "performance",
      "sequencing",
      "likert",
      "numeric",
      "other",
    ]);
    expect(CONTEXT_ACTIVITY_TYPES).toStrictEqual(["parent", "grouping", "category", "other"]);
    expect(RULE_ROLES).toStrictEqual(["lrs", "provider"]);
    expect(VERB_VOIDED).toBe("http://adlnet.gov/expapi/verbs/voided");
  });
});

describe("the duration of ISO 8601", () => {
  it.each([
    "PT0S",
    "P0D",
    "PT1S",
    "PT1.5S",
    "PT1,5S",
    "PT4H35M59.14S",
    "P1Y2M3DT4H5M6S",
    "P3Y6M4DT12H30M5S",
    "P1W",
    "P1.5W",
    "PT36H",
    "P1Y",
    "P0.5Y",
    "P1M",
    "PT1M",
    "PT0.5H",
    "PT1H30.5M",
    "P1DT1S",
    "PT1234S",
    "P0001Y",
  ])("reads %j as a duration", (text) => {
    expect(isDuration(text)).toBe(true);
  });

  it.each([
    "",
    "P",
    "PT",
    "P1DT",
    "T1H",
    "1H",
    "pt1h",
    "PT1H1H",
    "PT1S1M",
    "P1D2Y",
    "P1W2D",
    "P1Y2W",
    "PT1.5H30M",
    "P0.5Y1M",
    "PT-1S",
    "P-1D",
    "PT1.S",
    "PT.5S",
    "PT1e2S",
    "P0001-00-00T00:00:00",
    "P0001-01-01",
    "01:30:00",
    " PT1H",
    "PT1H ",
    "PT1H\n",
    "PT１S",
    "P1H",
    "PT1D",
  ])("refuses %j", (text) => {
    expect(isDuration(text)).toBe(false);
  });

  it("splits a duration into the components as they are written", () => {
    expect(splitDuration("P3Y6M4DT12H30M5.25S")).toStrictEqual({
      years: "3",
      months: "6",
      days: "4",
      hours: "12",
      minutes: "30",
      seconds: "5.25",
    });
    expect(splitDuration("P2W")).toStrictEqual({ weeks: "2" });
    expect(splitDuration("PT1M")).toStrictEqual({ minutes: "1" });
    expect(splitDuration("P1M")).toStrictEqual({ months: "1" });
    expect(splitDuration("PT1,5S")).toStrictEqual({ seconds: "1,5" });
  });

  it.each([
    ["PT1H", false],
    ["PT1S", false],
    ["PT1.2S", false],
    ["PT1.25S", false],
    ["PT1.250S", true],
    ["PT1.253S", true],
    ["PT1,2345S", true],
    ["PT0.001S", true],
    ["PT1.2345H", false],
  ])("tells whether %j has seconds finer than 0.01 second: %s", (text, finer) => {
    expect(hasFinerThanCentiseconds(splitDuration(text) ?? {})).toBe(finer);
  });
});

describe("the form of a time", () => {
  it.each([
    ["2024-06-13T18:46:03Z", true],
    ["2024-06-13T18:46:03z", true],
    ["2024-06-13T18:46:03.250+00:00", true],
    ["2024-06-13T18:46:03-00:00", true],
    ["2024-06-13T18:46:03+01:00", false],
    ["2024-06-13T18:46:03+00:30", false],
    ["2024-06-13T18:46:03-05:00", false],
    ["2024-06-13T18:46:03", false],
  ])("tells whether %j is in UTC: %s", (text, utc) => {
    expect(isUtc(text)).toBe(utc);
  });

  it.each([
    ["2024-06-13T18:46:03.250Z", true],
    ["2024-06-13T18:46:03.2504Z", true],
    ["2024-06-13T18:46:03.250+02:00", true],
    ["2024-06-13T18:46:03.25Z", false],
    ["2024-06-13T18:46:03.2Z", false],
    ["2024-06-13T18:46:03Z", false],
    ["2024-06-13T18:46:03.Z", false],
  ])("tells whether %j has milliseconds: %s", (text, precise) => {
    expect(hasMillisecondPrecision(text)).toBe(precise);
  });

  const statementAt = (timestamp: string | undefined) => ({
    ...minimalStatement(),
    ...(timestamp === undefined ? {} : { timestamp }),
  });
  const instant = Date.UTC(2024, 5, 13, 18, 46, 3, 250);

  it.each([
    ["a time of 2.0", "2024-06-13T18:46:03.250Z"],
    ["a time of 2.0 with an offset", "2024-06-13T20:46:03.250+02:00"],
    ["a time of 2.0 in lower case", "2024-06-13t18:46:03.250z"],
    ["a time of 2.0 with an unknown offset, which RFC 3339 allows", "2024-06-13T18:46:03.250-00:00"],
    ["a time of 1.0.3 in the basic format", "20240613T184603.250Z"],
    ["a time of 1.0.3 in the basic format with an offset", "20240613T204603.250+0200"],
    ["a time of 1.0.3 with an offset of hours", "2024-06-13T20:46:03.250+02"],
  ])("reads the time of a Statement with %s", (_name, timestamp) => {
    expect(findStatementTime(statementAt(timestamp))).toBe(instant);
  });

  it("reads a time of 1.0.3 whose minutes or seconds are left out", () => {
    expect(findStatementTime(statementAt("2024-06-13T18:46Z"))).toBe(Date.UTC(2024, 5, 13, 18, 46));
    expect(findStatementTime(statementAt("20240613T18Z"))).toBe(Date.UTC(2024, 5, 13, 18));
  });

  it("reads a time of 2.0 in the forms that the LRS takes and writes in UTC: a space or t, and no seconds", () => {
    expect(findStatementTime(statementAt("2024-06-13 18:46:03.250Z"))).toBe(instant);
    expect(findStatementTime(statementAt("2024-06-13t20:46:03.250+02:00"))).toBe(instant);
    expect(findStatementTime(statementAt("2024-06-13 18:46+00:00"))).toBe(Date.UTC(2024, 5, 13, 18, 46));
  });

  it("finds no time in a timestamp that is not text, and refuses a Statement that is no object", () => {
    expect(findStatementTime(JSON.parse('{ "timestamp": ["2024-06-13T18:46:03.250Z"] }'))).toBeUndefined();
    expect(findStatementTime(JSON.parse('{ "timestamp": 1718304363250 }'))).toBeUndefined();
    for (const value of ["null", '"2024-06-13T18:46:03.250Z"', "[]"]) {
      expect(() => findStatementTime(JSON.parse(value))).toThrow(DataError);
    }
  });

  it.each([
    undefined,
    "2024-06-13 18:46:03",
    "2024-06-13T18:46:03",
    "2024-06-13T20:46:03+0200",
    "20240613T204603-0000",
    "2023-02-29T00:00:00Z",
    "yesterday",
  ])("finds no time in a Statement whose timestamp is %j", (timestamp) => {
    expect(findStatementTime(statementAt(timestamp))).toBeUndefined();
  });
});

describe("the forms of the strings of the tables", () => {
  it.each([
    ["mailto:learner@example.org", true],
    ["mailto:a+b@example.org", true],
    ["mailto:learner@localhost", true],
    ["learner@example.org", false],
    ["mailto:", false],
    ["mailto:learner", false],
    ["mailto:@example.org", false],
    ["mailto:learner@", false],
    ["mailto:a@b.example,c@d.example", false],
    ["mailto:a@b.example?subject=x", false],
    ["mailto:a b@example.org", false],
    ["mailto:a@@example.org", false],
    ["MAILTO:learner@example.org", false],
    ["", false],
  ])("tells whether %j is a mailto IRI with one address: %s", (text, valid) => {
    expect(isMailtoIri(text)).toBe(valid);
  });

  it.each([
    ["e1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e90", true],
    ["E1A3E0B9A25C7A7F6E1B4C7D1E4D9B1F3A5C7E90", true],
    ["e1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e9", false],
    ["e1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e900", false],
    ["g1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e90", false],
    ["", false],
  ])("tells whether %j is a SHA-1 hash in hexadecimal: %s", (text, valid) => {
    expect(isSha1Hex(text)).toBe(valid);
  });

  it.each([
    [56, true],
    [64, true],
    [96, true],
    [128, true],
    [40, false],
    [63, false],
    [65, false],
    [0, false],
  ])("tells whether %i hexadecimal digits are a SHA-2 hash: %s", (length, valid) => {
    expect(isSha2Hex("ab".repeat(length / 2).padEnd(length, "c"))).toBe(valid);
  });

  it("refuses a SHA-2 hash that has a digit that is not hexadecimal", () => {
    expect(isSha2Hex(`${"a".repeat(63)}g`)).toBe(false);
  });

  it.each([
    ["application/octet-stream", true],
    ["text/plain; charset=utf-8", true],
    ["text/plain;charset=utf-8", true],
    ['multipart/mixed; boundary="a b\\"c"', true],
    ["application/vnd.api+json", true],
    ["image/svg+xml; a=1; b=2", true],
    ["application", false],
    ["application/", false],
    ["/json", false],
    ["application/json;", false],
    ["application/json; charset", false],
    ["application/json; charset=", false],
    ["octet stream", false],
    ["text/plain, text/html", false],
    ["", false],
  ])("tells whether %j is an Internet media type: %s", (text, valid) => {
    expect(isMediaType(text)).toBe(valid);
  });
});

describe("parseDuration", () => {
  it.each([
    ["PT1H30M", { years: 0, months: 0, days: 0, hours: 1, minutes: 30, seconds: 0 }],
    ["P3Y6M4DT12H30M5.25S", { years: 3, months: 6, days: 4, hours: 12, minutes: 30, seconds: 5.25 }],
    ["P2W", { years: 0, months: 0, days: 14, hours: 0, minutes: 0, seconds: 0 }],
    ["P1.5W", { years: 0, months: 0, days: 10.5, hours: 0, minutes: 0, seconds: 0 }],
    ["PT1,5S", { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 1.5 }],
    ["P1M", { years: 0, months: 1, days: 0, hours: 0, minutes: 0, seconds: 0 }],
    ["PT1M", { years: 0, months: 0, days: 0, hours: 0, minutes: 1, seconds: 0 }],
    ["PT0S", { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }],
  ])("reads %j into its components", (text, expected) => {
    expect(parseDuration(text)).toStrictEqual(expected);
  });

  it.each(["", "P", "1H", "PT1H1H", "P0001-00-00T00:00:00"])("refuses %j, which is not a duration", (text) => {
    expect(() => parseDuration(text)).toThrow(DataError);
    expect(isDuration(text)).toBe(false);
  });

  it("names the text in the error that it throws", () => {
    expect(() => parseDuration("1H")).toThrow('found "1H"');
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "PT0S"],
    [9, "PT0S"],
    [10, "PT0.01S"],
    [90, "PT0.09S"],
    [100, "PT0.1S"],
    [1000, "PT1S"],
    [1500, "PT1.5S"],
    [59_990, "PT59.99S"],
    [59_999, "PT59.99S"],
    [60_000, "PT1M"],
    [1_234_000, "PT20M34S"],
    [3_600_000, "PT1H"],
    [3_661_010, "PT1H1M1.01S"],
    [5_432_150, "PT1H30M32.15S"],
    [86_400_000, "PT24H"],
    [Number.MAX_SAFE_INTEGER, "PT2501999792H59M0.99S"],
  ])("writes %i milliseconds as %s, cutting what is finer than 0.01 second", (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it("writes a duration that reads back to the time cut at 0.01 second, for any time", () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000_000_000_000 }), (milliseconds) => {
        const text = formatDuration(milliseconds);
        const { hours, minutes, seconds } = parseDuration(text);
        expect(Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000)).toBe(Math.floor(milliseconds / 10) * 10);
        expect(hasFinerThanCentiseconds(splitFor(text))).toBe(false);
      }),
      { seed: 20_241_102, numRuns: 300 },
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "1000", null, undefined, {}])(
    "refuses %j, which is not a whole number of milliseconds from 0",
    (value) => {
      expect(() => formatDuration(value as number)).toThrow(DataError);
      expect(() => formatDuration(value as number)).toThrow(
        /^The duration in milliseconds must be a non-negative integer, found /,
      );
    },
  );
});

/** The components of a duration that is known to be one. */
function splitFor(text: string) {
  return splitDuration(text) ?? {};
}

describe("durationKey", () => {
  it.each([
    ["PT1H", "PT60M"],
    ["PT1H", "PT3600S"],
    ["PT1H", "PT3600.004S"],
    ["PT59.14S", "PT59.149S"],
    ["PT0.1S", "PT0.10S"],
    ["PT0.1S", "PT0,1S"],
    ["PT0.3H", "PT18M"],
    ["PT0.123456H", "PT444.44S"],
    ["P1W", "P7D"],
    ["P0D", "PT0S"],
    ["PT0.29S", "PT0.299S"],
  ])("gives %s and %s one key", (a, b) => {
    expect(durationKey(a)).toBe(durationKey(b));
  });

  it.each([
    ["PT1H", "PT1H0.01S"],
    ["PT1H", "PT1M"],
    ["P1D", "PT24H"],
    ["P1M", "PT1M"],
    ["P1Y", "P12M"],
    ["PT0.29S", "PT0.3S"],
    ["PT0.1S", "PT0.2S"],
  ])("gives %s and %s two keys", (a, b) => {
    expect(durationKey(a)).not.toBe(durationKey(b));
  });

  it("returns nothing for what is not a duration", () => {
    expect(durationKey("1:30")).toBeUndefined();
  });
});

describe("the Timestamp that a provider writes", () => {
  it("writes a time that reads back to the same instant, in UTC with milliseconds, for any instant", () => {
    fc.assert(
      fc.property(fc.integer({ min: -62_167_219_200_000, max: 253_402_300_799_999 }), (milliseconds) => {
        const text = formatDateTime(milliseconds);
        expect(isDateTime(text)).toBe(true);
        expect(parseDateTime(text)).toBe(milliseconds);
        expect(isUtc(text) && hasMillisecondPrecision(text)).toBe(true);
      }),
      { seed: 20_241_102, numRuns: 300 },
    );
  });
});
