// biome-ignore-all lint/style/useNamingConvention: the names of the bodies of Context Groups and of its query parameters are those of the specification.

import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  readGroupContainer,
  readGroupQuery,
  readGroupSetContainer,
  writeGroupContainer,
  writeGroupQuery,
  writeGroupSetContainer,
} from "../src/protocol/internal.js";
import { FUZZ, fuzzJson } from "./fuzz.js";
import { expectRefusals, expectRefusesOtherTypes } from "./services.js";

const groups = {
  id: "https://lms.example.com/class/2923/groups/",
  groups: [
    { id: "44711f9f", name: "Bob's Tuesday Group", set_ids: ["912cc53f"], tag: "marking" },
    { id: "bf2042b4", name: "Bob's Friday Group", set_ids: ["912cc53f", "8127ccca"], tag: "marking", hidden: true },
    { id: "89230b3", name: "The cool kids group" },
  ],
};
const sets = {
  id: "https://lms.example.com/class/2923/groups/sets",
  sets: [
    { id: "912cc53f", name: "The Chemistry Lab Group Set" },
    { id: "8127ccca", name: "Lab 2", tag: "http://purl.imsglobal.org/vocab/lis/v2/course#Group", hidden: true },
  ],
};

describe("the groups", () => {
  it("are read with their sets, tag and hidden flag, and with the user when a request named one, and written as read", () => {
    const read = readGroupContainer(groups);
    expect(read.groups[1]).toEqual({
      id: "bf2042b4",
      name: "Bob's Friday Group",
      tag: "marking",
      setIds: ["912cc53f", "8127ccca"],
      hidden: true,
    });
    expect(read.groups[2]).toEqual({
      id: "89230b3",
      name: "The cool kids group",
      tag: undefined,
      setIds: undefined,
      hidden: undefined,
    });
    expect(writeGroupContainer(read)).toEqual(groups);
    const forUser = { ...groups, user_id: "0ae836b9" };
    expect(readGroupContainer(forUser).userId).toBe("0ae836b9");
    expect(writeGroupContainer(readGroupContainer(forUser))).toEqual(forUser);
  });

  it("are refused when a group has no id or name, or the container has no address that is https", () => {
    expectRefusals(readGroupContainer, groups, [
      ["no id", { id: undefined }],
      ["an id that is http", { id: "http://lms.example.com/g" }],
      ["no groups", { groups: undefined }],
      ["a group without an id", { groups: [{ name: "x" }] }],
      ["a group without a name", { groups: [{ id: "x" }] }],
      ["set_ids that are not strings", { groups: [{ id: "x", name: "x", set_ids: [1] }] }],
      ["a hidden that is a string", { groups: [{ id: "x", name: "x", hidden: "yes" }] }],
      ["a user_id that is empty", { user_id: "" }],
    ]);
    expectRefusesOtherTypes(readGroupContainer);
    expect(() => writeGroupContainer({ ...readGroupContainer(groups), id: "http://x.example/" })).toThrow(DataError);
  });
});

describe("the group sets", () => {
  it("are read with their tag and hidden flag, and written as read", () => {
    expect(writeGroupSetContainer(readGroupSetContainer(sets))).toEqual(sets);
    expectRefusals(readGroupSetContainer, sets, [
      ["no sets", { sets: undefined }],
      ["a set without a name", { sets: [{ id: "x" }] }],
      ["an id that is http", { id: "http://lms.example.com/s" }],
    ]);
    expectRefusesOtherTypes(readGroupSetContainer);
    expect(() => writeGroupSetContainer({ ...readGroupSetContainer(sets), id: "x" })).toThrow(DataError);
  });
});

describe("the filters of a request for groups", () => {
  it("read user_id and limit, and write them back", () => {
    expect(readGroupQuery(new URLSearchParams("user_id=u1&limit=5&x=1"))).toEqual({ userId: "u1", limit: 5 });
    expect(writeGroupQuery({ userId: "u1", limit: 5 }).toString()).toBe("user_id=u1&limit=5");
    for (const text of ["user_id=a&user_id=b", "limit=0", "limit=x"]) {
      expect(() => readGroupQuery(new URLSearchParams(text)), text).toThrow(DataError);
    }
    expect(() => writeGroupQuery({ limit: -1 })).toThrow(DataError);
  });
});

describe("the bodies of Context Groups", () => {
  it("read back what was written, for any groups and group sets", () => {
    const text = fc.string({ minLength: 1, maxLength: 8 });
    const some = <TValue>(value: fc.Arbitrary<TValue>) => fc.option(value, { nil: undefined });
    const address = text.map((path) => `https://lms.example.com/${encodeURIComponent(path)}`);
    const group = fc.record({
      id: text,
      name: text,
      tag: some(text),
      setIds: some(fc.array(text, { maxLength: 3 })),
      hidden: some(fc.boolean()),
    });
    const set = fc.record({ id: text, name: text, tag: some(text), hidden: some(fc.boolean()) });
    fc.assert(
      fc.property(
        fc.record({ id: address, userId: some(text), groups: fc.array(group, { maxLength: 3 }) }),
        fc.record({ id: address, sets: fc.array(set, { maxLength: 3 }) }),
        (container, setContainer) => {
          expect(readGroupContainer(JSON.parse(JSON.stringify(writeGroupContainer(container))))).toEqual(container);
          expect(readGroupSetContainer(JSON.parse(JSON.stringify(writeGroupSetContainer(setContainer))))).toEqual(
            setContainer,
          );
        },
      ),
      FUZZ,
    );
  });

  it("return a value or throw a DataError for any JSON, and for the examples with any value replaced", () => {
    fuzzJson(readGroupContainer, [groups]);
    fuzzJson(readGroupSetContainer, [sets]);
  });
});
