import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { schemaArbitrary } from "../schema-arbitrary.ts";

/** Draws values of a schema, with a seed that makes the draw the same on every run. */
function draw(schema: unknown, options?: Parameters<typeof schemaArbitrary>[1], runs = 60): unknown[] {
  return fc.sample(schemaArbitrary(schema, options), { numRuns: runs, seed: 7 });
}

describe("the types", () => {
  it("generates a string, an integer, a number and a boolean", () => {
    expect(draw({ type: "string" }).every((value) => typeof value === "string")).toBe(true);
    expect(draw({ type: "integer" }).every((value) => Number.isInteger(value))).toBe(true);
    expect(draw({ type: "number" }).every((value) => typeof value === "number" && Number.isFinite(value))).toBe(true);
    expect(draw({ type: "boolean" })).toContain(true);
    expect(draw({ type: "boolean" })).toContain(false);
  });

  it("generates no negative zero, which JSON writes as 0", () => {
    expect(draw({ type: "number" }, undefined, 500).some((value) => Object.is(value, -0))).toBe(false);
  });

  it("generates an array of the items, with at least minItems and a few more", () => {
    const lists = draw({ type: "array", items: { type: "integer" }, minItems: 2 });
    expect(lists.every((list) => Array.isArray(list) && list.length >= 2 && list.length <= 4)).toBe(true);
    expect(
      draw({ type: "array", items: { type: "boolean" } }).some((list) => Array.isArray(list) && list.length === 0),
    ).toBe(true);
  });
});

describe("the lists", () => {
  it("generates a tuple with its fixed members first, and as many more as additionalItems allows", () => {
    const tuple = {
      type: "array",
      minItems: 2,
      items: [{ enum: ["first"] }, { type: "boolean" }],
      additionalItems: { type: "integer" },
    };
    const lists = draw(tuple) as unknown[][];
    expect(lists.every((list) => list[0] === "first" && typeof list[1] === "boolean")).toBe(true);
    expect(lists.some((list) => list.length > 2 && list.slice(2).every((member) => Number.isInteger(member)))).toBe(
      true,
    );
    expect(lists.every((list) => list.length <= 4)).toBe(true);
    expect(
      (draw({ type: "array", items: [{ type: "boolean" }] }) as unknown[][]).every((list) => list.length === 1),
    ).toBe(true);
  });

  it("generates a list that holds a term of every contains, alone or in an allOf", () => {
    const items = { type: "string" };
    const single = draw({ type: "array", items, contains: { enum: ["a", "b"] } }) as string[][];
    expect(single.every((list) => list.includes("a") || list.includes("b"))).toBe(true);
    const both = draw({
      allOf: [
        { type: "array", items, contains: { enum: ["VerifiableCredential"] } },
        { type: "array", items, contains: { const: "Achievement" } },
      ],
    }) as string[][];
    expect(both.every((list) => list.includes("VerifiableCredential") && list.includes("Achievement"))).toBe(true);
    expect(both.some((list) => list.length > 2)).toBe(true);
  });
});

describe("the choices", () => {
  it("generates a member of an enum, the value of a const, and a branch of oneOf and anyOf", () => {
    expect(new Set(draw({ enum: ["a", "b", "c"] }))).toStrictEqual(new Set(["a", "b", "c"]));
    expect(new Set(draw({ const: null }))).toStrictEqual(new Set([null]));
    expect(new Set(draw({ oneOf: [{ const: 1 }, { const: 2 }] }))).toStrictEqual(new Set([1, 2]));
    expect(new Set(draw({ anyOf: [{ const: "x" }, { type: "boolean" }] })).has("x")).toBe(true);
  });

  it("follows a reference into $defs and into definitions, and a reference to a reference", () => {
    const schema = {
      $defs: { Name: { enum: ["n"] }, Alias: { $ref: "#/$defs/Name" } },
      definitions: { Flag: { const: true } },
      type: "object",
      properties: { a: { $ref: "#/$defs/Alias" }, b: { $ref: "#/definitions/Flag" } },
      required: ["a", "b"],
    };
    expect(draw(schema).every((value) => JSON.stringify(value) === '{"a":"n","b":true}')).toBe(true);
  });
});

