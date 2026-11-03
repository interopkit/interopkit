import type { CasePackage, CFPckgItem } from "../model/index.js";
import { identifierKey, isCaseNode } from "../model/internal.js";
import { checkPackageView, copyOf, itemsByKey } from "./package-view.js";

/** An item that was changed, as it was and as it is. */
export interface ChangedItem {
  /** A copy of the item in the earlier package. */
  readonly before: CFPckgItem;
  /** A copy of the item in the later package. */
  readonly after: CFPckgItem;
}

/** An item that a `replacedBy` association retires, and the item that takes its place. */
export interface ReplacedItem {
  /** The `uri` of the item that the association retires. */
  readonly item: string;
  /** The `uri` of the item that replaces it. */
  readonly by: string;
}

/** What differs between two versions of a framework. */
export interface PackageDiff {
  /** Copies of the items that only the later package holds, in its order. */
  readonly added: readonly CFPckgItem[];
  /** Copies of the items that only the earlier package holds, in its order. */
  readonly removed: readonly CFPckgItem[];
  /** The items that both hold and that differ in any property, in the order of the later package. */
  readonly changed: readonly ChangedItem[];
  /** The `replacedBy` associations that only the later package holds. */
  readonly replaced: readonly ReplacedItem[];
}

/** One pair of values still to compare, and the depth they are at. */
interface Pair {
  readonly first: unknown;
  readonly second: unknown;
}

/** Tells whether two JSON values are equal, whatever the order of the properties of an object, without recursion. */
function sameJson(first: unknown, second: unknown): boolean {
  const pairs: Pair[] = [{ first, second }];
  for (let pair = pairs.pop(); pair !== undefined; pair = pairs.pop()) {
    const [a, b] = [pair.first, pair.second];
    if (a === b) continue;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const [keysA, keysB] = [Object.keys(a), Object.keys(b)];
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.hasOwn(b, key)) return false;
      pairs.push({ first: Reflect.get(a, key), second: Reflect.get(b, key) });
    }
  }
  return true;
}

/**
 * Compares two versions of a framework by its items.
 *
 * @remarks
 * Items are matched by identifier, in either case, which a publisher never changes (Implementation Guide 4.3). An item is
 * `changed` when any property differs, `lastChangeDateTime` and `extensions` included, whatever the order of the keys. An
 * item that a publisher retires stays in the framework with a `statusEndDate`, so it shows as changed and not as removed;
 * `removed` holds only items that left the package. `replaced` holds the `replacedBy` associations that the later package
 * has and the earlier lacks, matched by the identifier of the association: the item retired is the origin and the item that
 * replaces it the destination (4.3.5). Each is given by the `uri` of the item in the packages when they hold it, and by the
 * `uri` of the node otherwise. Associations of other types, definitions, rubrics and the document are not compared; a
 * consumer compares `lastChangeDateTime` of the documents with `isNewer`, and reads the associations with `listAssociations`.
 *
 * @param before - The earlier package, such as `readPackage` returns.
 * @param after - The later package.
 * @returns What differs, with copies of the items that share nothing with the packages.
 * @throws `DataError` when a package lacks the document, or an identifier, URI, association type or node of an item or an
 * association, or holds a value that cannot be copied.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1/impl | CASE Implementation Guide}, 4.3
 */
export function diffPackages(before: CasePackage, after: CasePackage): PackageDiff {
  checkPackageView(before, "The package before");
  checkPackageView(after, "The package after");
  const [earlier, later] = [itemsByKey(before), itemsByKey(after)];
  const copy = (item: CFPckgItem) => copyOf(item, `The item ${item.identifier}`);
  const added = [...later].filter(([key]) => !earlier.has(key)).map(([, item]) => copy(item));
  const removed = [...earlier].filter(([key]) => !later.has(key)).map(([, item]) => copy(item));
  const changed = [...later].flatMap(([key, item]) => {
    const old = earlier.get(key);
    return old === undefined || sameJson(old, item) ? [] : [{ before: copy(old), after: copy(item) }];
  });
  const known = new Set((before.CFAssociations ?? []).map(({ identifier }) => identifierKey(identifier)));
  const uriOf = (node: { readonly identifier: string; readonly uri: string }) => {
    const key = identifierKey(node.identifier);
    return (later.get(key) ?? earlier.get(key))?.uri ?? node.uri;
  };
  const replaced = (after.CFAssociations ?? []).flatMap((association) => {
    const { originNodeURI: origin, destinationNodeURI: destination } = association;
    const isNew = !known.has(identifierKey(association.identifier));
    return isNew && association.associationType === "replacedBy" && isCaseNode(origin) && isCaseNode(destination)
      ? [{ item: uriOf(origin), by: uriOf(destination) }]
      : [];
  });
  return { added, removed, changed, replaced };
}
