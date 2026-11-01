import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, deepFreeze, mutate, mutations } from "../json-mutation.ts";

const SAMPLE = { list: [{ name: "a" }, { name: "b" }], title: "t" };

describe("mutate", () => {
  it("does not change its input, and returns a copy", () => {
    const input = deepFreeze(structuredClone(SAMPLE));
    for (const kind of ["delete", "retype", "unknown-property", "bad-string", "bad-number"] as const) {
      const result = mutate(input, { at: 0, kind, pick: 0 });
      expect(result).not.toBe(input);
    }
    expect(input).toStrictEqual(SAMPLE);
  });

  it("removes a member of an object, and an entry of a list without leaving a hole", () => {
    // Paths in order: list, list[0], list[0].name, list[1], list[1].name, title.
    expect(mutate(SAMPLE, { at: 5, kind: "delete", pick: 0 })).toStrictEqual({ list: SAMPLE.list });
    expect(mutate(SAMPLE, { at: 3, kind: "delete", pick: 0 })).toStrictEqual({ list: [{ name: "a" }], title: "t" });
  });

  it("replaces a member by a value of another type, one that depends on pick", () => {
    expect(mutate(SAMPLE, { at: 5, kind: "retype", pick: 0 })).toStrictEqual({ ...SAMPLE, title: null });
    expect(mutate(SAMPLE, { at: 5, kind: "retype", pick: 2 })).toStrictEqual({ ...SAMPLE, title: 7 });
  });

  it("replaces a member by a bad string, from the list the caller gives or from BAD_STRINGS", () => {
    expect(mutate(SAMPLE, { at: 5, kind: "bad-string", pick: 1 })).toStrictEqual({ ...SAMPLE, title: BAD_STRINGS[1] });
    expect(mutate(SAMPLE, { at: 5, kind: "bad-string", pick: 3 }, ["x", "y"])).toStrictEqual({ ...SAMPLE, title: "y" });
  });

  it("replaces a member by a number that a property may refuse", () => {
    expect(mutate(SAMPLE, { at: 5, kind: "bad-number", pick: 3 })).toStrictEqual({ ...SAMPLE, title: 2.5 });
  });

  it("adds an unknown property to an object, and to nothing else", () => {
    expect(mutate(SAMPLE, { at: 3, kind: "unknown-property", pick: 0 })).toStrictEqual({
      list: [{ name: "a" }, { name: "b", unknownProperty: 1 }],
      title: "t",
    });
    // A list, a string and an entry are not objects.
    expect(mutate(SAMPLE, { at: 0, kind: "unknown-property", pick: 0 })).toStrictEqual(SAMPLE);
    expect(mutate(SAMPLE, { at: 5, kind: "unknown-property", pick: 0 })).toStrictEqual(SAMPLE);
  });

  it("wraps the index around the paths of the value", () => {
    expect(mutate(SAMPLE, { at: 6 + 5, kind: "delete", pick: 0 })).toStrictEqual(
      mutate(SAMPLE, { at: 5, kind: "delete", pick: 0 }),
    );
  });

  it("returns a copy of a value that has no member", () => {
    expect(mutate({}, { at: 4, kind: "delete", pick: 0 })).toStrictEqual({});
  });
});

describe("mutations", () => {
  it("draws every kind of change, with an index and a pick that are not negative", () => {
    const drawn = fc.sample(mutations, { numRuns: 200, seed: 3 });
    expect(new Set(drawn.map(({ kind }) => kind))).toStrictEqual(
      new Set(["delete", "retype", "unknown-property", "bad-string", "bad-number"]),
    );
    expect(drawn.every(({ at, pick }) => at >= 0 && pick >= 0)).toBe(true);
  });
});

describe("deepFreeze", () => {
  it("freezes an object and everything in it, so that a change throws in strict mode", () => {
    const value = deepFreeze({ list: [{ a: 1 }], nested: { b: [2] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(value.nested.b)).toBe(true);
    expect(() => {
      value.list.push({ a: 2 });
    }).toThrow(TypeError);
  });

  it("leaves a value that is not an object, and a value that is frozen already, as they are", () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze(null)).toBe(null);
    const frozen = Object.freeze({ inner: { x: 1 } });
    expect(deepFreeze(frozen)).toBe(frozen);
    expect(Object.isFrozen(frozen.inner)).toBe(false);
  });
});