describe("the strings", () => {
  it("generates a string that matches the pattern, anchored", () => {
    const values = draw({ type: "string", pattern: "ab+c" });
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => typeof value === "string" && /^ab+c$/u.test(value))).toBe(true);
  });

  it("generates the form that the options give a format, and the form that they give a pattern", () => {
    const options = { formats: { uuid: fc.constant("U") }, patterns: { "x+": fc.constant("override") } };
    expect(new Set(draw({ type: "string", format: "uuid" }, options))).toStrictEqual(new Set(["U"]));
    expect(new Set(draw({ type: "string", pattern: "x+" }, options))).toStrictEqual(new Set(["override"]));
  });

  it("generates any string for a format that the options do not list", () => {
    expect(
      draw({ type: "string", format: "date" }, { formats: { uuid: fc.constant("U") } }).some((value) => value !== "U"),
    ).toBe(true);
  });
});

describe("the objects", () => {
  const schema = {
    type: "object",
    properties: { id: { type: "string" }, count: { type: "integer" } },
    required: ["id"],
  };

  it("always has the required properties and sometimes the optional ones, and no other property", () => {
    const values = draw(schema) as Record<string, unknown>[];
    expect(values.every((value) => typeof value.id === "string")).toBe(true);
    expect(values.some((value) => "count" in value)).toBe(true);
    expect(values.some((value) => !("count" in value))).toBe(true);
    expect(values.every((value) => Object.keys(value).every((name) => name === "id" || name === "count"))).toBe(true);
  });

  it("adds no property when additionalProperties is false or absent, and some when it is true", () => {
    const extras = (value: unknown) => Object.keys(value as object).filter((name) => name !== "id" && name !== "count");
    expect(draw({ ...schema, additionalProperties: false }).flatMap(extras)).toStrictEqual([]);
    expect(draw(schema).flatMap(extras)).toStrictEqual([]);
    const free = draw({ ...schema, additionalProperties: true }, undefined, 100);
    expect(free.flatMap(extras).length).toBeGreaterThan(0);
    expect(free.flatMap(extras)).not.toContain("__proto__");
  });

  it("keeps the properties of the schema when an extra one has their name", () => {
    const values = draw({ ...schema, additionalProperties: true }, undefined, 200) as Record<string, unknown>[];
    expect(values.every((value) => typeof value.id === "string")).toBe(true);
  });

  it("takes the generator of a property by its name from the options, whatever the schema says", () => {
    const values = draw(schema, { properties: { id: fc.constant("fixed") } }) as Record<string, unknown>[];
    expect(values.every((value) => value.id === "fixed")).toBe(true);
  });
});

describe("all properties", () => {
  const schema = {
    type: "object",
    properties: { a: { type: "string" }, b: { type: "object", properties: { c: { type: "integer" } } } },
    required: ["a"],
  };

  it("generates the optional properties of every object when it is asked for them, and only the required ones when it is not", () => {
    const some = draw(schema) as Record<string, unknown>[];
    expect(some.some((value) => !("b" in value))).toBe(true);
    const all = draw(schema, { allProperties: true }) as Record<string, { c?: unknown }>[];
    expect(all.every((value) => typeof value.a === "string" && typeof value.b?.c === "number")).toBe(true);
  });

  it("gives a list a member, so that the value reaches the class of its members", () => {
    const lists = { type: "array", items: { type: "integer" } };
    expect(draw(lists).some((list) => Array.isArray(list) && list.length === 0)).toBe(true);
    expect(draw(lists, { allProperties: true }).every((list) => Array.isArray(list) && list.length > 0)).toBe(true);
  });

  it("takes the branches that refer to a class, so that the value reaches the class", () => {
    const choice = {
      $defs: { Part: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] } },
      oneOf: [{ type: "string" }, { $ref: "#/$defs/Part" }, { type: "array", items: { $ref: "#/$defs/Part" } }],
    };
    expect(draw(choice).some((value) => typeof value === "string")).toBe(true);
    const values = draw(choice, { allProperties: true });
    expect(values.every((value) => typeof value === "object")).toBe(true);
    expect(values.some((value) => Array.isArray(value))).toBe(true);
    expect(values.some((value) => !Array.isArray(value))).toBe(true);
  });

  it("leaves the optional properties out past maxDepth", () => {
    const cyclic = {
      $defs: {
        Node: {
          type: "object",
          properties: { name: { type: "string" }, next: { $ref: "#/$defs/Node" } },
          required: ["name"],
        },
      },
      $ref: "#/$defs/Node",
    };
    const chain = (value: unknown): number =>
      typeof value === "object" && value !== null && "next" in value ? 1 + chain(value.next) : 0;
    expect(draw(cyclic, { allProperties: true, maxDepth: 3 }).every((value) => chain(value) === 3)).toBe(true);
  });
});

