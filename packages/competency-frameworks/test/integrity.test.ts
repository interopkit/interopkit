import { describe, expect, it } from "vitest";
import {
  type CasePackage,
  type CFPckgAssociation,
  type CFPckgItem,
  type ReadOptions,
  readPackage,
  validatePackage,
} from "../src/index.js";
import { copyOf, minimalPackage, summary } from "./fixture.js";
import { fullPackage, id, uri } from "./full-package.js";

const TIME = "2024-06-13T18:46:03Z";
/** The number of the first association, above the numbers of the items. */
const ASSOCIATION_BASE = 1_000_000;
/** The number of the first level of a rubric that a test adds, above the numbers of the associations. */
const LEVELS_BASE = 2_000_000;

/** Checks a full package that a test has changed, and returns where and what it found. */
function changed(change: (pkg: Record<string, any>) => void) {
  const pkg: Record<string, any> = copyOf(fullPackage());
  change(pkg);
  return summary(validatePackage(pkg as CasePackage));
}

function item(number: number): CFPckgItem {
  return {
    identifier: id(number),
    fullStatement: `Item ${number}`,
    uri: uri("CFItems", number),
    lastChangeDateTime: TIME,
  };
}

function childOf(number: number, child: number, parent: number): CFPckgAssociation {
  return {
    identifier: id(ASSOCIATION_BASE + number),
    associationType: "isChildOf",
    uri: uri("CFAssociations", ASSOCIATION_BASE + number),
    originNodeURI: {
      title: `Item ${child}`,
      identifier: id(child),
      uri: uri(child === 1 ? "CFDocuments" : "CFItems", child),
    },
    destinationNodeURI: {
      title: `Item ${parent}`,
      identifier: id(parent),
      uri: uri(parent === 1 ? "CFDocuments" : "CFItems", parent),
    },
    lastChangeDateTime: TIME,
  };
}

/** A package of items 2 to `count + 1` whose associations are given. */
function treeOf(count: number, associations: readonly CFPckgAssociation[]): CasePackage {
  return {
    ...minimalPackage(),
    CFItems: Array.from({ length: count }, (_, at) => item(at + 2)),
    CFAssociations: associations,
  };
}

