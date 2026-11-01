import { describe, expect, it } from "vitest";
import { CONTEXT_ACTIVITY_TYPES, INTERACTION_TYPES, RULE_ROLES, VERB_VOIDED } from "../src/index.js";
import {
  hasFinerThanCentiseconds,
  hasMillisecondPrecision,
  isDuration,
  isMailtoIri,
  isMediaType,
  isSha1Hex,
  isSha2Hex,
  isUtc,
  splitDuration,
} from "../src/model/internal.js";

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
