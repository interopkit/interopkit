import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import {
  type CaseEntityKind,
  ENTITY_KINDS,
  readEntity,
  readPackage,
  toCaseVersion,
  validateEntity,
  validatePackage,
} from "../src/index.js";
import { copyOf, minimalPackage, summary } from "./fixture.js";
import { fullEntities, fullPackage, id } from "./full-package.js";

/** Judges a full package that a test has changed, and returns where, which rule and how serious. */
function found(change: (pkg: Record<string, any>) => void, version?: "1.0" | "1.1") {
  const pkg: Record<string, any> = copyOf(
    version === "1.0" ? toCaseVersion(fullPackage(), "1.0").value : fullPackage(),
  );
  change(pkg);
  return summary(validatePackage(pkg, version === undefined ? undefined : { version }));
}

describe("readPackage", () => {
  it("reads the full package of 1.1 into an equal package", () => {
    expect(readPackage(fullPackage())).toStrictEqual(fullPackage());
  });

  it("reads a package that holds a document and nothing else", () => {
    expect(readPackage(minimalPackage())).toStrictEqual(minimalPackage());
  });

  it("returns a copy that shares nothing with the input, the extensions included", () => {
    const input = fullPackage();
    const pkg = readPackage(input);
    const level = (from: typeof input) => from.CFRubrics?.[0]?.CFRubricCriteria?.[0]?.CFRubricCriterionLevels?.[0];
    expect(pkg).not.toBe(input);
    expect(pkg.CFDocument).not.toBe(input.CFDocument);
    expect(pkg.CFItems?.[0]).not.toBe(input.CFItems?.[0]);
    expect(pkg.CFItems?.[0]?.extensions).not.toBe(input.CFItems?.[0]?.extensions);
    expect(pkg.CFItems?.[0]?.subject).not.toBe(input.CFItems?.[0]?.subject);
    expect(level(pkg)?.extensions).not.toBe(level(input)?.extensions);
  });

  it("copies the lists inside the extensions", () => {
    const list = [1, [2]];
    const pkg = readPackage({ ...minimalPackage(), extensions: { list } });
    const copy = pkg.extensions?.list;
    expect(copy).toStrictEqual(list);
    expect(copy).not.toBe(list);
    expect(Array.isArray(copy) && copy[1]).not.toBe(list[1]);
  });

  it("does not change its input", () => {
    expect(readPackage(deepFreeze(fullPackage()))).toStrictEqual(fullPackage());
  });

  it("reads a package of 1.0, which is a package of 1.1 without what 1.1 adds", () => {
    const form10 = toCaseVersion(fullPackage(), "1.0").value;
    expect(readPackage(form10, { version: "1.0" })).toStrictEqual(form10);
    expect(readPackage(form10)).toStrictEqual(form10);
  });

  it("reads a package that has only warnings, and gives no word of them", () => {
    const pkg: Record<string, any> = copyOf(fullPackage());
    pkg.CFItems[0].licenseURI.uri = "https://elsewhere.example/license";
    expect(validatePackage(pkg)).toHaveLength(1);
    expect(readPackage(pkg)).toStrictEqual(pkg);
  });

  it("refuses a package with an error, and names the path and the sentence of the first", () => {
    const pkg: Record<string, any> = copyOf(fullPackage());
    delete pkg.CFDocument.title;
    expect(() => readPackage(pkg)).toThrow(
      new DataError('The package is invalid at CFDocument.title: missing the property "title".'),
    );
  });

  it("counts the errors that follow the first, and says where to list them", () => {
    const pkg: Record<string, any> = copyOf(fullPackage());
    pkg.CFDocument.creator = 5;
    delete pkg.CFDocument.title;
    expect(() => readPackage(pkg)).toThrow(
      new DataError(
        "The package is invalid at CFDocument.creator: expected a string, found 5. 1 more error: validatePackage lists every finding.",
      ),
    );
    pkg.CFItems[0].identifier = "x";
    expect(() => readPackage(pkg)).toThrow("2 more errors: validatePackage lists every finding.");
  });

  it("refuses an error of the rules of a package, such as an identifier that two entities share", () => {
    const pkg: Record<string, any> = copyOf(fullPackage());
    pkg.CFItems.push({ ...pkg.CFItems[0] });
    expect(() => readPackage(pkg)).toThrow(
      new DataError(
        `The package is invalid at CFItems[3].identifier: the identifier "${id(2)}" is also the identifier at CFItems[0].identifier; give each entity an identifier of its own.`,
      ),
    );
  });

  it.each([null, "package", 5, true, []])("refuses %j, which is not an object, without a path", (value) => {
    expect(() => readPackage(value)).toThrow(DataError);
    expect(() => readPackage(value)).toThrow(/^The package is invalid: expected an object, found /u);
  });

  describe("the options", () => {
    it.each([undefined, {}, { version: "1.1" }, { version: "1.0" }])("accept %j", (options) => {
      expect(readPackage(minimalPackage(), options as never)).toStrictEqual(minimalPackage());
    });

    it.each([
      [null, "The read options is invalid: expected an object, found null."],
      ["1.0", 'The read options is invalid: expected an object, found "1.0".'],
      [[], "The read options is invalid: expected an object, found an array."],
      [{ version: "2.0" }, 'The read options is invalid at version: expected "1.0" or "1.1", found "2.0".'],
      [{ version: 1.1 }, 'The read options is invalid at version: expected "1.0" or "1.1", found 1.1.'],
      [{ version: null }, 'The read options is invalid at version: expected "1.0" or "1.1", found null.'],
      [{ versions: "1.1" }, 'The read options is invalid: unexpected property "versions".'],
    ])("refuse %j with a sentence", (options, sentence) => {
      expect(() => readPackage(minimalPackage(), options as never)).toThrow(new DataError(sentence));
      expect(() => validatePackage(minimalPackage(), options as never)).toThrow(new DataError(sentence));
    });
  });
});