describe("the identifiers of a package", () => {
  it("name one entity each: two items, an item and an association, or two entities of a rubric that share one are errors", () => {
    expect(
      changed((pkg) => {
        pkg.CFItems.push({ ...pkg.CFItems[0] });
      }),
    ).toStrictEqual([{ path: "CFItems[3].identifier", rule: "duplicate-identifier", severity: "error" }]);
    expect(
      changed((pkg) => {
        pkg.CFAssociations.push({ ...pkg.CFAssociations[3], identifier: pkg.CFItems[0].identifier });
      }),
    ).toStrictEqual([{ path: "CFAssociations[6].identifier", rule: "duplicate-identifier", severity: "error" }]);
    expect(
      changed((pkg) => {
        pkg.CFDefinitions.CFSubjects.push({
          ...pkg.CFDefinitions.CFSubjects[0],
          identifier: pkg.CFDocument.identifier,
        });
      }),
    ).toStrictEqual([
      { path: "CFDefinitions.CFSubjects[1].identifier", rule: "duplicate-identifier", severity: "error" },
    ]);
    expect(
      changed((pkg) => {
        pkg.CFRubrics[0].CFRubricCriteria[0].CFRubricCriterionLevels[0].identifier = pkg.CFRubrics[0].identifier;
      }),
    ).toStrictEqual(
      [
        {
          path: "CFRubrics[0].CFRubricCriteria[0].CFRubricCriterionLevels[0].identifier",
          rule: "duplicate-identifier",
          severity: "error",
        },
        {
          path: "CFRubrics[0].CFRubricCriteria[0].CFRubricCriterionLevels[0].rubricCriterionId",
          rule: "reference-mismatch",
          severity: "warning",
        },
      ].slice(0, 1),
    );
  });

  it("are compared as UUIDs, which are the same in either case, and the first is the one that the message names", () => {
    const pkg: CasePackage = {
      ...minimalPackage(),
      CFItems: [{ ...item(10) }, { ...item(11), identifier: id(10).toUpperCase() }],
    };
    const found = validatePackage(pkg).find((finding) => finding.rule === "duplicate-identifier");
    expect(found?.message).toBe(
      `the identifier "${id(10).toUpperCase()}" is also the identifier at CFItems[0].identifier; give each entity an identifier of its own.`,
    );
  });

  it("are all listed for a criterion whose levels are more than a call takes as arguments", () => {
    const count = 150_000;
    const pkg: Record<string, any> = copyOf(fullPackage());
    const criterion = pkg.CFRubrics[0].CFRubricCriteria[0];
    const level = criterion.CFRubricCriterionLevels[0];
    criterion.CFRubricCriterionLevels = Array.from({ length: count }, (_, at) => ({
      ...level,
      identifier: id(LEVELS_BASE + at),
      uri: uri("CFRubricCriterionLevels", LEVELS_BASE + at),
    }));
    expect(summary(validatePackage(pkg as CasePackage))).toStrictEqual([]);
    criterion.CFRubricCriterionLevels.push({ ...level, identifier: id(LEVELS_BASE + count - 1) });
    expect(summary(validatePackage(pkg as CasePackage))).toStrictEqual([
      {
        path: `CFRubrics[0].CFRubricCriteria[0].CFRubricCriterionLevels[${count}].identifier`,
        rule: "duplicate-identifier",
        severity: "error",
      },
    ]);
  });

  it("are warned of when the Information Model does not give their form, and each deviation is one", () => {
    const deviating = (identifier: string) =>
      changed((pkg) => {
        pkg.CFItems.push({ ...item(40), identifier });
      }).filter(({ rule }) => rule === "identifier-form");
    const warning = [{ path: "CFItems[3].identifier", rule: "identifier-form", severity: "warning" }];
    expect(deviating(id(0xa0).toUpperCase())).toStrictEqual(warning);
    expect(deviating("00000000-0000-6000-8000-000000000051")).toStrictEqual(warning);
    expect(deviating("00000000-0000-0000-8000-000000000052")).toStrictEqual(warning);
    expect(deviating("00000000-0000-4000-c000-000000000053")).toStrictEqual(warning);
    expect(deviating("00000000-0000-4000-8000-000000000054")).toStrictEqual([]);
  });
});

