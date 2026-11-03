import fc from "fast-check";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import {
  ASSOCIATION_TYPES,
  type CaseEntityKind,
  type CaseVersion,
  convertCaseVersion,
  ENTITY_KINDS,
  STATUS_CODES_MAJOR,
  STATUS_CODES_MINOR,
  STATUS_SEVERITIES,
} from "../src/index.js";
import { ASSOCIATION_TYPES_1_0 } from "../src/model/internal.js";
import { SCHEMAS } from "../src/read/internal.js";
import { fullEntities, fullPackage, id } from "./full-package.js";
import { officialArbitrary, officialClasses, officialSchema, officialValidator } from "./official.js";

const VERSIONS: readonly CaseVersion[] = ["1.0", "1.1"];
/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_101, numRuns: 120 };
/** The strings that a member may be replaced by: the bad forms of the formats, and the terms of the vocabularies. */
const STRINGS = [...BAD_STRINGS, "isChildOf", "isTranslationOf", "CASE", "ext:video", "1.1", "1.0"];

/** Tells whether the reader accepts the shape of a package, which is what the official schemas judge. */
function readsPackage(version: CaseVersion, value: unknown): boolean {
  return v.safeParse(SCHEMAS[version].package, value).success;
}

/** Tells whether the reader accepts the shape of an entity. */
function readsEntity(version: CaseVersion, kind: CaseEntityKind, value: unknown): boolean {
  return v.safeParse(SCHEMAS[version].entities[kind], value).success;
}

/** The kinds that each version has an official schema to compare with: 1.0 spells two status codes in its own way. */
function comparedKinds(version: CaseVersion): readonly CaseEntityKind[] {
  return version === "1.0" ? ENTITY_KINDS.filter((kind) => kind !== "imsx_StatusInfo") : ENTITY_KINDS;
}

describe.each(VERSIONS)("the readers of CASE %s against the official JSON schemas", (version) => {
  const officialPackage = officialValidator(version, "package");

  it("have every class and property that the schemas define, and require the same", () => {
    const official = officialClasses(version);
    const ours = SCHEMAS[version].classes;
    expect([...ours.keys()].sort()).toStrictEqual([...official.keys()].sort());
    for (const [name, entries] of ours) {
      const expected = official.get(name);
      const required = Object.entries(entries)
        .filter(([, schema]) => schema.type !== "optional")
        .map(([property]) => property);
      expect(Object.keys(entries).sort(), `the properties of ${name}`).toStrictEqual(
        [...(expected?.properties ?? [])].sort(),
      );
      expect(required.sort(), `the required properties of ${name}`).toStrictEqual(
        [...(expected?.required ?? [])].sort(),
      );
    }
  });

  it("read a package that the schemas accept, whatever it holds", () => {
    fc.assert(
      fc.property(officialArbitrary(version, "package"), (pkg) => {
        expect(officialPackage(pkg)).toBe(true);
        expect(readsPackage(version, pkg)).toBe(true);
      }),
      RUNS,
    );
  });

  it("give the verdict of the schemas on a package with one change", () => {
    fc.assert(
      fc.property(officialArbitrary(version, "package"), mutations, (pkg, mutation) => {
        const changed = mutate(pkg, mutation, STRINGS);
        expect(readsPackage(version, changed), JSON.stringify(changed)).toBe(officialPackage(changed));
      }),
      { ...RUNS, numRuns: 600 },
    );
  });

  it.each(comparedKinds(version))("read %s as the schemas do, with and without one change", (kind) => {
    const official = officialValidator(version, kind);
    fc.assert(
      fc.property(officialArbitrary(version, kind), mutations, (entity, mutation) => {
        expect(official(entity)).toBe(true);
        expect(readsEntity(version, kind, entity)).toBe(true);
        const changed = mutate(entity, mutation, STRINGS);
        expect(readsEntity(version, kind, changed), JSON.stringify(changed)).toBe(official(changed));
      }),
      { ...RUNS, numRuns: 150 },
    );
  });
});

/** Follows a path of names through the parts of a parsed schema. */
function at(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const name of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, name);
  }
  return current;
}

