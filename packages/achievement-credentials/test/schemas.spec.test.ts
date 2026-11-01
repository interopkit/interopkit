// cspell:ignore registrationerror tokenerror
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutate, mutations } from "../../../scripts/json-mutation.js";
import {
  AUTHORIZATION_ERRORS,
  type EntityKind,
  REGISTRATION_ERRORS,
  TOKEN_ERRORS,
  validateEntity,
} from "../src/index.js";
import { CLASS_SCHEMAS } from "../src/read/internal.js";
import { classOf, heldClass, oracleOf, PAGE_CASES, pageSchemaNamed, schemaExportName } from "./official.js";

/** The runs of each property, and the seed that makes them the same on every run. */
const RUNS = { numRuns: 120, seed: 2024, endOnFailure: true };

const reads = (name: string, value: unknown): boolean =>
  validateEntity(name as EntityKind, value).every(
    ({ severity, rule }) => severity !== "error" || rule === "subject-unidentified",
  );

describe.each(PAGE_CASES)("$name, which only a page prints", ({ name, schema }) => {
  const oracle = oracleOf(schema());

  it("reads every value that the schema generates", () => {
    fc.assert(
      fc.property(oracle.arbitrary, (value) => {
        expect(oracle.valid(value)).toBe(true);
        expect(reads(name, value)).toBe(true);
      }),
      RUNS,
    );
  });

  it("gives a value with one change the verdict of the schema", () => {
    fc.assert(
      fc.property(oracle.arbitrary, mutations, (value, change) => {
        const changed = mutate(value, change);
        expect(reads(name, changed)).toBe(oracle.valid(changed));
      }),
      RUNS,
    );
  });
});

describe("the classes that only a page prints", () => {
  it.each(PAGE_CASES.map(({ name, schema }) => [name, schema] as const))(
    "holds %s with the properties, the required ones and the closure that the page gives",
    (name, schema) => {
      const official = schema();
      const mine = heldClass(CLASS_SCHEMAS[schemaExportName(name) as keyof typeof CLASS_SCHEMAS]);
      expect(mine).toBeDefined();
      expect([...(mine?.properties ?? [])].sort()).toStrictEqual([...classOf(official).properties].sort());
      expect([...(mine?.required ?? [])].sort()).toStrictEqual([...new Set(classOf(official).required)].sort());
      expect(mine?.strict).toBe(official.additionalProperties === false);
    },
  );
});

describe("the vocabularies of OAuth errors", () => {
  it.each([
    ["AUTHORIZATION_ERRORS", AUTHORIZATION_ERRORS, "ob_v3p0_authorizationerror-jsonschema1.json"],
    ["REGISTRATION_ERRORS", REGISTRATION_ERRORS, "ob_v3p0_registrationerror-jsonschema1.json"],
    ["TOKEN_ERRORS", TOKEN_ERRORS, "ob_v3p0_tokenerror-jsonschema1.json"],
  ])("holds the codes that the page lists for %s, in its order", (_name, terms, id) => {
    expect([...terms]).toStrictEqual(classOf(pageSchemaNamed(id)).required);
  });
});

describe.each(PAGE_CASES)("$name, which only a page prints", ({ name, schema }) => {
  it("has the full value that the schema generates in the fixtures that the offline tests read", async () => {
    const [value] = fc.sample(oracleOf(schema(), { full: true, depth: 2 }).arbitrary, { numRuns: 1, seed: 1 });
    await expect(`${JSON.stringify(value, null, 1)}\n`).toMatchFileSnapshot(`fixtures/${name}.json`);
  });
});