describe("the links of a package", () => {
  it.each([
    [
      "the subject of the document",
      "CFDocument.subjectURI[0]",
      (pkg: Record<string, any>) => {
        pkg.CFDocument.subjectURI[0].identifier = id(900);
      },
    ],
    [
      "the license of the document",
      "CFDocument.licenseURI",
      (pkg: Record<string, any>) => {
        pkg.CFDocument.licenseURI.identifier = id(900);
      },
    ],
    [
      "the concept of an item",
      "CFItems[0].conceptKeywordsURI",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].conceptKeywordsURI.identifier = id(900);
      },
    ],
    [
      "the subject of an item",
      "CFItems[0].subjectURI[0]",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].subjectURI[0].identifier = id(900);
      },
    ],
    [
      "the item type of an item",
      "CFItems[0].CFItemTypeURI",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].CFItemTypeURI.identifier = id(900);
      },
    ],
    [
      "the license of an item",
      "CFItems[0].licenseURI",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].licenseURI.identifier = id(900);
      },
    ],
    [
      "the grouping of an association",
      "CFAssociations[0].CFAssociationGroupingURI",
      (pkg: Record<string, any>) => {
        pkg.CFAssociations[0].CFAssociationGroupingURI.identifier = id(900);
      },
    ],
    [
      "the item of a criterion",
      "CFRubrics[0].CFRubricCriteria[0].CFItemURI",
      (pkg: Record<string, any>) => {
        pkg.CFRubrics[0].CFRubricCriteria[0].CFItemURI.identifier = id(900);
      },
    ],
  ])("point to something in the package: %s is not, and the finding is a warning", (_name, path, change) => {
    expect(changed(change)).toStrictEqual([{ path, rule: "unresolved-reference", severity: "warning" }]);
  });

  it("find an entity by its identifier in either case", () => {
    expect(
      changed((pkg) => {
        pkg.CFItems[0].licenseURI.identifier = id(12).toUpperCase();
      }),
    ).toStrictEqual([]);
  });

  it.each([
    [
      "a link",
      "CFItems[0].licenseURI",
      (pkg: Record<string, any>) => {
        pkg.CFItems[0].licenseURI.uri = "https://elsewhere.example/license";
      },
    ],
    [
      "the origin of an association",
      "CFAssociations[1].originNodeURI",
      (pkg: Record<string, any>) => {
        pkg.CFAssociations[1].originNodeURI.uri = "https://elsewhere.example/item";
      },
    ],
    [
      "the destination of an association",
      "CFAssociations[1].destinationNodeURI",
      (pkg: Record<string, any>) => {
        pkg.CFAssociations[1].destinationNodeURI.uri = "https://elsewhere.example/item";
      },
    ],
  ])("have the URI of what they point to in the package: %s that has another does not", (_name, path, change) => {
    expect(changed(change)).toStrictEqual([{ path, rule: "reference-mismatch", severity: "warning" }]);
  });

  it("name the rubric that holds a criterion and the criterion that holds a level", () => {
    expect(
      changed((pkg) => {
        pkg.CFRubrics[0].CFRubricCriteria[0].rubricId = id(900);
      }),
    ).toStrictEqual([
      { path: "CFRubrics[0].CFRubricCriteria[0].rubricId", rule: "reference-mismatch", severity: "warning" },
    ]);
    expect(
      changed((pkg) => {
        pkg.CFRubrics[0].CFRubricCriteria[0].CFRubricCriterionLevels[0].rubricCriterionId = id(900);
      }),
    ).toStrictEqual([
      {
        path: "CFRubrics[0].CFRubricCriteria[0].CFRubricCriterionLevels[0].rubricCriterionId",
        rule: "reference-mismatch",
        severity: "warning",
      },
    ]);
    expect(
      changed((pkg) => {
        pkg.CFRubrics[0].CFRubricCriteria[0].rubricId = pkg.CFRubrics[0].identifier.toUpperCase();
      }),
    ).toStrictEqual([]);
  });

  it("are all unresolved in a package without definitions, and a package without links has no finding", () => {
    expect(
      changed((pkg) => {
        delete pkg.CFDefinitions;
      }).map(({ rule }) => rule),
    ).toStrictEqual(Array(7).fill("unresolved-reference"));
    expect(validatePackage(minimalPackage())).toStrictEqual([]);
  });

  it("leave the associations outside the package alone: one node of the package is enough, none is a warning", () => {
    expect(
      changed((pkg) => {
        pkg.CFAssociations[3].originNodeURI.identifier = id(900);
      }),
    ).toStrictEqual([{ path: "CFAssociations[3]", rule: "association-outside-package", severity: "warning" }]);
    expect(
      changed((pkg) => {
        pkg.CFAssociations[3].destinationNodeURI.identifier = id(2);
        pkg.CFAssociations[3].destinationNodeURI.uri = uri("CFItems", 2);
      }),
    ).toStrictEqual([]);
  });

  it("treat a node that is not of CASE as outside the package, whatever its identifier is", () => {
    expect(
      changed((pkg) => {
        pkg.CFAssociations[1].originNodeURI.targetType = "ext:video";
        pkg.CFAssociations[1].destinationNodeURI.targetType = "ext:video";
      }).filter(({ rule }) => rule === "association-outside-package"),
    ).toStrictEqual([{ path: "CFAssociations[1]", rule: "association-outside-package", severity: "warning" }]);
  });
});

