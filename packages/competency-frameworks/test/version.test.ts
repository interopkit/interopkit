import { DataError } from "@interopkit/core";
import { MAX_JSON_DEPTH } from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import {
  type CasePackage,
  type CFAssociation,
  type CFAssociationSet,
  convertCaseVersion,
  ENTITY_KINDS,
  validateEntity,
  validatePackage,
} from "../src/index.js";
import { copyOf, minimalPackage, summary } from "./fixture.js";
import { fullEntities, fullPackage, id } from "./full-package.js";

/** Lists the path of every property of an object and of the objects and arrays inside it. */
function propertyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, member]) => {
    const path = Array.isArray(value) ? `${prefix}[${key}]` : prefix === "" ? key : `${prefix}.${key}`;
    return [path, ...propertyPaths(member, path)];
  });
}

describe("convertCaseVersion of a package", () => {
  const input = fullPackage();
  const { value, dropped } = convertCaseVersion(deepFreeze(copyOf(input)), "1.0");

  it("leaves out exactly the properties that 1.0 does not have, and reports each of them", () => {
    // The associations that 1.0 cannot hold are the last two, so that dropping them moves no other index.
    const kept = propertyPaths(input).filter((path) => !/^CFAssociations\[[45]\]/u.test(path));
    const left = new Set(propertyPaths(value));
    // A `targetType` of CASE is the default of 1.0, so that leaving it out loses nothing and is not reported.
    const silent = ["CFAssociations[0].originNodeURI.targetType", "CFAssociations[3].destinationNodeURI.targetType"];
    const gone = kept.filter((path) => !left.has(path) && !silent.includes(path));
    // What is inside a property that is left out goes with it and is not reported on its own.
    const removed = gone.filter(
      (path) => !gone.some((other) => path.startsWith(`${other}.`) || path.startsWith(`${other}[`)),
    );
    const reported = dropped.filter(({ rule }) => rule === "property-not-in-1.0").map(({ path }) => path);
    expect(reported.sort()).toStrictEqual(removed.sort());
    expect(removed).toHaveLength(18);
    expect(silent.every((path) => !left.has(path))).toBe(true);
    expect(dropped.every(({ severity }) => severity === "warning")).toBe(true);
  });

  it("leaves out the associations whose type 1.0 lacks, and says why", () => {
    expect(
      dropped
        .filter(({ rule }) => rule !== "property-not-in-1.0")
        .map(({ path, rule, message }) => ({ path, rule, message })),
    ).toStrictEqual([
      {
        path: "CFAssociations[4]",
        rule: "association-type-not-in-1.0",
        message:
          'the association is left out, because its type "ext:prerequisite" is not one of the association types of CASE 1.0.',
      },
      {
        path: "CFAssociations[5]",
        rule: "association-type-not-in-1.0",
        message:
          'the association is left out, because its type "isTranslationOf" is not one of the association types of CASE 1.0.',
      },
    ]);
    expect(value.CFAssociations).toHaveLength(4);
  });

  it("does not repeat the path in a sentence", () => {
    for (const { path, message } of dropped) expect(path === "" || message.includes(path)).toBe(false);
  });

  it("gives a package that is judged without a finding in 1.0, and keeps what 1.0 has", () => {
    expect(validatePackage(value, { version: "1.0" })).toStrictEqual([]);
    expect(value.CFDocument.title).toBe(input.CFDocument.title);
    expect(value.CFItems?.[0]?.fullStatement).toBe(input.CFItems?.[0]?.fullStatement);
    expect(value.CFItems?.[0]?.language).toBe("eng");
  });

  it("shares nothing with its input", () => {
    expect(value).not.toBe(input);
    expect(value.CFItems?.[0]).not.toBe(input.CFItems?.[0]);
    expect(value.CFItems?.[0]?.educationLevel).not.toBe(input.CFItems?.[0]?.educationLevel);
    expect(value.CFAssociations?.[0]?.originNodeURI).not.toBe(input.CFAssociations?.[0]?.originNodeURI);
  });

  it("changes nothing in a package of 1.0, and reports nothing", () => {
    const form10 = convertCaseVersion(fullPackage(), "1.0").value;
    expect(convertCaseVersion(form10, "1.0")).toStrictEqual({ value: form10, dropped: [] });
    expect(convertCaseVersion(minimalPackage(), "1.0")).toStrictEqual({ value: minimalPackage(), dropped: [] });
  });

  it("leaves out an association whose node is not a node of CASE, which 1.0 would read as one", () => {
    const pkg: Record<string, any> = copyOf(fullPackage());
    pkg.CFAssociations[1].originNodeURI.targetType = "ext:video";
    const converted = convertCaseVersion(pkg as CasePackage, "1.0");
    expect(summary(converted.dropped.filter(({ rule }) => rule === "target-type-not-in-1.0"))).toStrictEqual([
      { path: "CFAssociations[1]", rule: "target-type-not-in-1.0", severity: "warning" },
    ]);
    expect(converted.value.CFAssociations).toHaveLength(3);
  });

  it("keeps the absent lists absent and an emptied list empty", () => {
    expect(convertCaseVersion(minimalPackage(), "1.0").value).not.toHaveProperty("CFAssociations");
    const only11: Record<string, any> = copyOf(minimalPackage());
    only11.CFAssociations = [{ ...fullPackage().CFAssociations?.[5] }];
    expect(convertCaseVersion(only11 as CasePackage, "1.0").value.CFAssociations).toStrictEqual([]);
  });
});

