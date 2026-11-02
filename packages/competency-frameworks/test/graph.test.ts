import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import {
  ADOPTION_STATUSES,
  adoptionStatus,
  associationsOf,
  caseEntityUri,
  crosswalk,
  diffPackages,
  type FrameworkNode,
  frameworkTree,
  isNewer,
} from "../src/graph/index.js";
import type { CasePackage, CFPckgItem } from "../src/index.js";
import { copyOf } from "./fixture.js";
import { type AssociationSpec, associationOf, childOf, DOCUMENT, framework, itemOf } from "./framework.js";
import { fullPackage, id } from "./full-package.js";

/** A `targetType` of a node that is not of CASE. */
const VIDEO = "ext:video" as const;

/** Reads the number out of an identifier that `id` made. */
const numberOf = (identifier: string): number => Number.parseInt(identifier.slice(-12), 16);

/** A tree as nested lists of the numbers of its items: `[2, [3, 4]]` is item 2 with the children 3 and 4. */
type Shape = readonly [number, readonly Shape[]];
const shapeOf = (nodes: readonly FrameworkNode[]): Shape[] =>
  nodes.map((node) => [numberOf(node.item.identifier), shapeOf(node.children)]);

const items = (...numbers: number[]) => numbers.map((number) => ({ number }));

/** Input as a host passes it from JSON, never typed as the model. */
const fromJson = <TValue = CasePackage>(value: unknown): TValue =>
  JSON.parse(typeof value === "string" ? value : JSON.stringify(value));

/** The package with other items. */
const withItems = (pkg: CasePackage, replacement: readonly CFPckgItem[]): CasePackage => ({
  ...pkg,
  CFItems: replacement,
});

