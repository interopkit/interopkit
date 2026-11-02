import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Schema } from "@cfworker/json-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readSchema,
  readSchemaSet,
  schemaClass,
  schemaDefinitions,
  schemaSetValidator,
  schemaValidator,
} from "../schema-oracle.ts";

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "interopkit-schema-oracle-"));
  mkdirSync(join(root, ".cache/schemas"), { recursive: true });
  writeFileSync(join(root, ".cache/schemas/thing.json"), JSON.stringify({ type: "object", required: ["id"] }));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readSchema", () => {
  it("reads a pinned file as parsed JSON", () => {
    expect(readSchema(root, "thing.json")).toStrictEqual({ type: "object", required: ["id"] });
  });

  it("says to run pnpm schemas when the schemas are not downloaded, and when the file is not one of them", () => {
    const empty = mkdtempSync(join(tmpdir(), "interopkit-schema-oracle-empty-"));
    try {
      expect(() => readSchema(empty, "thing.json")).toThrow("run pnpm schemas first");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    expect(() => readSchema(root, "missing.json")).toThrow();
  });
});

describe("schemaValidator", () => {
  const schema: Schema = {
    type: "object",
    properties: { id: { type: "string", format: "uuid" }, at: { type: "string", format: "date-time" } },
    required: ["id"],
    additionalProperties: false,
  };

  it.each(["7", "2019-09"] as const)("tells a valid value from an invalid one, in draft %s", (draft) => {
    const valid = schemaValidator(schema, draft);
    expect(valid({ id: "8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60" })).toBe(true);
    expect(valid({})).toBe(false);
    expect(valid({ id: "8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60", other: 1 })).toBe(false);
  });

  it("asserts the formats", () => {
    const valid = schemaValidator(schema, "2019-09");
    expect(valid({ id: "not-a-uuid" })).toBe(false);
    expect(valid({ id: "8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60", at: "yesterday" })).toBe(false);
    expect(valid({ id: "8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60", at: "2024-06-13T18:46:03Z" })).toBe(true);
  });
});

describe("schemaClass and schemaDefinitions", () => {
  it("reads the properties and the required properties of a class, and none when it has none", () => {
    expect(schemaClass({ properties: { a: {}, b: {} }, required: ["a"] })).toStrictEqual({
      properties: ["a", "b"],
      required: ["a"],
    });
    expect(schemaClass({})).toStrictEqual({ properties: [], required: [] });
    expect(schemaClass({ required: ["a", 5, "b"] }).required).toStrictEqual(["a", "b"]);
  });

  it.each([null, "x", [], 5])("refuses %j, which is not a class", (definition) => {
    expect(() => schemaClass(definition)).toThrow("The definition of a class is an object.");
  });

  it("reads the classes of $defs and of definitions by their names", () => {
    const classes = schemaDefinitions({ $defs: { A: { properties: { x: {} } }, B: { required: ["y"] } } });
    expect([...classes.keys()]).toStrictEqual(["A", "B"]);
    expect(classes.get("A")).toStrictEqual({ properties: ["x"], required: [] });
    expect([...schemaDefinitions({ definitions: { C: {} } }).keys()]).toStrictEqual(["C"]);
    expect([...schemaDefinitions({}).keys()]).toStrictEqual([]);
  });
});

describe("readSchemaSet and schemaSetValidator", () => {
  let set: ReturnType<typeof readSchemaSet>;

  beforeAll(() => {
    const directory = join(root, "set");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "Pet.json"),
      JSON.stringify({
        schema: "http://json-schema.org/draft-04/schema#",
        id: "Pet",
        type: "object",
        properties: { owner: { anyOf: [{ type: "string" }, { $ref: "Person" }] }, age: { type: "number" } },
        required: ["owner"],
      }),
    );
    writeFileSync(
      join(directory, "Person.json"),
      JSON.stringify({ id: "Person", type: "object", properties: { name: { type: "string" } }, required: ["name"] }),
    );
    writeFileSync(join(directory, "notes.txt"), "not a schema");
    set = readSchemaSet(directory);
  });

  it("reads the schemas of a directory by the name of their file and ignores other files", () => {
    expect([...set.keys()].sort()).toStrictEqual(["Person", "Pet"]);
  });

  it("resolves a reference from one file to another by id, in draft 4", () => {
    const valid = schemaSetValidator(set, "Pet", "4");
    expect(valid({ owner: "https://example.org/people/1" })).toBe(true);
    expect(valid({ owner: { name: "Ada" }, age: 3 })).toBe(true);
    expect(valid({ owner: { name: 7 } })).toBe(false);
    expect(valid({})).toBe(false);
  });

  it("names the schema that the set lacks", () => {
    expect(() => schemaSetValidator(set, "Fish", "4")).toThrow("The set of schemas has no schema Fish.");
  });
});