describe("the vocabularies against the official JSON schemas", () => {
  it("hold the association types of the 1.1 schema, and those of the 1.0 schema, which lack isTranslationOf", () => {
    const schema11 = officialSchema("1.1", "package");
    const types11 = at(schema11, "$defs", "CFPckgAssociation", "properties", "associationType", "oneOf", "0", "enum");
    const types10 = at(
      officialSchema("1.0", "package"),
      "definitions",
      "CFPckgAssociationDType",
      "properties",
      "associationType",
      "enum",
    );
    expect(types11).toStrictEqual([...ASSOCIATION_TYPES]);
    expect(types10).toStrictEqual([...ASSOCIATION_TYPES_1_0]);
    expect(ASSOCIATION_TYPES.filter((type) => !ASSOCIATION_TYPES_1_0.includes(type))).toStrictEqual([
      "isTranslationOf",
    ]);
  });

  it("hold the codes of a status of the 1.1 schema, and the one that the binding adds", () => {
    const official = officialValidator("1.1", "imsx_StatusInfo");
    for (const major of STATUS_CODES_MAJOR) {
      expect(official({ imsx_codeMajor: major, imsx_severity: "status" }), major).toBe(true);
    }
    for (const severity of STATUS_SEVERITIES) {
      expect(official({ imsx_codeMajor: "success", imsx_severity: severity }), severity).toBe(true);
    }
    const accepted = (code: string) =>
      official({
        imsx_codeMajor: "failure",
        imsx_severity: "error",
        imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldName: "f", imsx_codeMinorFieldValue: code }] },
      });
    expect(STATUS_CODES_MINOR.filter((code) => !accepted(code))).toStrictEqual(["invalid_filter_field"]);
  });
});

describe("the full package and the entities of the tests", () => {
  /** Adds the properties that the objects of one class have, so that the full package can be held to every property. */
  function collect(into: Map<string, Set<string>>, name: string, objects: readonly unknown[]): void {
    const names = into.get(name) ?? new Set<string>();
    for (const object of objects) {
      if (typeof object === "object" && object !== null) for (const key of Object.keys(object)) names.add(key);
    }
    into.set(name, names);
  }

  it("hold every property of every class of CASE 1.1 that a package or an entity has", () => {
    const pkg = fullPackage();
    const seen = new Map<string, Set<string>>();
    const nodes = (pkg.CFAssociations ?? []).flatMap(({ originNodeURI, destinationNodeURI }) => [
      originNodeURI,
      destinationNodeURI,
    ]);
    const definitions = pkg.CFDefinitions ?? {};
    const criteria = (pkg.CFRubrics ?? []).flatMap((rubric) => rubric.CFRubricCriteria ?? []);
    const links = [
      pkg.CFDocument.licenseURI,
      ...(pkg.CFDocument.subjectURI ?? []),
      ...(pkg.CFItems ?? []).flatMap((item) => [item.conceptKeywordsURI, item.CFItemTypeURI, item.licenseURI]),
    ];
    collect(seen, "CFPackage", [pkg]);
    collect(seen, "CFPckgDocument", [pkg.CFDocument]);
    collect(seen, "CFPckgItem", pkg.CFItems ?? []);
    collect(seen, "CFPckgAssociation", pkg.CFAssociations ?? []);
    collect(seen, "LinkGenURI", nodes);
    collect(seen, "LinkURI", links);
    collect(seen, "CFDefinition", [definitions]);
    collect(seen, "CFConcept", definitions.CFConcepts ?? []);
    collect(seen, "CFSubject", definitions.CFSubjects ?? []);
    collect(seen, "CFLicense", definitions.CFLicenses ?? []);
    collect(seen, "CFItemType", definitions.CFItemTypes ?? []);
    collect(seen, "CFAssociationGrouping", definitions.CFAssociationGroupings ?? []);
    collect(seen, "CFRubric", pkg.CFRubrics ?? []);
    collect(seen, "CFRubricCriterion", criteria);
    collect(
      seen,
      "CFRubricCriterionLevel",
      criteria.flatMap((criterion) => criterion.CFRubricCriterionLevels ?? []),
    );
    const status = fullEntities().imsx_StatusInfo;
    collect(seen, "imsx_CodeMinor", "imsx_codeMinor" in status ? [status.imsx_codeMinor] : []);
    collect(
      seen,
      "imsx_CodeMinorField",
      "imsx_codeMinor" in status ? (status.imsx_codeMinor?.imsx_codeMinorField ?? []) : [],
    );
    for (const [kind, entity] of Object.entries(fullEntities())) collect(seen, kind, [entity]);
    for (const [name, official] of officialClasses("1.1")) {
      expect([...(seen.get(name) ?? [])].sort(), `the properties that the tests give ${name}`).toStrictEqual(
        [...official.properties].sort(),
      );
    }
  });

  it("are accepted by the official schemas", () => {
    expect(officialValidator("1.1", "package")(fullPackage())).toBe(true);
    for (const [kind, entity] of Object.entries(fullEntities())) {
      expect(officialValidator("1.1", kind as CaseEntityKind)(entity), kind).toBe(true);
    }
  });
});