describe("frameworkTree", () => {
  it("puts the items whose parent is the document at the top, each with its children", () => {
    const pkg = framework(items(2, 3, 4, 5), [childOf(2, 1), childOf(3, 2), childOf(4, 2), childOf(5, 1)]);
    expect(shapeOf(frameworkTree(pkg))).toStrictEqual([
      [
        2,
        [
          [3, []],
          [4, []],
        ],
      ],
      [5, []],
    ]);
  });

  it("returns nothing for a package without items or associations", () => {
    expect(frameworkTree({ CFDocument: framework([]).CFDocument })).toStrictEqual([]);
  });

  it("orders siblings by sequence number, and puts the items without one after those with one", () => {
    const pkg = framework(items(2, 3, 4, 5), [childOf(2, 1), childOf(3, 1, 20), childOf(4, 1, 3), childOf(5, 1, 3)]);
    expect(frameworkTree(pkg).map(({ item }) => numberOf(item.identifier))).toStrictEqual([4, 5, 3, 2]);
  });

  it("orders siblings with one sequence number by code, reading numbers inside a code as numbers", () => {
    const codes = ["RL.5.10", "RL.5.2", "RL.5.1", "RL.4.9", "SL.1.1"];
    const pkg = framework(
      codes.map((code, at) => ({ number: 2 + at, code })),
      codes.map((_, at) => childOf(2 + at, 1, 1)),
    );
    expect(frameworkTree(pkg).map(({ item }) => item.humanCodingScheme)).toStrictEqual([
      "RL.4.9",
      "RL.5.1",
      "RL.5.2",
      "RL.5.10",
      "SL.1.1",
    ]);
  });

  it("puts items with a code before items without one, and keeps the order of the package for equals", () => {
    const pkg = framework(
      [{ number: 2 }, { number: 3, code: "B" }, { number: 4 }, { number: 5, code: "A" }],
      [childOf(2, 1), childOf(3, 1), childOf(4, 1), childOf(5, 1)],
    );
    expect(frameworkTree(pkg).map(({ item }) => numberOf(item.identifier))).toStrictEqual([5, 3, 2, 4]);
  });

  it("places an item once, under the first parent that the walk reaches level by level", () => {
    // 6 is a child of 3 (a grandchild of the document) and of 4 (a child of the document): 4 is the shallower parent.
    const pkg = framework(items(2, 3, 4, 5, 6), [
      childOf(2, 1),
      childOf(3, 2),
      childOf(6, 3),
      childOf(4, 1),
      childOf(6, 4),
      childOf(5, 1),
    ]);
    expect(shapeOf(frameworkTree(pkg))).toStrictEqual([
      [2, [[3, []]]],
      [4, [[6, []]]],
      [5, []],
    ]);
  });

  it("leaves out items that no chain of isChildOf associations leads to the document from, loops included", () => {
    const pkg = framework(items(2, 3, 4, 5, 6), [childOf(2, 1), childOf(3, 4), childOf(4, 3), childOf(6, 5)]);
    expect(shapeOf(frameworkTree(pkg))).toStrictEqual([[2, []]]);
  });

  it("walks a loop that includes an item below the document once", () => {
    const pkg = framework(items(2, 3), [childOf(2, 1), childOf(3, 2), childOf(2, 3)]);
    expect(shapeOf(frameworkTree(pkg))).toStrictEqual([[2, [[3, []]]]]);
  });

  it("ignores associations of other types, nodes outside the package and nodes that are not of CASE", () => {
    const other: AssociationSpec = { type: "isRelatedTo", origin: 3, destination: 1 };
    const pkg = framework(items(2, 3), [childOf(2, 1), other, childOf(3, 99), childOf(98, 2)]);
    const foreign = associationOf(childOf(3, 2), 2000);
    const outsideCase: CasePackage = {
      ...pkg,
      CFAssociations: [
        ...(pkg.CFAssociations ?? []),
        { ...foreign, destinationNodeURI: { ...foreign.destinationNodeURI, targetType: VIDEO } },
      ],
    };
    expect(shapeOf(frameworkTree(outsideCase))).toStrictEqual([[2, []]]);
  });

  it("matches identifiers in either case", () => {
    const pkg = framework(items(2, 3), [childOf(2, 1), childOf(3, 2)]);
    const upper = copyOf(pkg);
    for (const association of upper.CFAssociations ?? []) {
      (association.originNodeURI as { identifier: string }).identifier =
        association.originNodeURI.identifier.toUpperCase();
    }
    expect(shapeOf(frameworkTree(upper))).toStrictEqual([[2, [[3, []]]]]);
  });

  it("returns copies that share nothing with the package, and leaves the package as it was", () => {
    const pkg = deepFreeze(framework(items(2, 3), [childOf(2, 1), childOf(3, 2)]));
    const [top] = frameworkTree(pkg);
    expect(top?.item).toStrictEqual(pkg.CFItems?.[0]);
    expect(top?.item).not.toBe(pkg.CFItems?.[0]);
    expect(Object.isFrozen(top?.item)).toBe(false);
  });

  it("takes the first of two items with one identifier", () => {
    const base = framework(items(2), [childOf(2, 1)]);
    const pkg: CasePackage = {
      ...base,
      CFItems: [...(base.CFItems ?? []), itemOf({ number: 2, statement: "Second" })],
    };
    expect(frameworkTree(pkg).map(({ item }) => item.fullStatement)).toStrictEqual(["Statement 2"]);
  });

  it("builds a chain of twenty thousand levels and a flat list of ten thousand children without overflowing", () => {
    const depth = 20_000;
    const numbers = Array.from({ length: depth }, (_, at) => at + 2);
    const chain = framework(
      items(...numbers),
      numbers.map((number) => childOf(number, number - 1)),
    );
    let node: FrameworkNode | undefined = frameworkTree(chain)[0];
    let levels = 0;
    for (; node !== undefined; node = node.children[0]) levels += 1;
    expect(levels).toBe(depth);
    const flatNumbers = Array.from({ length: 10_000 }, (_, at) => at + 2);
    const flat = framework(
      items(...flatNumbers),
      flatNumbers.map((number) => childOf(number, 1)),
    );
    expect(frameworkTree(flat)).toHaveLength(10_000);
  });

  it("refuses a value that is not a package, naming the first missing property", () => {
    expect(() => frameworkTree(JSON.parse("null"))).toThrow(DataError);
    expect(() => frameworkTree(fromJson({}))).toThrow('The package is invalid: missing the property "CFDocument".');
    expect(() => frameworkTree(fromJson({ CFDocument: { identifier: "a", uri: "b" }, CFItems: "x" }))).toThrow(
      'The package is invalid at CFItems: expected an array, found "x".',
    );
    const broken = copyOf(framework(items(2), [childOf(2, 1)]));
    (broken.CFAssociations?.[0] as unknown as { associationType: number }).associationType = 5;
    expect(() => frameworkTree(broken)).toThrow("The package is invalid at CFAssociations[0].associationType");
  });

  it("refuses a package that holds something that cannot be copied", () => {
    const pkg = framework(items(2), [childOf(2, 1)]);
    const withFunction: CasePackage = {
      ...pkg,
      CFItems: [{ ...itemOf({ number: 2 }), extensions: { run: () => 1 } as never }],
    };
    expect(() => frameworkTree(withFunction)).toThrow("must be plain data that can be copied: it holds a function");
  });
});