describe("references that form a cycle", () => {
  const schema = {
    $defs: {
      Node: {
        type: "object",
        properties: {
          name: { type: "string" },
          parent: { $ref: "#/$defs/Node" },
          label: { oneOf: [{ $ref: "#/$defs/Node" }, { type: "string" }] },
        },
        required: ["name", "label"],
      },
    },
    $ref: "#/$defs/Node",
  };

  it("ends at maxDepth: past it a value leaves its optional properties out and takes a branch without a reference", () => {
    const depthOf = (value: unknown): number =>
      typeof value === "object" && value !== null
        ? 1 + Math.max(0, ...Object.values(value).map((member) => depthOf(member)))
        : 0;
    const values = draw(schema, { maxDepth: 2 }, 100);
    expect(values.every((value) => depthOf(value) <= 6)).toBe(true);
    expect(values.some((value) => typeof value === "object" && value !== null && "parent" in value)).toBe(true);
  });

  it("throws without maxDepth, because a cycle of references has no end", () => {
    expect(() => draw(schema)).toThrow(RangeError);
  });
});

describe("what it does not generate", () => {
  it.each([
    ["a keyword it does not read", { type: "string", maxLength: 3 }, "The schema keyword maxLength is not generated."],
    [
      "an allOf of anything but lists that hold terms",
      { allOf: [{ type: "string" }] },
      "An allOf of anything but lists that must hold terms is not generated.",
    ],
    [
      "a contains that names no term",
      { type: "array", items: { type: "string" }, contains: { type: "string" } },
      "A contains that names no enum or const is not generated.",
    ],
    ["not", { not: { type: "string" } }, "The schema keyword not is not generated."],
    ["a type that is a list", { type: ["string", "null"] }, 'The schema type ["string","null"] is not generated.'],
    ["a type it does not know", { type: "null" }, 'The schema type "null" is not generated.'],
    ["no type", {}, "The schema type undefined is not generated."],
    [
      "a reference to another file",
      { $ref: "other.json#/$defs/X" },
      "The reference other.json#/$defs/X is not to a place of the same file.",
    ],
    ["a reference that is not a string", { $ref: 5 }, "The reference 5 is not to a place of the same file."],
    [
      "additionalProperties as a schema",
      { type: "object", additionalProperties: { type: "string" } },
      "An additionalProperties that is a schema is not generated.",
    ],
    [
      "a required property with no schema",
      { type: "object", properties: {}, required: ["x"] },
      "The property x is required and has no schema.",
    ],
    ["a schema that is not an object", [], "A schema is an object."],
    [
      "a keyword inside a property",
      { type: "object", properties: { a: { type: "string", pattern: "a", minLength: 1 } } },
      "The schema keyword minLength is not generated.",
    ],
  ])("throws for %s", (_name, schema, message) => {
    expect(() => draw(schema)).toThrow(message);
  });

  it("reads the keywords that only describe, and the definitions that a reference names", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2019-09/schema#",
      $id: "https://example.org/x",
      $comment: "c",
      title: "t",
      description: "d",
      default: 1,
      examples: [1],
      type: "integer",
    };
    expect(draw(schema).every((value) => Number.isInteger(value))).toBe(true);
  });
});