describe("the conversion to CASE 1.0 against the official JSON schemas of 1.0", () => {
  /** Tells whether a conversion reported a form that 1.0 refuses. */
  const reportsForm = (dropped: readonly { readonly rule: string }[]) =>
    dropped.some(({ rule }) => rule === "form-not-in-1.0");

  it("gives a package that the schemas of 1.0 accept, or reports each form that they refuse, whatever 1.1 holds", () => {
    const official = officialValidator("1.0", "package");
    fc.assert(
      fc.property(officialArbitrary("1.1", "package", "1.1"), (pkg) => {
        const { value, dropped } = convertCaseVersion(JSON.parse(JSON.stringify(pkg)), "1.0");
        expect(official(value), JSON.stringify(value)).toBe(!reportsForm(dropped));
        if (!reportsForm(dropped)) expect(readsPackage("1.0", value)).toBe(true);
      }),
      RUNS,
    );
  });

  it.each(comparedKinds("1.0"))(
    "gives %s as the schemas of 1.0 accept it, reports each form they refuse, or gives none",
    (kind) => {
      const official = officialValidator("1.0", kind);
      fc.assert(
        fc.property(officialArbitrary("1.1", kind, "1.1"), (entity) => {
          const { value, dropped } = convertCaseVersion(JSON.parse(JSON.stringify(entity)), "1.0");
          if (value === undefined) return;
          expect(official(value), JSON.stringify(value)).toBe(!reportsForm(dropped));
        }),
        RUNS,
      );
    },
  );

  it("gives the full package and the full entities in the form of 1.0", () => {
    expect(officialValidator("1.0", "package")(convertCaseVersion(fullPackage(), "1.0").value)).toBe(true);
    for (const [kind, entity] of Object.entries(fullEntities())) {
      if (kind === "imsx_StatusInfo") continue;
      const { value } = convertCaseVersion(entity, "1.0");
      expect(value === undefined || officialValidator("1.0", kind as CaseEntityKind)(value), kind).toBe(true);
    }
  });
});