/** The items of a random framework with parents, extra associations and codes, as a package. */
const randomFramework = fc
  .integer({ min: 1, max: 25 })
  .chain((count) =>
    fc.record({
      parents: fc.tuple(...Array.from({ length: count }, (_, at) => fc.integer({ min: 0, max: at }))),
      extras: fc.array(fc.tuple(fc.integer({ min: 1, max: count + 1 }), fc.integer({ min: 1, max: count + 1 })), {
        maxLength: 12,
      }),
      sequences: fc.array(fc.option(fc.integer({ min: 0, max: 4 }), { nil: undefined }), {
        minLength: count,
        maxLength: count,
      }),
      codes: fc.array(
        fc.option(
          fc
            .array(fc.oneof(fc.constantFrom("A", "B"), fc.integer({ min: 1, max: 120 }).map(String)), {
              minLength: 1,
              maxLength: 3,
            })
            .map((parts) => parts.join(".")),
          { nil: undefined },
        ),
        { minLength: count, maxLength: count },
      ),
    }),
  )
  .map(({ parents, extras, sequences, codes }) =>
    framework(
      parents.map((_, at) => ({ number: at + 2, ...(codes[at] === undefined ? {} : { code: codes[at] }) })),
      [
        ...parents.map((parent, at) => childOf(at + 2, parent + 1, sequences[at])),
        ...extras.filter(([child]) => child > 1).map(([child, parent]) => childOf(child, parent)),
      ],
    ),
  );

/** Walks the associations from the document the way a reader of the specification would, and lists the items it reaches. */
function reachableItems(pkg: CasePackage): Set<number> {
  const reached = new Set<number>([DOCUMENT]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const { associationType, originNodeURI, destinationNodeURI } of pkg.CFAssociations ?? []) {
      const [child, parent] = [numberOf(originNodeURI.identifier), numberOf(destinationNodeURI.identifier)];
      if (associationType === "isChildOf" && reached.has(parent) && !reached.has(child)) {
        reached.add(child);
        grew = true;
      }
    }
  }
  reached.delete(DOCUMENT);
  return reached;
}

