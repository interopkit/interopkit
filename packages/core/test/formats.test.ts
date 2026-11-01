import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  absoluteUriSchema,
  dateSchema,
  dateTimeSchema,
  isAbsoluteUri,
  isDate,
  isDateTime,
  isLanguageTag,
  isUuid,
  languageTagSchema,
  parseDateTime,
  uuidSchema,
} from "../src/checks.js";

describe("isDate", () => {
  it.each([
    ["2024-06-13", true],
    ["2024-02-29", true],
    ["2000-02-29", true],
    ["1900-02-29", false],
    ["2023-02-29", false],
    ["2024-04-31", false],
    ["2024-00-10", false],
    ["2024-13-10", false],
    ["2024-06-00", false],
    ["2024-06-13T00:00:00Z", false],
    ["13/06/2024", false],
    ["2024-6-13", false],
    ["", false],
  ])("reads %j as a date that exists: %s", (text, expected) => {
    expect(isDate(text)).toBe(expected);
  });
});

describe("parseDateTime", () => {
  const instant = Date.UTC(2017, 3, 16, 18, 54, 36, 736);

  it.each([
    "2017-04-16T18:54:36.736Z",
    "2017-04-16T18:54:36.736+00:00",
    "2017-04-16T13:54:36.736-05:00",
    "2017-04-16T20:24:36.736+01:30",
    "2017-04-16t18:54:36.736z",
    "2017-04-16T18:54:36.736999Z",
  ])("reads %s to the instant that it names", (text) => {
    expect(parseDateTime(text)).toBe(instant);
  });

  it("keeps the first three digits of a fraction of a second, and none when there is no fraction", () => {
    expect(parseDateTime("2017-04-16T18:54:36Z")).toBe(instant - 736);
    expect(parseDateTime("2017-04-16T18:54:36.7Z")).toBe(instant - 36);
    expect(parseDateTime("2017-04-16T18:54:36.73Z")).toBe(instant - 6);
  });

  it("reads the largest offsets that exist, and no larger one", () => {
    const utc = Date.UTC(2017, 3, 16, 18, 54, 36);
    expect(parseDateTime("2017-04-17T18:53:36+23:59")).toBe(utc);
    expect(parseDateTime("2017-04-15T18:55:36-23:59")).toBe(utc);
    expect(parseDateTime("2017-04-16T18:54:36+24:00")).toBeUndefined();
    expect(parseDateTime("2017-04-16T18:54:36+00:60")).toBeUndefined();
  });

  it("reads a year below 100 as that year, which Date.UTC reads as 1900 and more", () => {
    expect(new Date(parseDateTime("0050-01-01T00:00:00Z") ?? Number.NaN).getUTCFullYear()).toBe(50);
  });

  it("reads a leap second at 23:59 as the second that follows, and no other second 60", () => {
    expect(parseDateTime("2016-12-31T23:59:60Z")).toBe(Date.UTC(2017, 0, 1, 0, 0, 0));
    expect(parseDateTime("2016-12-31T23:58:60Z")).toBeUndefined();
    expect(parseDateTime("2016-12-31T22:59:60Z")).toBeUndefined();
    expect(parseDateTime("2016-12-31T23:59:61Z")).toBeUndefined();
  });

  it.each([
    "2023-02-29T00:00:00Z",
    "2024-04-31T00:00:00Z",
    "2024-13-01T00:00:00Z",
    "2024-06-13T24:00:00Z",
    "2024-06-13T18:60:00Z",
    "2024-06-13T18:46:03",
    "2024-06-13",
    "2024-06-13 18:46:03Z",
    "2024-06-13T18:46:03+0000",
    "2024-06-13T18:46:03+00",
    "2024-6-13T18:46:03Z",
    "2024-06-13T18:46:03.Z",
    "",
  ])("refuses %j", (text) => {
    expect(parseDateTime(text)).toBeUndefined();
    expect(isDateTime(text)).toBe(false);
  });

  it("says that a date and time that is read is one", () => {
    expect(isDateTime("2024-06-13T18:46:03+00:00")).toBe(true);
  });
});

