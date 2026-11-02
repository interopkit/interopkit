import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readPreferencesQuery, readPreferencesRecord, writePreferencesQuery } from "../src/protocol/internal.js";
import { FUZZ, fuzzJson } from "./fuzz.js";
import { expectRefusesOtherTypes, plainJson } from "./services.js";

describe("the preferences record", () => {
  it("is a JSON object that passes through as a copy, and nothing else", () => {
    const record = { afapnprecord: { id: "a1", display: { screenEnhancement: { magnification: 2 } } } };
    const read = readPreferencesRecord(record);
    expect(read).toEqual(record);
    expect(read).not.toBe(record);
    expectRefusesOtherTypes(readPreferencesRecord, [], ["{}"]);
    expect(readPreferencesRecord({})).toEqual({});
  });

  it("keeps any JSON object as it is", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), plainJson), (record) => {
        expect(readPreferencesRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
      }),
      FUZZ,
    );
    fuzzJson(readPreferencesRecord, [{ a: [1, { b: null }] }]);
  });
});

describe("the filters of a request for a record", () => {
  it("read the fields as a comma-separated list, and write them back", () => {
    expect(readPreferencesQuery(new URLSearchParams("fields=a,b.c&x=1"))).toEqual({ fields: ["a", "b.c"] });
    expect(readPreferencesQuery(new URLSearchParams())).toEqual({});
    expect(writePreferencesQuery({ fields: ["a", "b"] }).toString()).toBe("fields=a%2Cb");
    expect(writePreferencesQuery({}).toString()).toBe("");
    expect(readPreferencesQuery(writePreferencesQuery({ fields: ["x", "y z"] }))).toEqual({ fields: ["x", "y z"] });
  });

  it("refuse an empty field, a list given twice, and fields that cannot be written", () => {
    for (const text of ["fields=", "fields=a,", "fields=,a", "fields=a,,b", "fields=a&fields=b"]) {
      expect(() => readPreferencesQuery(new URLSearchParams(text)), text).toThrow(DataError);
    }
    for (const fields of [[], [""], ["a,b"]])
      expect(() => writePreferencesQuery({ fields }), JSON.stringify(fields)).toThrow(DataError);
  });
});