/** Compares two codes as a person reads them: runs of digits as numbers, the rest by character, a full stop before a digit. */
function naturalCompare(first: string, second: string): number {
  const [a, b] = [first.match(/\d+|\D/gu) ?? [], second.match(/\d+|\D/gu) ?? []];
  for (let at = 0; at < Math.min(a.length, b.length); at += 1) {
    const [x, y] = [a[at] ?? "", b[at] ?? ""];
    if (/\d/u.test(x) && /\d/u.test(y)) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

describe("frameworkTree on random frameworks", () => {
  const RUNS = { seed: 20_241_103, numRuns: 200 };

  it("holds exactly the items that the document leads to, each once", () => {
    fc.assert(
      fc.property(randomFramework, (pkg) => {
        const listed: number[] = [];
        const visit = (nodes: readonly FrameworkNode[]) => {
          for (const node of nodes) {
            listed.push(numberOf(node.item.identifier));
            visit(node.children);
          }
        };
        visit(frameworkTree(pkg));
        expect(new Set(listed).size).toBe(listed.length);
        expect(new Set(listed)).toStrictEqual(reachableItems(pkg));
      }),
      RUNS,
    );
  });

  it("puts every item under a parent that an isChildOf association names, in order", () => {
    fc.assert(
      fc.property(randomFramework, (pkg) => {
        const edges = (pkg.CFAssociations ?? []).map((association) => ({
          child: numberOf(association.originNodeURI.identifier),
          parent: numberOf(association.destinationNodeURI.identifier),
          sequence: association.sequenceNumber,
        }));
        const check = (parent: number, nodes: readonly FrameworkNode[]) => {
          const keys = nodes.map((node) => {
            const child = numberOf(node.item.identifier);
            const own = edges.filter((edge) => edge.child === child && edge.parent === parent);
            expect(own.length).toBeGreaterThan(0);
            check(child, node.children);
            return {
              sequence: Math.min(...own.map((edge) => edge.sequence ?? Number.POSITIVE_INFINITY)),
              code: node.item.humanCodingScheme,
            };
          });
          for (const [at, key] of keys.slice(1).entries()) {
            const before = keys[at];
            if (before === undefined) continue;
            expect(before.sequence).toBeLessThanOrEqual(key.sequence);
            if (before.sequence === key.sequence && before.code !== undefined && key.code !== undefined) {
              expect(naturalCompare(before.code, key.code)).toBeLessThanOrEqual(0);
            }
          }
        };
        check(DOCUMENT, frameworkTree(pkg));
      }),
      RUNS,
    );
  });
});

describe("a package without items or associations", () => {
  const bare: CasePackage = { CFDocument: framework([]).CFDocument };

  it("has no tree, no associations, no links and no difference", () => {
    expect(frameworkTree(bare)).toStrictEqual([]);
    expect(associationsOf(bare, id(2))).toStrictEqual({ origin: [], destination: [] });
    expect(crosswalk(bare, bare)).toStrictEqual([]);
    expect(diffPackages(bare, bare)).toStrictEqual({ added: [], removed: [], changed: [], replaced: [] });
  });
});

describe("associationsOf", () => {
  const pkg = framework(items(2, 3, 4), [
    childOf(2, 1),
    childOf(3, 2),
    { type: "isRelatedTo", origin: 4, destination: 2 },
    { type: "precedes", origin: 2, destination: 4 },
  ]);
  const typesOf = (list: readonly { readonly associationType: string }[]) => list.map((a) => a.associationType);

  it("lists the associations that start at a node and those that end at it, in the order of the package", () => {
    const found = associationsOf(pkg, id(2));
    expect(typesOf(found.origin)).toStrictEqual(["isChildOf", "precedes"]);
    expect(typesOf(found.destination)).toStrictEqual(["isChildOf", "isRelatedTo"]);
  });

  it("finds the associations of the document", () => {
    const found = associationsOf(pkg, id(DOCUMENT));
    expect(found.origin).toStrictEqual([]);
    expect(typesOf(found.destination)).toStrictEqual(["isChildOf"]);
  });

  it("matches the identifier in either case", () => {
    expect(associationsOf(pkg, id(2).toUpperCase())).toStrictEqual(associationsOf(pkg, id(2)));
  });

  it("returns empty lists for a node that the package has nothing about", () => {
    expect(associationsOf(pkg, id(77))).toStrictEqual({ origin: [], destination: [] });
  });

  it("does not match a node that is not of CASE", () => {
    const foreign = associationOf({ type: "isRelatedTo", origin: 3, destination: 5 }, 2000);
    const withForeign: CasePackage = {
      ...pkg,
      CFAssociations: [{ ...foreign, destinationNodeURI: { ...foreign.destinationNodeURI, targetType: VIDEO } }],
    };
    expect(associationsOf(withForeign, id(5))).toStrictEqual({ origin: [], destination: [] });
    expect(typesOf(associationsOf(withForeign, id(3)).origin)).toStrictEqual(["isRelatedTo"]);
  });

  it("returns copies that share nothing with the package", () => {
    const frozen = deepFreeze(copyOf(pkg));
    const [first] = associationsOf(frozen, id(2)).origin;
    expect(first).toStrictEqual(frozen.CFAssociations?.[0]);
    expect(first).not.toBe(frozen.CFAssociations?.[0]);
  });

  it("refuses an identifier that is not a string, and a package that is not one", () => {
    expect(() => associationsOf(pkg, JSON.parse("5"))).toThrow("The identifier must be a non-empty string, found 5.");
    expect(() => associationsOf(pkg, "")).toThrow(DataError);
    expect(() => associationsOf(JSON.parse("[]"), id(2))).toThrow(DataError);
  });
});

/** Another framework, whose items are numbered from 100 and whose document is 100. */
const OTHER = 100;
const otherFramework = (associations: readonly AssociationSpec[] = []) => {
  const base = framework([], []);
  return {
    ...base,
    CFDocument: { ...base.CFDocument, identifier: id(OTHER) },
    CFItems: [itemOf({ number: 101 }), itemOf({ number: 102 })],
    CFAssociations: associations.map((spec, at) => associationOf(spec, 3000 + at)),
  } satisfies CasePackage;
};

describe("crosswalk", () => {
  const mine = framework(items(2, 3));
  const match = { type: "exactMatchOf", origin: 2, destination: 101 } as const;

  it("links an item of the first package to an item of the second by the associations of the first", () => {
    const from = { ...mine, CFAssociations: [associationOf(match, 1000)] };
    const links = crosswalk(from, otherFramework());
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ type: "exactMatchOf" });
    expect(links[0]?.from).toBe(mine.CFItems?.[0]?.uri);
    expect(links[0]?.to).toBe(otherFramework().CFItems[0]?.uri);
    expect(links[0]?.association).toStrictEqual(from.CFAssociations[0]);
  });

  it("reads the associations of the second package, whichever end is the origin", () => {
    const to = otherFramework([{ type: "isRelatedTo", origin: 102, destination: 3 }]);
    const links = crosswalk(mine, to);
    expect(links.map(({ from, to: target }) => [from, target])).toStrictEqual([
      [mine.CFItems?.[1]?.uri, to.CFItems[1]?.uri],
    ]);
  });

  it("gives one link for an association that both packages hold, and one for each of two associations", () => {
    const both = associationOf(match, 1000);
    const twin = associationOf({ ...match, number: 1001 }, 1001);
    const from = { ...mine, CFAssociations: [both] };
    const to = { ...otherFramework(), CFAssociations: [both, twin] };
    expect(crosswalk(from, to).map(({ association }) => association.identifier)).toStrictEqual([
      both.identifier,
      twin.identifier,
    ]);
  });

  it("keeps the order of the associations, those of the first package first", () => {
    const from = {
      ...mine,
      CFAssociations: [associationOf({ type: "isRelatedTo", origin: 3, destination: 102 }, 1000)],
    };
    const to = otherFramework([match]);
    expect(crosswalk(from, to).map(({ type }) => type)).toStrictEqual(["isRelatedTo", "exactMatchOf"]);
  });

  it("links only the types that mean the same, and the types that the caller names", () => {
    const types = [
      "exactMatchOf",
      "isRelatedTo",
      "isPeerOf",
      "isTranslationOf",
      "precedes",
      "isChildOf",
      "ext:close",
    ] as const;
    const from = {
      ...mine,
      CFAssociations: types.map((type, at) => associationOf({ type, origin: 2, destination: 101 }, 1000 + at)),
    };
    expect(crosswalk(from, otherFramework()).map(({ type }) => type)).toStrictEqual(types.slice(0, 4));
    expect(
      crosswalk(from, otherFramework(), { types: ["precedes", "ext:close"] }).map(({ type }) => type),
    ).toStrictEqual(["precedes", "ext:close"]);
    expect(crosswalk(from, otherFramework(), { types: [] })).toStrictEqual([]);
    expect(crosswalk(from, otherFramework(), {})).toHaveLength(4);
  });

  it("leaves out links to a document, links inside one package and links to items that neither package holds", () => {
    const from = {
      ...mine,
      CFAssociations: [
        associationOf({ type: "exactMatchOf", origin: 2, destination: OTHER }, 1000),
        associationOf({ type: "exactMatchOf", origin: 2, destination: 3 }, 1001),
        associationOf({ type: "exactMatchOf", origin: 2, destination: 555 }, 1002),
      ],
    };
    expect(crosswalk(from, otherFramework())).toStrictEqual([]);
  });

  it("matches identifiers in either case and leaves out nodes that are not of CASE", () => {
    const association = associationOf(match, 1000);
    const upper = {
      ...association,
      destinationNodeURI: { ...association.destinationNodeURI, identifier: id(101).toUpperCase() },
    };
    const foreign = {
      ...association,
      identifier: id(1001),
      destinationNodeURI: { ...association.destinationNodeURI, targetType: VIDEO },
    };
    expect(crosswalk({ ...mine, CFAssociations: [upper, foreign] }, otherFramework())).toHaveLength(1);
  });

  it("returns copies that share nothing with the packages", () => {
    const from = deepFreeze({ ...copyOf(mine), CFAssociations: [associationOf(match, 1000)] });
    const [link] = crosswalk(from, deepFreeze(otherFramework()));
    expect(link?.association).not.toBe(from.CFAssociations[0]);
  });

  it("refuses options that are not valid", () => {
    expect(() => crosswalk(mine, otherFramework(), JSON.parse("5"))).toThrow(
      "The options is invalid: expected an object, found 5.",
    );
    expect(() => crosswalk(mine, otherFramework(), JSON.parse('{"types":"isRelatedTo"}'))).toThrow(
      "The options is invalid at types: expected an array",
    );
    expect(() => crosswalk(mine, otherFramework(), JSON.parse('{"types":[1]}'))).toThrow(
      "The options is invalid at types[0]",
    );
    expect(() => crosswalk(mine, otherFramework(), JSON.parse('{"type":["isRelatedTo"]}'))).toThrow(
      'The options is invalid: unexpected property "type".',
    );
    expect(() => crosswalk(JSON.parse("null"), otherFramework())).toThrow("The package from is invalid");
    expect(() => crosswalk(mine, JSON.parse("{}"))).toThrow("The package to is invalid");
  });
});