describe("validatePackage", () => {
  it("finds nothing in a package that is sound", () => {
    expect(validatePackage(fullPackage())).toStrictEqual([]);
    expect(validatePackage(minimalPackage())).toStrictEqual([]);
  });

  it("judges a package of 1.0 with the option, and one of 1.1 as 1.0 with what 1.1 adds as findings", () => {
    const form10 = toCaseVersion(fullPackage(), "1.0").value;
    expect(validatePackage(form10, { version: "1.0" })).toStrictEqual([]);
    expect(validatePackage(fullPackage(), { version: "1.0" }).length).toBeGreaterThan(0);
  });

  it.each([
    [
      "frameworkType of a document",
      "CFDocument.frameworkType",
      (pkg: Record<string, any>) => {
        pkg.CFDocument.frameworkType = "CourseCodes";
      },
    ],
    [
      "caseVersion of a document",
      "CFDocument.caseVersion",
      (pkg: Record<string, any>) => {
        pkg.CFDocument.caseVersion = "1.1";
      },
    ],
    [
      "subject of an item",
      "CFItems[0].subject",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].subject = ["x"];
      },
    ],
    [
      "subjectURI of an item",
      "CFItems[0].subjectURI",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].subjectURI = [];
      },
    ],
    [
      "notes of an association",
      "CFAssociations[0].notes",
      (pkg: Record<string, any>) => {
        pkg.CFAssociations[0].notes = "x";
      },
    ],
    [
      "targetType of a node",
      "CFAssociations[0].originNodeURI.targetType",
      (pkg: Record<string, any>) => {
        pkg.CFAssociations[0].originNodeURI.targetType = "CASE";
      },
    ],
    [
      "extensions of an association",
      "CFAssociations[1].extensions",
      (pkg: Record<string, any>) => {
        pkg.CFAssociations[1].extensions = {};
      },
    ],
    [
      "extensions of the definitions",
      "CFDefinitions.extensions",
      (pkg: Record<string, any>) => {
        pkg.CFDefinitions.extensions = {};
      },
    ],
    [
      "extensions of the package",
      "extensions",
      (pkg: Record<string, any>) => {
        pkg.extensions = {};
      },
    ],
  ])("finds in 1.0 the %s, which only 1.1 has", (_name, path, change) => {
    expect(found(() => undefined, "1.0")).toStrictEqual([]);
    expect(found(change, "1.0")).toStrictEqual([{ path, rule: "unknown-property", severity: "error" }]);
  });

  it.each(["isTranslationOf", "ext:prerequisite"])(
    "finds in 1.0 the association type %s, which only 1.1 has",
    (type) => {
      expect(
        found((pkg) => {
          pkg.CFAssociations[0].associationType = type;
        }, "1.0"),
      ).toStrictEqual([{ path: "CFAssociations[0].associationType", rule: "invalid-value", severity: "error" }]);
    },
  );

  it.each(["1.0", "1.2", "1", 1.1, null])(
    "refuses %j as the caseVersion of a document, which is 1.1 or absent",
    (version) => {
      expect(
        found((pkg) => {
          pkg.CFDocument.caseVersion = version;
        }),
      ).toStrictEqual([{ path: "CFDocument.caseVersion", rule: "invalid-value", severity: "error" }]);
    },
  );

  it.each(["ext:a b", "next:a", "ext:a|b", "ext:", "EXT:a", "ext:a/b"])(
    "refuses %j as an association type and as a target type, which are a term of ext: and a name",
    (term) => {
      expect(
        found((pkg) => {
          pkg.CFAssociations[0].associationType = term;
        }),
      ).toStrictEqual([{ path: "CFAssociations[0].associationType", rule: "invalid-value", severity: "error" }]);
      expect(
        found((pkg) => {
          pkg.CFAssociations[0].originNodeURI.targetType = term;
        }),
      ).toStrictEqual([
        { path: "CFAssociations[0].originNodeURI.targetType", rule: "invalid-value", severity: "error" },
      ]);
    },
  );

  it.each(["ext:a", "ext:A.b_c-d", "ext:0"])("accepts %j as an association type and as a target type", (term) => {
    const errors = found((pkg) => {
      pkg.CFAssociations[0].associationType = term;
      pkg.CFAssociations[0].originNodeURI.targetType = term;
    }).filter(({ severity }) => severity === "error");
    expect(errors).toStrictEqual([]);
  });

  it("holds 1.0 to an identifier of the Information Model and a URI with a scheme, which 1.1 reads more loosely", () => {
    const loose = (change: (pkg: Record<string, any>) => void) => {
      const pkg: Record<string, any> = copyOf(minimalPackage());
      change(pkg);
      const hasError = (version: "1.0" | "1.1") =>
        validatePackage(pkg, { version }).some(({ severity }) => severity === "error");
      return [!hasError("1.0"), !hasError("1.1")];
    };
    expect(
      loose((pkg) => {
        pkg.CFDocument.identifier = id(10).toUpperCase();
      }),
    ).toStrictEqual([false, true]);
    expect(
      loose((pkg) => {
        pkg.CFDocument.identifier = "00000000-0000-7000-8000-000000000001";
      }),
    ).toStrictEqual([false, true]);
    expect(
      loose((pkg) => {
        pkg.CFDocument.uri = "documents/1";
      }),
    ).toStrictEqual([false, true]);
    expect(
      loose((pkg) => {
        pkg.CFDocument.officialSourceURL = "standards.pdf";
      }),
    ).toStrictEqual([false, true]);
    expect(
      loose((pkg) => {
        pkg.CFDocument.uri = "http://[";
      }),
    ).toStrictEqual([false, true]);
    expect(
      loose((pkg) => {
        pkg.CFDocument.uri = "https://case.example.edu/ims/case/v1p0/CFDocuments/1";
      }),
    ).toStrictEqual([true, true]);
  });

  it("names the path, the rule and the severity of each finding", () => {
    expect(
      found((pkg) => {
        delete pkg.CFDocument.title;
        pkg.CFDocument.creator = 5;
        pkg.CFDocument.lastChangeDateTime = "2024-06-13";
        pkg.CFItems[1].unknownProperty = true;
        pkg.CFItems[2].identifier = "not-a-uuid";
        pkg.CFAssociations[0].sequenceNumber = 1.5;
        pkg.CFAssociations[1].associationType = "isParentOf";
        pkg.CFDefinitions.CFSubjects = "none";
        pkg.CFRubrics[0].CFRubricCriteria[0].weight = Number.NaN;
      }),
    ).toStrictEqual([
      { path: "CFDocument.creator", rule: "wrong-type", severity: "error" },
      { path: "CFDocument.title", rule: "missing-property", severity: "error" },
      { path: "CFDocument.lastChangeDateTime", rule: "invalid-format", severity: "error" },
      { path: "CFItems[1].unknownProperty", rule: "unknown-property", severity: "error" },
      { path: "CFItems[2].identifier", rule: "invalid-format", severity: "error" },
      { path: "CFAssociations[0].sequenceNumber", rule: "wrong-type", severity: "error" },
      { path: "CFAssociations[1].associationType", rule: "invalid-value", severity: "error" },
      { path: "CFDefinitions.CFSubjects", rule: "wrong-type", severity: "error" },
      { path: "CFRubrics[0].CFRubricCriteria[0].weight", rule: "wrong-type", severity: "error" },
    ]);
  });

  it("writes a sentence that reads after the path and does not hold it", () => {
    const issues = validatePackage({ ...minimalPackage(), CFItems: [{ identifier: "x" }] });
    expect(issues.map(({ path, message }) => `${path}: ${message}`)).toStrictEqual([
      'CFItems[0].identifier: expected a UUID as 8-4-4-4-12 hexadecimal digits, found "x".',
      'CFItems[0].fullStatement: missing the property "fullStatement".',
      'CFItems[0].uri: missing the property "uri".',
      'CFItems[0].lastChangeDateTime: missing the property "lastChangeDateTime".',
    ]);
    for (const { path, message } of issues) expect(message).not.toContain(path);
  });

  it.each([null, "package", 5, true, []])("gives one finding for %j, which is not an object", (value) => {
    expect(summary(validatePackage(value))).toStrictEqual([{ path: "", rule: "wrong-type", severity: "error" }]);
  });

  it.each([
    [
      "an item that is an array",
      (pkg: Record<string, any>) => {
        pkg.CFItems = [[]];
      },
      "CFItems[0]",
    ],
    [
      "a list that is an object",
      (pkg: Record<string, any>) => {
        pkg.CFItems = {};
      },
      "CFItems",
    ],
    [
      "a link that is a string",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].licenseURI = "x";
      },
      "CFItems[0].licenseURI",
    ],
    [
      "a definition that is null",
      (pkg: Record<string, any>) => {
        pkg.CFDefinitions = null;
      },
      "CFDefinitions",
    ],
  ])("finds %s", (_name, change, path) => {
    expect(found(change).map((finding) => finding.path)).toContain(path);
  });

  it.each([
    ["2024-06-13T18:46:03+00:00", true],
    ["2024-06-13T18:46:03Z", true],
    ["2024-06-13t18:46:03z", true],
    ["2024-06-13T18:46:03.123456-08:30", true],
    ["2024-06-13T23:59:60Z", true],
    ["2024-02-29T00:00:00Z", true],
    ["2023-02-29T00:00:00Z", false],
    ["2024-04-31T00:00:00Z", false],
    ["2024-13-01T00:00:00Z", false],
    ["2024-06-13T18:46:03", false],
    ["2024-06-13", false],
    ["2024-06-13T24:00:00Z", false],
    ["2024-06-13T18:60:00Z", false],
    ["2024-06-13T18:00:60Z", false],
    ["2024-06-13T18:46:03+24:00", false],
    ["2024-06-13T18:46:03+00:60", false],
    ["2024-06-13 18:46:03Z", false],
    ["2024-06-13T18:46:03+0000", false],
    ["2024-06-13T18:46:03+00", false],
    ["2024-6-13T18:46:03Z", false],
    ["", false],
  ])("reads the time %j as a date and time of RFC 3339: %s", (time, valid) => {
    expect(
      found((pkg) => {
        pkg.CFDocument.lastChangeDateTime = time;
      }).length === 0,
    ).toBe(valid);
  });

  it.each([
    ["2024-06-13", true],
    ["2024-02-29", true],
    ["2000-02-29", true],
    ["1900-02-29", false],
    ["2024-02-30", false],
    ["2024-00-10", false],
    ["2024-06-00", false],
    ["2024-06-13T00:00:00Z", false],
    ["13/06/2024", false],
  ])("reads the date %j as a date of RFC 3339: %s", (date, valid) => {
    expect(
      found((pkg) => {
        pkg.CFDocument.statusStartDate = date;
      }).length === 0,
    ).toBe(valid);
  });

  it("accepts an identifier of either case in 1.1, and warns of one that the Information Model does not give", () => {
    const pkg = {
      ...minimalPackage(),
      CFItems: [
        { identifier: id(10).toUpperCase(), fullStatement: "s", uri: "u", lastChangeDateTime: "2024-06-13T18:46:03Z" },
      ],
    };
    expect(summary(validatePackage(pkg))).toStrictEqual([
      { path: "CFItems[0].identifier", rule: "identifier-form", severity: "warning" },
      { path: "CFItems[0]", rule: "item-outside-tree", severity: "warning" },
    ]);
    expect(readPackage(pkg)).toStrictEqual(pkg);
  });

  describe("the extensions", () => {
    const withExtensions = (extensions: unknown) => validatePackage({ ...minimalPackage(), extensions });

    it("must be an object of JSON", () => {
      expect(withExtensions({ a: [1, { b: null }] })).toStrictEqual([]);
      for (const bad of [[], "x", 5, null])
        expect(summary(withExtensions(bad)), JSON.stringify(bad)).toStrictEqual([
          { path: "extensions", rule: "wrong-type", severity: "error" },
        ]);
    });

    it("refuse what JSON cannot hold, and say where", () => {
      const [finding] = withExtensions({ list: [{ at: () => 1 }] });
      expect(finding).toStrictEqual({
        path: "extensions",
        rule: "invalid-value",
        message: "list[0].at is a function, which JSON cannot hold.",
        severity: "error",
      });
    });

    it("are a list of objects in the level of a rubric criterion, as the schema has it", () => {
      const pkg: Record<string, any> = copyOf(fullPackage());
      const levelPath = ["CFRubrics", 0, "CFRubricCriteria", 0, "CFRubricCriterionLevels", 0];
      const level = levelPath.reduce<any>((value, key) => value[key], pkg);
      level.extensions = { band: "top" };
      expect(summary(validatePackage(pkg))).toStrictEqual([
        {
          path: "CFRubrics[0].CFRubricCriteria[0].CFRubricCriterionLevels[0].extensions",
          rule: "wrong-type",
          severity: "error",
        },
      ]);
    });
  });
});

