import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_KINDS,
  ENTITY_KINDS,
  type EntityKind,
  readCredential,
  readEntity,
  validateCredential,
  validateEntity,
} from "../src/index.js";
import { CLASS_SCHEMAS } from "../src/read/internal.js";
import { RULES_BEYOND_SCHEMAS } from "./rules-beyond-schemas.js";

const FIXTURES = new URL("fixtures/", import.meta.url);

/**
 * The full values that the schemas generate for each class, written by the corpus and spec tests with `vitest -u`: every
 * property of every class that the value reaches, to the depth that those tests give.
 */
const fixtures = readdirSync(FIXTURES)
  .filter((file) => file.endsWith(".json"))
  .map((file) => [file.replace(/\.json$/u, ""), JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8"))] as const);

const isError = ({ severity, rule }: { readonly severity: string; readonly rule: string }) =>
  severity === "error" && !RULES_BEYOND_SCHEMAS.has(rule);

const entities = fixtures.filter((fixture): fixture is readonly [EntityKind, unknown] =>
  (ENTITY_KINDS as readonly string[]).includes(fixture[0]),
);
const credentials = fixtures.filter(([name]) => !(ENTITY_KINDS as readonly string[]).includes(name));

describe("the schemas of the classes", () => {
  it("are all valibot schemas, which the tests compare with the schemas of 1EdTech by the name of their export", () => {
    const names = Object.keys(CLASS_SCHEMAS);
    expect(names.every((name) => name.endsWith("Schema"))).toBe(true);
    expect(Object.values(CLASS_SCHEMAS).every((schema) => schema.kind === "schema")).toBe(true);
    expect(names).toContain("achievementCredentialSchema");
  });
});

describe("the full values of the classes", () => {
  it("are those of every credential and every other object that the readers read", () => {
    expect(credentials.length + entities.length).toBe(fixtures.length);
    expect(credentials).toHaveLength(8);
    expect(entities).toHaveLength(ENTITY_KINDS.length);
  });

  it.each(credentials)(
    "are read as a credential: %s, with no error, into a copy that is read again as itself",
    (name, value) => {
      const kind = CREDENTIAL_KINDS.find((candidate) => name.startsWith(candidate));
      expect(validateCredential(value, { kind }).filter(isError)).toStrictEqual([]);
      const read = readCredential(value, { kind });
      expect(read).not.toBe(value);
      expect(readCredential(read, { kind })).toStrictEqual(read);
    },
  );

  it.each(entities)(
    "are read as an object: %s, with no error, into a copy that is read again as itself",
    (kind, value) => {
      expect(validateEntity(kind, value).filter(isError)).toStrictEqual([]);
      const read = readEntity(kind, value);
      expect(read).not.toBe(value);
      expect(readEntity(kind, read)).toStrictEqual(read);
    },
  );
});

describe("a property named __proto__, constructor or prototype", () => {
  /** The value with a property of the name, first, as `JSON.parse` makes it: an own property that changes no prototype. */
  const withProperty = (value: unknown, name: string): unknown =>
    Object.assign(JSON.parse(`{"${name}":{"admin":true}}`), value);
  const names = ["__proto__", "constructor", "prototype"];

  it.each(credentials)("is refused in a credential: %s", (name, value) => {
    const kind = CREDENTIAL_KINDS.find((candidate) => name.startsWith(candidate));
    for (const reserved of names) {
      const hostile = withProperty(value, reserved);
      expect(validateCredential(hostile, { kind }).filter(isError)).toMatchObject([{ rule: "invalid-value" }]);
      expect(() => readCredential(hostile, { kind }), reserved).toThrow(`${reserved} is refused`);
    }
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it.each(entities)("is refused in an object: %s", (kind, value) => {
    for (const reserved of names) {
      const hostile = withProperty(value, reserved);
      expect(validateEntity(kind, hostile).filter(isError)).toMatchObject([{ rule: "invalid-value" }]);
      expect(() => readEntity(kind, hostile), reserved).toThrow(`${reserved} is refused`);
    }
  });
});