describe("diffPackages", () => {
  const before = framework([{ number: 2, code: "A" }, { number: 3 }, { number: 4 }], [childOf(2, 1)]);

  it("lists the items that only the later package holds and those that only the earlier holds", () => {
    const after = framework([{ number: 2, code: "A" }, { number: 4 }, { number: 5 }], [childOf(2, 1)]);
    const diff = diffPackages(before, after);
    expect(diff.added.map(({ identifier }) => numberOf(identifier))).toStrictEqual([5]);
    expect(diff.removed.map(({ identifier }) => numberOf(identifier))).toStrictEqual([3]);
    expect(diff.changed).toStrictEqual([]);
  });

  it("lists an item as changed when any property differs, extensions and the time of change included", () => {
    const after = framework(
      [
        { number: 2, code: "A", statement: "Reworded" },
        { number: 3, changed: "2025-01-01T00:00:00+00:00" },
        { number: 4 },
      ],
      [childOf(2, 1)],
    );
    const withExtension = withItems(
      after,
      (after.CFItems ?? []).map((item) =>
        item.identifier === id(4) ? { ...item, extensions: { sourceItemIdentifier: "x" } } : item,
      ),
    );
    const diff = diffPackages(before, withExtension);
    expect(diff.changed.map(({ after: changed }) => numberOf(changed.identifier))).toStrictEqual([2, 3, 4]);
    expect(diff.changed[0]?.before.fullStatement).toBe("Statement 2");
    expect(diff.changed[0]?.after.fullStatement).toBe("Reworded");
  });

  it("finds no difference in the order of the keys of an item, or the case of its identifier", () => {
    const reversed = (before.CFItems ?? []).map((item) =>
      fromJson<CFPckgItem>(
        JSON.stringify(
          Object.fromEntries(Object.entries({ ...item, identifier: item.identifier.toUpperCase() }).reverse()),
        ),
      ),
    );
    expect(diffPackages(before, withItems(before, reversed))).toStrictEqual({
      added: [],
      removed: [],
      changed: [],
      replaced: [],
    });
  });

  it("finds an item changed in a nested extension and in a list", () => {
    const only = (extra: unknown) =>
      withItems(before, [{ ...itemOf({ number: 2 }), ...fromJson<object>(JSON.stringify(extra)) }]);
    const base = only({ educationLevel: ["03", "04"], extensions: { nested: { list: [1, { a: 1 }] } } });
    const changedList = only({ educationLevel: ["03", "05"], extensions: { nested: { list: [1, { a: 1 }] } } });
    const changedNested = only({ educationLevel: ["03", "04"], extensions: { nested: { list: [1, { a: 2 }] } } });
    const asObject = only({ educationLevel: { 0: "03", 1: "04" }, extensions: { nested: { list: [1, { a: 1 }] } } });
    const otherKey = only({ educationLevel: ["03", "04"], extensions: { nested: { list: [1, { b: 1 }] } } });
    expect(diffPackages(base, changedList).changed).toHaveLength(1);
    expect(diffPackages(base, changedNested).changed).toHaveLength(1);
    expect(diffPackages(base, asObject).changed).toHaveLength(1);
    expect(diffPackages(base, otherKey).changed).toHaveLength(1);
    expect(diffPackages(base, copyOf(base)).changed).toHaveLength(0);
  });

  it("lists the replacedBy associations that only the later package holds, by the uri of the items", () => {
    const retire = { type: "replacedBy", origin: 3, destination: 5 } as const;
    const after = framework(
      [{ number: 2, code: "A" }, { number: 3 }, { number: 4 }, { number: 5 }],
      [childOf(2, 1), retire, { type: "isRelatedTo", origin: 4, destination: 5 }],
    );
    const diff = diffPackages(before, after);
    expect(diff.replaced).toStrictEqual([{ item: after.CFItems?.[1]?.uri, by: after.CFItems?.[3]?.uri }]);
    expect(diffPackages(after, after).replaced).toStrictEqual([]);
  });

  it("gives the uri of the node for an item that neither package holds", () => {
    const retire = associationOf({ type: "replacedBy", origin: 3, destination: 900 }, 1500);
    const after = { ...before, CFAssociations: [retire] };
    expect(diffPackages(before, after).replaced).toStrictEqual([
      { item: before.CFItems?.[1]?.uri, by: retire.destinationNodeURI.uri },
    ]);
  });

  it("leaves out a replacedBy association with a node that is not of CASE", () => {
    const retire = associationOf({ type: "replacedBy", origin: 3, destination: 5 }, 1500);
    const foreign = { ...retire, originNodeURI: { ...retire.originNodeURI, targetType: VIDEO } };
    expect(diffPackages(before, { ...before, CFAssociations: [foreign] }).replaced).toStrictEqual([]);
  });

  it("returns copies that share nothing with the packages", () => {
    const after = deepFreeze(framework([{ number: 2, code: "A", statement: "Reworded" }, { number: 9 }]));
    const frozen = deepFreeze(copyOf(before));
    const diff = diffPackages(frozen, after);
    expect(diff.added[0]).not.toBe(after.CFItems?.[1]);
    expect(diff.removed[0]).not.toBe(frozen.CFItems?.[1]);
    expect(diff.changed[0]?.before).not.toBe(frozen.CFItems?.[0]);
    expect(diff.changed[0]?.after).not.toBe(after.CFItems?.[0]);
  });

  it("refuses a value that is not a package", () => {
    expect(() => diffPackages(JSON.parse("1"), before)).toThrow("The package before is invalid");
    expect(() => diffPackages(before, JSON.parse("{}"))).toThrow("The package after is invalid");
  });

  it("finds nothing between a package and itself, and the added and removed swap when the packages do", () => {
    fc.assert(
      fc.property(randomFramework, randomFramework, (first, second) => {
        expect(diffPackages(first, first)).toStrictEqual({ added: [], removed: [], changed: [], replaced: [] });
        const forward = diffPackages(first, second);
        const backward = diffPackages(second, first);
        expect(forward.added).toStrictEqual(backward.removed);
        expect(forward.removed).toStrictEqual(backward.added);
        expect(forward.changed.map((pair) => pair.before)).toStrictEqual(
          backward.changed
            .map((pair) => pair.after)
            .sort(
              (a, b) =>
                forward.changed.findIndex((pair) => pair.before.identifier === a.identifier) -
                forward.changed.findIndex((pair) => pair.before.identifier === b.identifier),
            ),
        );
      }),
      { seed: 20_241_104, numRuns: 100 },
    );
  });
});