describe("isUuid", () => {
  it.each([
    ["8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60", true],
    ["8F3E2A14-4C1B-4D77-9A3E-1B2C3D4E5F60", true],
    ["00000000-0000-7000-8000-000000000000", true],
    ["urn:uuid:8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60", false],
    ["8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f6", false],
    ["8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f6g", false],
    ["x8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60", false],
    ["", false],
  ])("reads %j as a UUID: %s", (text, expected) => {
    expect(isUuid(text)).toBe(expected);
  });
});

describe("isAbsoluteUri", () => {
  it.each([
    ["https://case.example.edu/ims/case/v1p1/CFItems/1", true],
    ["urn:uuid:8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60", true],
    ["mailto:a@example.org", true],
    ["relative/path", false],
    ["//example.org/x", false],
    ["https://has a space.example/x", false],
    ["http://[", false],
    ["1http://example.org", false],
    ["", false],
  ])("reads %j as a URI with a scheme: %s", (text, expected) => {
    expect(isAbsoluteUri(text)).toBe(expected);
  });
});

describe("isLanguageTag", () => {
  it.each([
    // The examples of RFC 5646 Appendix A, and the forms of section 2.1.
    "de",
    "fr",
    "ja",
    "zh-Hant",
    "zh-Hans-CN",
    "sr-Latn-RS",
    "sl-rozaj",
    "sl-rozaj-biske",
    "sl-nedis",
    "de-CH-1901",
    "hy-Latn-IT-arevela",
    "de-DE",
    "en-US",
    "es-419",
    "zh-yue",
    "zh-cmn-Hans-CN",
    "de-CH-x-phonebk",
    "az-Arab-x-AZE-derbend",
    "x-whatever",
    "qaa-Qaaa-QM-x-southern",
    "en-a-bbb-x-a-ccc",
    "en-t-ja-u-co-phonebk",
    "english",
    "und",
    "EN-us",
    "i-klingon",
    "I-Klingon",
    "en-GB-oed",
    "zh-min-nan",
  ])("reads %j as a well-formed tag", (text) => {
    expect(isLanguageTag(text)).toBe(true);
  });

  it.each([
    "",
    "e",
    "en-",
    "-en",
    "en_US",
    "en US",
    "de-419-DE",
    "a-DE",
    "abcdefghi",
    "de-DE-x",
    "x-",
    "x-abcdefghi",
    "en-US-a",
    "en-abcd-abcd",
    "en-aaa-bbb-ccc-ddd",
    "abcdefghi-US",
    "i-unknown",
    "__proto__",
    "constructor",
    "en-\u212A",
    "\u017Fr",
  ])("refuses %j", (text) => {
    expect(isLanguageTag(text)).toBe(false);
  });
});

describe("the schemas of the formats", () => {
  it.each([
    [
      "uuidSchema",
      uuidSchema,
      "8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60",
      "x",
      'expected a UUID as 8-4-4-4-12 hexadecimal digits, found "x"',
    ],
    ["dateSchema", dateSchema, "2024-06-13", "2024-02-30", 'expected a date as YYYY-MM-DD, found "2024-02-30"'],
    [
      "dateTimeSchema",
      dateTimeSchema,
      "2024-06-13T18:46:03+00:00",
      "2024-06-13",
      'expected a date and time as RFC 3339, such as 2024-06-13T18:46:03+00:00, found "2024-06-13"',
    ],
    [
      "languageTagSchema",
      languageTagSchema,
      "en-US",
      "en_US",
      'expected a language tag of RFC 5646, such as en-US, found "en_US"',
    ],
    [
      "absoluteUriSchema",
      absoluteUriSchema,
      "https://example.org/x",
      "x/y",
      'expected a URI with a scheme, such as https://example.org/x, found "x/y"',
    ],
  ])("%s accepts its form and refuses another with a sentence", (_name, schema, valid, invalid, sentence) => {
    expect(v.safeParse(schema, valid).success).toBe(true);
    const result = v.safeParse(schema, invalid);
    expect(result.issues?.map(({ message }) => message)).toStrictEqual([sentence]);
    expect(v.safeParse(schema, 5).success).toBe(false);
  });
});