describe("the tree of a package", () => {
  /** The rules of the errors that a package has. */
  const errorRules = (pkg: CasePackage, options?: ReadOptions) =>
    validatePackage(pkg, options)
      .filter(({ severity }) => severity === "error")
      .map(({ rule }) => rule);

  it.each([
    ["an item that is its own parent", [childOf(1, 2, 2)]],
    ["two items that are each other's parents", [childOf(1, 2, 3), childOf(2, 3, 2)]],
    ["three items in a ring", [childOf(1, 2, 3), childOf(2, 3, 4), childOf(3, 4, 2)]],
    ["a ring below the document", [childOf(1, 2, 1), childOf(2, 3, 2), childOf(3, 4, 3), childOf(4, 2, 4)]],
    ["the document that is the child of an item", [childOf(1, 2, 1), childOf(2, 1, 2)]],
  ])("is not a tree when it holds %s: the association that closes the ring is an error", (_name, associations) => {
    const errors = validatePackage(treeOf(3, associations)).filter(({ severity }) => severity === "error");
    expect(errors.map(({ rule }) => rule)).toStrictEqual(["child-of-cycle"]);
    expect(errors[0]?.path).toMatch(/^CFAssociations\[\d+\]$/u);
  });

  it("names the identifiers of the ring in the message, and what to do", () => {
    const [found] = validatePackage(treeOf(3, [childOf(1, 2, 3), childOf(2, 3, 2)]));
    expect(found).toStrictEqual({
      path: "CFAssociations[1]",
      rule: "child-of-cycle",
      severity: "error",
      message: `the isChildOf associations loop through ${id(2)} -> ${id(3)} -> ${id(2)}; a tree has no loop, so remove one of the associations.`,
    });
  });

  it("is a tree when an item has two parents, which makes a diamond and no ring", () => {
    expect(
      validatePackage(
        treeOf(4, [childOf(1, 2, 1), childOf(2, 3, 2), childOf(3, 4, 2), childOf(4, 5, 3), childOf(5, 5, 4)]),
      ),
    ).toStrictEqual([]);
  });

  it("does not follow the associations that are not isChildOf, or that leave the package", () => {
    const peer = (number: number, from: number, to: number): CFPckgAssociation => ({
      ...childOf(number, from, to),
      associationType: "isPeerOf",
    });
    expect(errorRules(treeOf(2, [peer(1, 2, 3), peer(2, 3, 2)]))).toStrictEqual([]);
    expect(validatePackage(treeOf(2, [childOf(1, 2, 900), childOf(2, 900, 901)])).map(({ rule }) => rule)).toContain(
      "association-outside-package",
    );
  });

  it("does not follow isChildOf to a node that is not of CASE, whatever its identifier is", () => {
    const outside = childOf(2, 3, 2);
    const ring = [
      childOf(1, 2, 3),
      { ...outside, destinationNodeURI: { ...outside.destinationNodeURI, targetType: "ext:video" as const } },
    ];
    expect(errorRules(treeOf(3, ring))).toStrictEqual([]);
    expect(errorRules(treeOf(3, [childOf(1, 2, 3), outside]))).toStrictEqual(["child-of-cycle"]);
  });

  it("reads a chain of 20,000 items, and refuses a ring of as many, without exhausting the stack", () => {
    // Deeper than a walk that recursed could go on the default stack of V8, which holds about 10,000 such frames.
    const count = 20_000;
    const chain = Array.from({ length: count - 1 }, (_, at) => childOf(at, at + 2, at + 3));
    expect(validatePackage(treeOf(count, [...chain, childOf(count, count + 1, 1)]))).toStrictEqual([]);
    // The reader counts errors alone, so the warning of each item outside the tree costs nothing here.
    const ring = treeOf(count, [...chain, childOf(count, count + 1, 2)]);
    const named = [2, 3, 4, 5, 6].map((number) => id(number)).join(" -> ");
    expect(() => readPackage(ring)).toThrow(
      new RegExp(
        `^The package is invalid at CFAssociations\\[\\d+\\]: the isChildOf associations loop through ${named} -> ${count - 5} more -> ${id(2)}; a tree has no loop, so remove one of the associations\\.$`,
        "u",
      ),
    );
  });

  it("stops at the limit when thousands of associations each close a loop of thousands of items", () => {
    // Each association from the last item to the first closes the whole chain again: a list of every loop would hold
    // 10,000 times 10,000 identifiers, 3.7 GB for a package of 5 MB.
    const count = 10_000;
    const chain = Array.from({ length: count - 1 }, (_, at) => childOf(at, at + 2, at + 3));
    const closing = Array.from({ length: count }, (_, at) => childOf(count + at, count + 1, 2));
    const pkg = treeOf(count, [...chain, ...closing]);
    const findings = validatePackage(pkg, { maxFindings: 10 });
    expect(findings.map(({ rule }) => rule)).toStrictEqual([
      ...Array.from({ length: 10 }, () => "child-of-cycle"),
      "findings-stopped",
    ]);
    expect(() => readPackage(pkg)).toThrow("At least 999 more errors: the check stopped at its limit");
  });

  it("finds the items of a document of 10,000 children, and those that a child of two parents leaves out", () => {
    const count = 10_000;
    const flat = Array.from({ length: count }, (_, at) => childOf(at, at + 2, 1));
    expect(validatePackage(treeOf(count, flat))).toStrictEqual([]);
    const twoParents = Array.from({ length: count }, (_, at) => childOf(at, 2, at + 3));
    const outside = validatePackage(treeOf(count + 1, twoParents), { maxFindings: 20_000 }).filter(
      ({ rule }) => rule === "item-outside-tree",
    );
    expect(outside).toHaveLength(count + 1);
  });

  describe("the items of the document", () => {
    const outside = (pkg: CasePackage) =>
      validatePackage(pkg)
        .filter(({ rule }) => rule === "item-outside-tree")
        .map(({ path }) => path);

    it("have a chain of isChildOf associations to the document, and an item that has none is a warning", () => {
      expect(outside(treeOf(3, [childOf(1, 2, 1), childOf(2, 3, 2)]))).toStrictEqual(["CFItems[2]"]);
      expect(outside(treeOf(2, []))).toStrictEqual(["CFItems[0]", "CFItems[1]"]);
    });

    it("are in the tree when the chain is long, or when one of two parents leads to the document", () => {
      expect(
        outside(treeOf(4, [childOf(1, 2, 1), childOf(2, 3, 2), childOf(3, 4, 3), childOf(4, 5, 4)])),
      ).toStrictEqual([]);
      expect(
        outside(treeOf(3, [childOf(1, 2, 1), childOf(2, 3, 4), childOf(3, 3, 2), childOf(4, 4, 3)])),
      ).toStrictEqual([]);
    });

    it("are outside the tree when only another type of association, or an item outside the package, joins them to it", () => {
      const peer = { ...childOf(1, 2, 1), associationType: "isPeerOf" as const };
      expect(outside(treeOf(1, [peer]))).toStrictEqual(["CFItems[0]"]);
      expect(outside(treeOf(1, [childOf(1, 2, 900)]))).toStrictEqual(["CFItems[0]"]);
    });

    it("are outside the tree when they only hold each other up in a ring, which is also an error", () => {
      const pkg = treeOf(2, [childOf(1, 2, 3), childOf(2, 3, 2)]);
      expect(outside(pkg)).toStrictEqual(["CFItems[0]", "CFItems[1]"]);
      expect(errorRules(pkg)).toStrictEqual(["child-of-cycle"]);
    });
  });
});