describe("isNewer", () => {
  const at = (lastChangeDateTime: string) => ({ lastChangeDateTime });

  it("tells whether the current entity was changed after the cached one", () => {
    expect(isNewer(at("2024-06-13T18:46:03+00:00"), at("2024-06-13T18:46:04+00:00"))).toBe(true);
    expect(isNewer(at("2024-06-13T18:46:04+00:00"), at("2024-06-13T18:46:03+00:00"))).toBe(false);
  });

  it("compares instants and not text, across offsets", () => {
    expect(isNewer(at("2024-06-13T18:46:03+00:00"), at("2024-06-13T20:46:03+02:00"))).toBe(false);
    expect(isNewer(at("2024-06-13T18:46:03+00:00"), at("2024-06-13T20:46:04+02:00"))).toBe(true);
    expect(isNewer(at("2024-06-13T19:00:00+01:00"), at("2024-06-13T18:30:00Z"))).toBe(true);
  });

  it("says no for an entity changed at the same instant", () => {
    expect(isNewer(at("2024-06-13T18:46:03Z"), at("2024-06-13T18:46:03+00:00"))).toBe(false);
  });

  it("accepts any entity that has a time of change", () => {
    const pkg = fullPackage();
    expect(isNewer(pkg.CFDocument, { ...pkg.CFDocument, lastChangeDateTime: "2030-01-01T00:00:00Z" })).toBe(true);
  });

  it("refuses a time that is not an RFC 3339 date and time with an offset, and a value that has none", () => {
    expect(() => isNewer(at("2024-06-13"), at("2024-06-13T18:46:03Z"))).toThrow(
      'The lastChangeDateTime of the cached entity must be a date and time of RFC 3339 with an offset, found "2024-06-13".',
    );
    expect(() => isNewer(at("2024-06-13T18:46:03Z"), JSON.parse('{"lastChangeDateTime":5}'))).toThrow(
      "The lastChangeDateTime of the current entity must be a date and time of RFC 3339 with an offset, found 5.",
    );
    expect(() => isNewer(JSON.parse("null"), at("2024-06-13T18:46:03Z"))).toThrow(
      "The cached entity must be an object, found null.",
    );
    expect(() => isNewer(at("2024-06-13T18:46:03Z"), JSON.parse("[]"))).toThrow(
      "The current entity must be an object, found an array.",
    );
  });
});