describe("readEntity", () => {
  const entities = fullEntities();

  it.each(ENTITY_KINDS)("reads %s into an equal entity that shares nothing with the input", (kind) => {
    const input = entities[kind];
    const entity = readEntity(kind, input);
    expect(entity).toStrictEqual(input);
    expect(entity).not.toBe(input);
  });

  it.each(ENTITY_KINDS)("does not change %s", (kind) => {
    expect(readEntity(kind, deepFreeze(copyOf(entities[kind])))).toStrictEqual(entities[kind]);
  });

  it.each(ENTITY_KINDS)("refuses %s with a property that CASE does not have, and with nothing", (kind) => {
    expect(() => readEntity(kind, { ...entities[kind], unknownProperty: 1 })).toThrow(
      new DataError(`The ${kind} is invalid at unknownProperty: unexpected property "unknownProperty".`),
    );
    expect(() => readEntity(kind, {})).toThrow(DataError);
  });

  it("reads a set of a version, and refuses what only 1.1 has in 1.0", () => {
    const converted = toCaseVersion(entities.CFItem, "1.0").value;
    expect(readEntity("CFItem", converted, { version: "1.0" })).toStrictEqual(converted);
    expect(() => readEntity("CFItem", entities.CFItem, { version: "1.0" })).toThrow(DataError);
    expect(() => readEntity("CFConceptSet", { CFConcepts: [entities.CFConcept] }, { version: "1.0" })).toThrow(
      DataError,
    );
  });

  it("refuses an error of the rules of an entity, such as an identifier that two members of a set share", () => {
    const concept = entities.CFConcept;
    expect(() => readEntity("CFConceptSet", { CFConcepts: [concept, { ...concept }] })).toThrow(
      new DataError(
        `The CFConceptSet is invalid at CFConcepts[1].identifier: the identifier "${id(10)}" is also the identifier at CFConcepts[0].identifier; give each entity an identifier of its own.`,
      ),
    );
  });

  it.each([
    [null, "The kind is invalid: expected "],
    ["CFPackage", 'The kind is invalid: expected "CFDocument"'],
    [5, "The kind is invalid: expected "],
    [{}, "The kind is invalid: expected "],
  ])("refuses the kind %j", (kind, start) => {
    expect(() => readEntity(kind as CaseEntityKind, {})).toThrow(DataError);
    expect(() => readEntity(kind as CaseEntityKind, {})).toThrow(start);
    expect(() => validateEntity(kind as CaseEntityKind, {})).toThrow(start);
  });

  it.each([null, "1.1", { version: "2.0" }, { other: true }])("refuses the options %j", (options) => {
    expect(() => readEntity("CFItem", {}, options as never)).toThrow(DataError);
    expect(() => validateEntity("CFItem", {}, options as never)).toThrow(DataError);
  });
});