describe("the forms that 1.0 refuses", () => {
  /** Converts the full package with one change, and returns the reports of a form and the findings of 1.0. */
  function converted(change: (pkg: Record<string, any>) => void) {
    const pkg: Record<string, any> = copyOf(fullPackage());
    change(pkg);
    const { value, dropped } = convertCaseVersion(pkg as CasePackage, "1.0");
    return {
      value,
      forms: dropped.filter(({ rule }) => rule === "form-not-in-1.0").map(({ path }) => path),
      errors: validatePackage(value, { version: "1.0" })
        .filter(({ severity }) => severity === "error")
        .map(({ path }) => path),
    };
  }

  it.each([
    [
      "an identifier in upper case",
      (pkg: Record<string, any>) => {
        pkg.CFDocument.identifier = id(0xa0).toUpperCase();
      },
      "CFDocument.identifier",
    ],
    [
      "an identifier of version 7",
      (pkg: Record<string, any>) => {
        pkg.CFItems[1].identifier = "00000000-0000-7000-8000-000000000003";
      },
      "CFItems[1].identifier",
    ],
    [
      "an identifier of variant c",
      (pkg: Record<string, any>) => {
        pkg.CFItems[1].identifier = "00000000-0000-4000-c000-000000000003";
      },
      "CFItems[1].identifier",
    ],
    [
      "a relative URI of an item",
      (pkg: Record<string, any>) => {
        pkg.CFItems[1].uri = "CFItems/3";
      },
      "CFItems[1].uri",
    ],
    [
      "a relative officialSourceURL",
      (pkg: Record<string, any>) => {
        pkg.CFDocument.officialSourceURL = "standards.pdf";
      },
      "CFDocument.officialSourceURL",
    ],
    [
      "a relative URI of a node",
      (pkg: Record<string, any>) => {
        pkg.CFAssociations[1].originNodeURI.uri = "CFItems/3";
      },
      "CFAssociations[1].originNodeURI.uri",
    ],
    [
      "an identifier of a link",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].licenseURI.identifier = "x";
      },
      "CFItems[0].licenseURI.identifier",
    ],
    [
      "a URI of a link in a list",
      (pkg: Record<string, any>) => {
        pkg.CFDocument.subjectURI[0].uri = "x/y";
      },
      "CFDocument.subjectURI[0].uri",
    ],
    [
      "the rubric of a criterion",
      (pkg: Record<string, any>) => {
        pkg.CFRubrics[0].CFRubricCriteria[0].rubricId = "x";
      },
      "CFRubrics[0].CFRubricCriteria[0].rubricId",
    ],
  ])("reports %s, keeps it as it is, and gives a value that 1.0 refuses at that path", (_name, change, path) => {
    const result = converted(change);
    expect(result.forms).toStrictEqual([path]);
    expect(result.errors).toContain(path);
  });

  it("reports nothing for a package whose forms are those of 1.0, and gives a value that 1.0 reads", () => {
    const result = converted(() => undefined);
    expect(result.forms).toStrictEqual([]);
    expect(result.errors).toStrictEqual([]);
  });

  it("says what 1.0 asks for and that the value is kept", () => {
    const { dropped } = convertCaseVersion(
      { ...minimalPackage(), CFDocument: { ...minimalPackage().CFDocument, identifier: "X", uri: "u" } },
      "1.0",
    );
    expect(dropped.map(({ message }) => message)).toStrictEqual([
      'the identifier "X" is not of the form that CASE 1.0 asks for, a UUID of lower-case digits, of version 1 to 5; it is kept as it is.',
      'the URI "u" is not of the form that CASE 1.0 asks for, a URI with a scheme; it is kept as it is.',
    ]);
  });
});