describe("adoptionStatus", () => {
  const of = (status?: string) => adoptionStatus(status === undefined ? {} : { adoptionStatus: status });

  it("reads each status that the working group recommends as itself", () => {
    expect(ADOPTION_STATUSES.map((status) => of(status))).toStrictEqual([...ADOPTION_STATUSES]);
  });

  it("reads Adopted as Implemented and Deprecated as Retired", () => {
    expect(of("Adopted")).toBe("Implemented");
    expect(of("Deprecated")).toBe("Retired");
  });

  it("ignores case", () => {
    expect(of("pending implementation")).toBe("Pending Implementation");
    expect(of("ADOPTED")).toBe("Implemented");
  });

  it("gives nothing for a document that states none, and for a term outside the vocabulary", () => {
    expect(of()).toBeUndefined();
    expect(of("Published")).toBeUndefined();
    expect(of("")).toBeUndefined();
  });

  it("reads the document of a package", () => {
    expect(adoptionStatus({ ...fullPackage().CFDocument, adoptionStatus: "Adopted" })).toBe("Implemented");
  });

  it("refuses a value that is not a document, and a status that is not a string", () => {
    expect(() => adoptionStatus(JSON.parse("null"))).toThrow("The document must be an object, found null.");
    expect(() => adoptionStatus(JSON.parse('{"adoptionStatus":3}'))).toThrow(
      "The adoptionStatus of the document must be a string, found 3.",
    );
  });
});