describe("the cases in which a reader is stricter than the validator that reads the official schemas", () => {
  /** The verdict of the validator and of the reader on the full package of a version with one change. */
  function verdicts(version: CaseVersion, change: (pkg: Record<string, any>) => void) {
    const pkg: Record<string, any> = JSON.parse(
      JSON.stringify(version === "1.1" ? fullPackage() : convertCaseVersion(fullPackage(), "1.0").value),
    );
    change(pkg);
    return { validator: officialValidator(version, "package")(pkg), reader: readsPackage(version, pkg) };
  }
  const accepted = { validator: true, reader: false };
  const uuid = id(0xa0);

  it("refuses text around the identifier of 1.0, which the pattern of the schema without anchors accepts", () => {
    expect(
      verdicts("1.0", (pkg) => {
        pkg.CFDocument.identifier = `x${uuid}y`;
      }),
    ).toStrictEqual(accepted);
  });

  it("refuses the prefix urn:uuid: before an identifier of 1.1, which the validator accepts", () => {
    expect(
      verdicts("1.1", (pkg) => {
        pkg.CFDocument.identifier = `urn:uuid:${uuid}`;
      }),
    ).toStrictEqual(accepted);
  });

  it.each(["2024-06-13 18:46:03Z", "2024-06-13T18:46:03+0000", "2024-06-13T18:46:03+00"])(
    "refuses the date and time %j, which the validator accepts and RFC 3339 does not write",
    (time) => {
      expect(
        verdicts("1.1", (pkg) => {
          pkg.CFDocument.lastChangeDateTime = time;
        }),
      ).toStrictEqual(accepted);
    },
  );

  it.each(["ext:a b", "next:a", "ext:a|b"])(
    "refuses the association type %j, which the pattern of the schema without anchors accepts",
    (type) => {
      expect(
        verdicts("1.1", (pkg) => {
          pkg.CFAssociations[0].associationType = type;
        }),
      ).toStrictEqual(accepted);
    },
  );

  it("accepts the association type ext:-a, which the pattern of the schema refuses because its class has no hyphen", () => {
    expect(
      verdicts("1.1", (pkg) => {
        pkg.CFAssociations[0].associationType = "ext:-a";
      }),
    ).toStrictEqual({
      validator: false,
      reader: true,
    });
  });

  it.each([
    ["foo:", { validator: false, reader: true }],
    ["x:", { validator: false, reader: true }],
    ["a:é", { validator: false, reader: true }],
    ["https://x.org/%zz", { validator: false, reader: true }],
    ["https://", { validator: true, reader: false }],
  ])(
    "reads the 1.0 URI %j more loosely or more strictly than the validator, which is stricter about the RFC 3986 grammar",
    (uri, expected) => {
      expect(
        verdicts("1.0", (pkg) => {
          pkg.CFDocument.uri = uri;
        }),
      ).toStrictEqual(expected);
    },
  );

  it("reports one unknown property of an object, where the validator reports each, and refuses with the same verdict", () => {
    const pkg: Record<string, any> = JSON.parse(JSON.stringify(fullPackage()));
    pkg.CFDocument.first = 1;
    pkg.CFDocument.second = 2;
    expect(officialValidator("1.1", "package")(pkg)).toBe(false);
    const result = v.safeParse(SCHEMAS["1.1"].package, pkg);
    expect(result.issues?.map(({ path }) => path?.map(({ key }) => key).join("."))).toStrictEqual(["CFDocument.first"]);
  });

  it("accepts invalid_filter_field in a status, which the enumeration of the schema lacks and the REST binding uses", () => {
    const status = {
      imsx_codeMajor: "failure",
      imsx_severity: "error",
      imsx_codeMinor: {
        imsx_codeMinorField: [{ imsx_codeMinorFieldName: "filter", imsx_codeMinorFieldValue: "invalid_filter_field" }],
      },
    };
    expect(officialValidator("1.1", "imsx_StatusInfo")(status)).toBe(false);
    expect(readsEntity("1.1", "imsx_StatusInfo", status)).toBe(true);
  });

  it("refuses the codes unauthorisedrequest and invaliduuid of the 1.0 schema, which spells them without an underscore", () => {
    const status = (code: string) => ({
      imsx_codeMajor: "failure",
      imsx_severity: "error",
      imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldName: "f", imsx_codeMinorFieldValue: code }] },
    });
    for (const [spelled, written] of [
      ["unauthorisedrequest", "unauthorised_request"],
      ["invaliduuid", "invalid_uuid"],
    ] as const) {
      expect(officialValidator("1.0", "imsx_StatusInfo")(status(spelled)), spelled).toBe(true);
      expect(readsEntity("1.0", "imsx_StatusInfo", status(spelled)), spelled).toBe(false);
      expect(officialValidator("1.0", "imsx_StatusInfo")(status(written)), written).toBe(false);
      expect(readsEntity("1.0", "imsx_StatusInfo", status(written)), written).toBe(true);
    }
  });
});