describe("convertCaseVersion of an entity", () => {
  const entities = fullEntities();

  it.each(ENTITY_KINDS.filter((kind) => kind !== "CFAssociation" && kind !== "CFAssociationSet"))(
    "gives %s in the form of 1.0, which is judged in 1.0 without an error",
    (kind) => {
      const { value } = convertCaseVersion(deepFreeze(copyOf(entities[kind])), "1.0");
      expect(
        validateEntity(kind, value, { version: "1.0" }).filter(({ severity }) => severity === "error"),
      ).toStrictEqual([]);
    },
  );

  it("gives no association when the type has no form in 1.0, and says why", () => {
    const association: CFAssociation = {
      ...(entities.CFAssociation as CFAssociation),
      associationType: "isTranslationOf",
    };
    const converted = convertCaseVersion(association, "1.0");
    expect(converted.value).toBeUndefined();
    expect(summary(converted.dropped)).toStrictEqual([
      { path: "", rule: "association-type-not-in-1.0", severity: "warning" },
    ]);
  });

  it("gives an association of a type that 1.0 has, without what 1.1 adds to it", () => {
    const converted = convertCaseVersion(entities.CFAssociation as CFAssociation, "1.0");
    expect(converted.value).toBeDefined();
    expect(validateEntity("CFAssociation", converted.value, { version: "1.0" })).toStrictEqual([]);
    expect(converted.dropped.map(({ path }) => path).sort()).toStrictEqual(["extensions", "notes"]);
  });

  it("gives the set of an item's associations with those that 1.0 has, and none when it has none", () => {
    const set = entities.CFAssociationSet as CFAssociationSet;
    const partial = convertCaseVersion(set, "1.0");
    expect(partial.value?.CFAssociations).toHaveLength(3);
    expect(validateEntity("CFAssociationSet", partial.value, { version: "1.0" })).toStrictEqual([]);
    const translation: CFAssociation = {
      ...(entities.CFAssociation as CFAssociation),
      associationType: "isTranslationOf",
    };
    const none = convertCaseVersion({ ...set, CFAssociations: [translation] }, "1.0");
    expect(none.value).toBeUndefined();
    expect(none.dropped.filter(({ rule }) => rule !== "property-not-in-1.0").map(({ rule }) => rule)).toStrictEqual([
      "association-type-not-in-1.0",
      "association-set-empty",
    ]);
  });
});