describe("caseEntityUri", () => {
  const BASE = "https://standards.example.org";

  it("builds the address of the endpoint of each class that a provider serves by identifier", () => {
    const kinds = [
      "CFDocument",
      "CFItem",
      "CFAssociation",
      "CFAssociationGrouping",
      "CFConcept",
      "CFSubject",
      "CFLicense",
      "CFItemType",
      "CFRubric",
    ] as const;
    for (const kind of kinds) {
      expect(caseEntityUri(BASE, kind, id(2))).toBe(`${BASE}/ims/case/v1p1/${kind}s/${id(2)}`);
    }
  });

  it("builds the path of 1.0 when asked", () => {
    expect(caseEntityUri(BASE, "CFItem", id(2), { version: "1.0" })).toBe(`${BASE}/ims/case/v1p0/CFItems/${id(2)}`);
  });

  it("keeps the path of the base and drops its trailing slash", () => {
    expect(caseEntityUri(`${BASE}/standards/`, "CFItem", id(2))).toBe(
      `${BASE}/standards/ims/case/v1p1/CFItems/${id(2)}`,
    );
  });

  it("encodes an identifier that is not a UUID so that it stays one path segment", () => {
    expect(caseEntityUri(BASE, "CFItem", "a/b?c#d e")).toBe(`${BASE}/ims/case/v1p1/CFItems/a%2Fb%3Fc%23d%20e`);
  });

  it("refuses a base that is not an https address without credentials, query or fragment", () => {
    expect(() => caseEntityUri("http://standards.example.org", "CFItem", id(2))).toThrow(
      "The base URL must be an absolute https URL",
    );
    expect(() => caseEntityUri(`${BASE}?x=1`, "CFItem", id(2))).toThrow("must have no credentials, query or fragment");
    expect(() => caseEntityUri("https://user:secret@standards.example.org", "CFItem", id(2))).toThrow(
      "must have no credentials, query or fragment",
    );
    expect(() => caseEntityUri(`${BASE}#top`, "CFItem", id(2))).toThrow("must have no credentials, query or fragment");
    expect(() => caseEntityUri(`${BASE}/ims/case/v1p1`, "CFItem", id(2))).toThrow(
      "must be the address before /ims/case/v1p1",
    );
  });

  it("refuses an identifier that would change the path, a class that is not served, and options that are not valid", () => {
    expect(() => caseEntityUri(BASE, "CFItem", "..")).toThrow(
      'The identifier must not be "..", which a URL resolves to another path.',
    );
    expect(() => caseEntityUri(BASE, "CFItem", ".")).toThrow(DataError);
    expect(() => caseEntityUri(BASE, "CFItem", "")).toThrow("The identifier must be a non-empty string");
    expect(() => caseEntityUri(BASE, JSON.parse('"CFPackage"'), id(2))).toThrow("The kind is invalid");
    expect(() => caseEntityUri(BASE, "CFItem", id(2), JSON.parse('{"version":"2.0"}'))).toThrow(
      "The options is invalid at version",
    );
    expect(() => caseEntityUri(BASE, "CFItem", id(2), JSON.parse("null"))).toThrow(DataError);
  });
});
