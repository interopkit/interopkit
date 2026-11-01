import type { CasePackage, CFPckgItem } from "../model/index.js";
import { identifierKey, isCaseNode } from "../model/internal.js";
import { checkPackageView, copyOf, itemsByKey } from "./package-view.js";

/** An item of the framework, with the items that are its children, in order. */
export interface FrameworkNode {
  /** A copy of the item. */
  readonly item: CFPckgItem;
  /** The children of the item, in the order of their `isChildOf` associations. */
  readonly children: readonly FrameworkNode[];
}

/** One `isChildOf` association from an item to its parent: the child, the place it asks for, and where it is in the package. */
interface Edge {
  readonly child: string;
  readonly item: CFPckgItem;
  readonly sequenceNumber: number | undefined;
  readonly at: number;
}

// Numbers inside a code sort as numbers, so that `RL.5.2` comes before `RL.5.10`.
const CODES = new Intl.Collator("und", { numeric: true });

/** Orders two values that may be absent: the one that is there first, and two that are there by `compare`. */
function presentFirst<TValue>(
  first: TValue | undefined,
  second: TValue | undefined,
  compare: (a: TValue, b: TValue) => number,
): number {
  if (first === undefined) return second === undefined ? 0 : 1;
  if (second === undefined) return -1;
  return compare(first, second);
}

/** Collects the `isChildOf` associations between CASE nodes of the package, by the key of the parent. */
function edgesByParent(pkg: CasePackage, items: ReadonlyMap<string, CFPckgItem>, root: string): Map<string, Edge[]> {
  const edges = new Map<string, Edge[]>();
  for (const [at, association] of (pkg.CFAssociations ?? []).entries()) {
    const { originNodeURI: origin, destinationNodeURI: destination } = association;
    if (association.associationType !== "isChildOf" || !isCaseNode(origin) || !isCaseNode(destination)) continue;
    const [child, parent] = [identifierKey(origin.identifier), identifierKey(destination.identifier)];
    const item = items.get(child);
    if (item === undefined || (parent !== root && !items.has(parent))) continue;
    const edge = { child, item, sequenceNumber: association.sequenceNumber, at };
    const siblings = edges.get(parent);
    if (siblings === undefined) edges.set(parent, [edge]);
    else siblings.push(edge);
  }
  return edges;
}

/** Sorts the children of one parent by the sequence number of their association, then by code, then by place in the package. */
function inOrder(edges: readonly Edge[]): Edge[] {
  return [...edges].sort(
    (a, b) =>
      presentFirst(a.sequenceNumber, b.sequenceNumber, (x, y) => x - y) ||
      presentFirst(a.item.humanCodingScheme, b.item.humanCodingScheme, (x, y) => CODES.compare(x, y)) ||
      a.at - b.at,
  );
}

/**
 * Builds the tree of a framework: the items under the document, each with its children, from the `isChildOf` associations.
 *
 * @remarks
 * Children are ordered by the `sequenceNumber` of their association, the items without one after those with one, then by
 * `humanCodingScheme` with numbers inside a code read as numbers, then by their place in the package. The walk starts at the
 * document and goes level by level, so an item appears once, under the first parent that it reaches: Information Model
 * guidance puts an item in one place, and the walk keeps a package that breaks it, or loops, from growing or running on. An
 * item with no chain of `isChildOf` associations to the document is not in the tree, and neither is an association whose
 * node is not an item or the document of the package. The walk keeps its own queue, so a chain of thousands of levels
 * cannot overflow the stack.
 *
 * @param pkg - A package, such as `readPackage` returns. The result shares nothing with it.
 * @returns The items whose parent is the document, in order, each with its subtree.
 * @throws `DataError` when the package lacks the document, or an identifier, URI, association type or node of an item or an
 * association, or holds a value that cannot be copied.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1/impl | CASE Implementation Guide}, 3.3
 */
export function frameworkTree(pkg: CasePackage): readonly FrameworkNode[] {
  checkPackageView(pkg, "The package");
  const items = itemsByKey(pkg);
  const root = identifierKey(pkg.CFDocument.identifier);
  const edges = edgesByParent(pkg, items, root);
  const placed = new Set([root]);
  const top: FrameworkNode[] = [];
  const queue = [{ key: root, children: top }];
  // The loop reads the entries that it appends: the queue is the walk, level by level.
  for (const { key: parent, children } of queue) {
    for (const { child, item } of inOrder(edges.get(parent) ?? [])) {
      if (placed.has(child)) continue;
      placed.add(child);
      const below: FrameworkNode[] = [];
      children.push({ item: copyOf(item, `The item ${item.identifier}`), children: below });
      queue.push({ key: child, children: below });
    }
  }
  return top;
}
