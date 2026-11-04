// cspell:ignore anyachievementcredential anyendorsementcredential anyclrcredential statusinfo servicedescriptiondocument clrcredential multikey
import { STATUS_CODES_MAJOR, STATUS_SEVERITIES } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutate, mutations } from "../../../scripts/json-mutation.js";
import {
  ACHIEVEMENT_TYPES,
  ALIGNMENT_TARGET_TYPES,
  ASSOCIATION_TYPES,
  type CredentialKind,
  type EntityKind,
  IDENTIFIER_TYPES,
  RESULT_STATUS_TYPES,
  RESULT_TYPES,
  STATUS_CODES_MINOR,
  validateCredential,
  validateEntity,
} from "../src/index.js";
import { CLASS_SCHEMAS } from "../src/read/internal.js";
import { definitionsOf, FILE_CASES, fileSchema, heldClass, isClosed, oracleOf, schemaExportName } from "./official.js";
import { RULES_BEYOND_SCHEMAS } from "./rules-beyond-schemas.js";

/** The runs of each property, and the seed that makes them the same on every run. */
const RUNS = { numRuns: 120, seed: 2024, endOnFailure: true };

function reads(name: string, credential: boolean, value: unknown): boolean {
  const issues = credential
    ? validateCredential(value, { kind: name.replace(/V1p1$/u, "") as CredentialKind })
    : validateEntity(name as EntityKind, value);
  return issues.every(({ severity, rule }) => severity !== "error" || RULES_BEYOND_SCHEMAS.has(rule));
}

describe.each(FILE_CASES)("$name", ({ name, credential, schema }) => {
  const oracle = oracleOf(schema());

  it("reads every value that the schema generates", () => {
    fc.assert(
      fc.property(oracle.arbitrary, (value) => {
        expect(oracle.valid(value)).toBe(true);
        expect(reads(name, credential, value)).toBe(true);
      }),
      RUNS,
    );
  });

  it("gives a value with one change the verdict of the schema", () => {
    fc.assert(
      fc.property(oracle.arbitrary, mutations, (value, change) => {
        const changed = mutate(value, change);
        expect(reads(name, credential, changed)).toBe(oracle.valid(changed));
      }),
      RUNS,
    );
  });
});

/** The files that define classes, and the classes that stand for the file as a whole. */
const SOURCES = [
  "ob_v3p0_anyachievementcredential_schema.json",
  "ob_v3p0_anyendorsementcredential_schema.json",
  "clr_v2p0_anyclrcredential_schema.json",
  "ob_v3p0_imsx_statusinfo_schema.json",
  "ob_v3p0_servicedescriptiondocument_schema.json",
];

describe("the classes", () => {
  const held = (className: string) =>
    heldClass(CLASS_SCHEMAS[schemaExportName(className) as keyof typeof CLASS_SCHEMAS]);

  it.each(SOURCES)(
    "holds every class that %s defines, with the properties and the required ones that it gives",
    (file) => {
      const source = fileSchema(file);
      for (const [className, official] of definitionsOf(source)) {
        const mine = held(className);
        expect(mine, className).toBeDefined();
        expect([...(mine?.properties ?? [])].sort(), className).toStrictEqual([...official.properties].sort());
        expect([...(mine?.required ?? [])].sort(), className).toStrictEqual([...official.required].sort());
        expect(mine?.strict, className).toBe(isClosed(source, className));
      }
    },
  );

  it.each(FILE_CASES.map(({ name, schema }) => [name, schema] as const))(
    "holds %s as its schema gives it",
    (name, schema) => {
      const root = schema();
      const official = definitionsOf(root);
      const target = typeof root.$ref === "string" ? official.get(root.$ref.replace("#/$defs/", "")) : undefined;
      const properties =
        target?.properties ?? (Array.isArray(root.anyOf) ? undefined : Object.keys((root.properties as object) ?? {}));
      const mine = held(name);
      expect(mine, name).toBeDefined();
      if (properties !== undefined)
        expect([...(mine?.properties ?? [])].sort(), name).toStrictEqual([...properties].sort());
    },
  );

  it("holds no class that a file does not define or a case does not name", () => {
    const named = new Set(
      [
        ...SOURCES.flatMap((file) => [...definitionsOf(fileSchema(file)).keys()]),
        ...FILE_CASES.map(({ name }) => name),
      ].map(schemaExportName),
    );
    const held = Object.entries(CLASS_SCHEMAS)
      .filter(([, schema]) => heldClass(schema) !== undefined)
      .map(([name]) => name);
    const strangers = held.filter((name) => !named.has(name));
    // Only the classes that a page alone prints and the sub-classes of the answers are held beyond the files.
    expect(strangers.sort()).toStrictEqual([
      "clrCredentialJwtPayloadSchema",
      "clrSubjectJwtPayloadSchema",
      "jwkSchema",
      "jwksSchema",
      "multikeySchema",
    ]);
  });
});

/** The enumeration that a property of a definition holds, with or without a pattern for extension terms beside it. */
function enumerationOf(file: string, className: string, property: string): unknown {
  const source = fileSchema(file);
  const defs = (source.$defs ?? {}) as Record<
    string,
    { properties?: Record<string, { enum?: unknown; oneOf?: { enum?: unknown }[] }> }
  >;
  const schema = className === "" ? (source as (typeof defs)[string]) : defs[className];
  const member = schema?.properties?.[property];
  return member?.enum ?? member?.oneOf?.find((branch) => branch.enum !== undefined)?.enum;
}

describe("the vocabularies", () => {
  const ACH = "ob_v3p0_anyachievementcredential_schema.json";
  const IMSX = "ob_v3p0_imsx_statusinfo_schema.json";
  it.each([
    ["ACHIEVEMENT_TYPES", ACHIEVEMENT_TYPES, ACH, "Achievement", "achievementType"],
    ["ALIGNMENT_TARGET_TYPES", ALIGNMENT_TARGET_TYPES, ACH, "Alignment", "targetType"],
    ["IDENTIFIER_TYPES", IDENTIFIER_TYPES, ACH, "IdentityObject", "identityType"],
    ["RESULT_TYPES", RESULT_TYPES, ACH, "ResultDescription", "resultType"],
    ["RESULT_STATUS_TYPES", RESULT_STATUS_TYPES, ACH, "Result", "status"],
    ["ASSOCIATION_TYPES", ASSOCIATION_TYPES, "clr_v2p0_clrcredential_schema.json", "Association", "associationType"],
    ["STATUS_CODES_MAJOR", STATUS_CODES_MAJOR, IMSX, "", "imsx_codeMajor"],
    ["STATUS_SEVERITIES", STATUS_SEVERITIES, IMSX, "", "imsx_severity"],
    ["STATUS_CODES_MINOR", STATUS_CODES_MINOR, IMSX, "Imsx_CodeMinorField", "imsx_codeMinorFieldValue"],
  ])("holds the terms of %s that the schema gives, in its order", (_name, terms, file, className, property) => {
    expect([...terms]).toStrictEqual(enumerationOf(file, className, property));
  });

  it("gives the same terms to the identifier types of an IdentifierEntry and an IdentityObject", () => {
    expect(enumerationOf(ACH, "IdentifierEntry", "identifierType")).toStrictEqual(
      enumerationOf(ACH, "IdentityObject", "identityType"),
    );
  });
});