describe("the arguments of convertCaseVersion", () => {
  it.each([[null], ["package"], [5], [[]]])("refuses the value %j", (value) => {
    expect(() => convertCaseVersion(value as never, "1.0")).toThrow(DataError);
    expect(() => convertCaseVersion(value as never, "1.0")).toThrow("The value must be an object");
  });

  it.each([
    ["1.1", 'The version is invalid: expected "1.0", found "1.1".'],
    [1, 'The version is invalid: expected "1.0", found 1.'],
    [null, 'The version is invalid: expected "1.0", found null.'],
    [undefined, 'The version is invalid: expected "1.0", found undefined.'],
  ])("refuses the version %j", (version, sentence) => {
    expect(() => convertCaseVersion(minimalPackage(), version as never)).toThrow(new DataError(sentence));
  });

  it.each([
    [
      "an item list that is an object",
      { ...minimalPackage(), CFItems: {} },
      "CFItems must be an array, found an object.",
    ],
    ["an item that is a string", { ...minimalPackage(), CFItems: ["x"] }, 'CFItems[0] must be an object, found "x".'],
    ["a document that is null", { CFDocument: null }, "CFDocument must be an object, found null."],
    [
      "an association list that is null",
      { ...minimalPackage(), CFAssociations: null },
      "CFAssociations must be an array, found null.",
    ],
    [
      "an association that is a number",
      { ...minimalPackage(), CFAssociations: [5] },
      "CFAssociations[0] must be an object, found 5.",
    ],
    [
      "a node that is null",
      { ...minimalPackage(), CFAssociations: [{ associationType: "isChildOf", originNodeURI: null }] },
      "CFAssociations[0].originNodeURI must be an object, found null.",
    ],
    [
      "a rubric list that is a string",
      { ...minimalPackage(), CFRubrics: "x" },
      'CFRubrics must be an array, found "x".',
    ],
    [
      "a definition that is an array",
      { ...minimalPackage(), CFDefinitions: [] },
      "CFDefinitions must be an object, found an array.",
    ],
  ])("refuses %s with a sentence", (_name, value, sentence) => {
    expect(() => convertCaseVersion(value as never, "1.0")).toThrow(new DataError(sentence));
  });

  it("refuses a property that it copies and JSON cannot hold, and says where", () => {
    const pkg = { ...minimalPackage(), CFItems: [{ language: () => 1 }] };
    expect(() => convertCaseVersion(pkg as never, "1.0")).toThrow(
      new DataError("CFItems[0].language is a function, which JSON cannot hold."),
    );
  });

  it("refuses a value that nests deeper than any package or entity does, whatever its depth", () => {
    let deep: Record<string, unknown> = {};
    for (let level = 0; level < 200_000; level += 1) deep = { CFItem: deep };
    expect(() => convertCaseVersion(deep as never, "1.0")).toThrow(DataError);
    expect(() => convertCaseVersion(deep as never, "1.0")).toThrow(
      `nests more than ${MAX_JSON_DEPTH} levels, the most that a package or an entity has.`,
    );
    let list: Record<string, unknown> = {};
    for (let level = 0; level < 200_000; level += 1) list = { CFRubrics: [list] };
    expect(() => convertCaseVersion(list as never, "1.0")).toThrow(DataError);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses a member named %s at every level that it converts, as the readers refuse it",
    (name) => {
      const member = JSON.stringify(name);
      const refused = `the property ${member} is refused`;
      const framework = JSON.stringify(minimalPackage());
      const atTop = framework.replace(/^\{/u, `{${member}:{"top":1},`);
      expect(() => convertCaseVersion(JSON.parse(atTop) as never, "1.0")).toThrow(DataError);
      expect(() => convertCaseVersion(JSON.parse(atTop) as never, "1.0")).toThrow(refused);
      const inDocument = framework.replace('"CFDocument":{', `"CFDocument":{${member}:{"top":1},`);
      expect(inDocument).not.toBe(framework);
      expect(() => convertCaseVersion(JSON.parse(inDocument) as never, "1.0")).toThrow(refused);
      const node = JSON.parse(`{"identifier":"a","uri":"https://example.org/a","title":"A",${member}:"x"}`);
      const association = {
        identifier: "3e0d8c1a-7b64-4d02-8d3f-5f0c1c9c7a11",
        uri: "https://example.org/associations/1",
        lastChangeDateTime: "2024-01-01T00:00:00Z",
        associationType: "exactMatchOf",
        originNodeURI: node,
        destinationNodeURI: { identifier: "b", uri: "https://example.org/b", title: "B" },
      };
      expect(() => convertCaseVersion(association as never, "1.0")).toThrow(refused);
    },
  );
});