describe("validateEntity", () => {
  const entities = fullEntities();

  it.each(ENTITY_KINDS)("finds nothing in %s that is sound", (kind) => {
    expect(validateEntity(kind, entities[kind])).toStrictEqual([]);
  });

  it.each(["CFDocumentSet", "CFAssociationSet", "CFConceptSet", "CFSubjectSet", "CFItemTypeSet"] as const)(
    "finds in a %s that has no member that a set holds at least one",
    (kind) => {
      const entity: Record<string, any> = copyOf(entities[kind]);
      const [list] = Object.keys(entity).filter((name) => name.startsWith("CF") && Array.isArray(entity[name]));
      if (list === undefined) throw new Error("A set has a list.");
      entity[list] = [];
      expect(summary(validateEntity(kind, entity))).toStrictEqual([
        { path: list, rule: "too-few-entries", severity: "error" },
      ]);
    },
  );

  it("finds the identifier that two members of a set share, and the one that the Information Model does not give", () => {
    const concept = entities.CFConcept;
    const issues = validateEntity("CFConceptSet", {
      CFConcepts: [concept, { ...concept, identifier: id(10).toUpperCase() }],
    });
    expect(summary(issues)).toStrictEqual([
      { path: "CFConcepts[1].identifier", rule: "duplicate-identifier", severity: "error" },
      { path: "CFConcepts[1].identifier", rule: "identifier-form", severity: "warning" },
    ]);
  });

  it("finds the identifiers of the criteria and the levels of a rubric, and of the item and associations of a set", () => {
    const rubric = copyOf(entities.CFRubric) as Record<string, any>;
    rubric.CFRubricCriteria[0].CFRubricCriterionLevels[0].identifier = rubric.identifier;
    expect(validateEntity("CFRubric", rubric).map(({ path }) => path)).toStrictEqual([
      "CFRubricCriteria[0].CFRubricCriterionLevels[0].identifier",
    ]);
    const set = copyOf(entities.CFAssociationSet) as Record<string, any>;
    set.CFAssociations[0].identifier = set.CFItem.identifier;
    expect(validateEntity("CFAssociationSet", set).map(({ path }) => path)).toStrictEqual([
      "CFAssociations[0].identifier",
    ]);
  });

  it("reads a status, in which the Information Model has no identifier to check", () => {
    expect(validateEntity("imsx_StatusInfo", { imsx_codeMajor: "success", imsx_severity: "status" })).toStrictEqual([]);
  });
});

describe("readEntity: the type of the result", () => {
  it("is the class of the kind that was asked for", () => {
    const item = readEntity("CFItem", fullEntities().CFItem);
    expect(item.CFDocumentURI.identifier).toBe(fullEntities().CFDocument.identifier);
    const set = readEntity("CFAssociationSet", fullEntities().CFAssociationSet);
    expect(set.CFItem.identifier).toBe(item.identifier);
    expect(readEntity("imsx_StatusInfo", fullEntities().imsx_StatusInfo).imsx_codeMajor).toBe("failure");
  });
});