describe("the findings of a package", () => {
  it("hold the errors and the warnings together, with the severity of each", () => {
    const pkg: Record<string, any> = copyOf(fullPackage());
    pkg.CFItems[0].licenseURI.uri = "https://elsewhere.example/license";
    pkg.CFItems.push({ ...pkg.CFItems[0] });
    expect(summary(validatePackage(pkg))).toStrictEqual([
      { path: "CFItems[3].identifier", rule: "duplicate-identifier", severity: "error" },
      { path: "CFItems[0].licenseURI", rule: "reference-mismatch", severity: "warning" },
      { path: "CFItems[3].licenseURI", rule: "reference-mismatch", severity: "warning" },
    ]);
  });

  it("are the warnings alone for a package that is read, which gives no word of them", () => {
    const pkg: Record<string, any> = copyOf(fullPackage());
    pkg.CFItems[0].licenseURI.uri = "https://elsewhere.example/license";
    expect(summary(validatePackage(pkg))).toStrictEqual([
      { path: "CFItems[0].licenseURI", rule: "reference-mismatch", severity: "warning" },
    ]);
    expect(readPackage(pkg)).toStrictEqual(pkg);
  });

  it("do not look for integrity in a package whose shape is wrong, because there is nothing to rely on", () => {
    const pkg: Record<string, any> = copyOf(fullPackage());
    pkg.CFItems[1].identifier = pkg.CFItems[0].identifier;
    pkg.CFDocument.title = 5;
    expect(validatePackage(pkg).map(({ rule }) => rule)).toStrictEqual(["wrong-type"]);
  });
});
