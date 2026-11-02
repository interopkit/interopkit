import type { CaseEntity, CaseIssue, CasePackage, CFPckgAssociation, CFRubric, LinkURI } from "../model/index.js";
import { INFORMATION_MODEL_UUID, identifierKey, isCaseNode } from "../model/internal.js";

/** An identifier of an entity, and where it is. */
interface Identified {
  /** The path of the list that holds the entity, or of the `identifier` property itself when `index` is -1. */
  readonly within: string;
  /** The place of the entity in the list, or -1. */
  readonly index: number;
  readonly identifier: string;
}

/** Writes the path of the `identifier` property, which a finding alone needs: a package has an identifier for each entity. */
function pathOf({ within, index }: Identified): string {
  return index < 0 ? within : `${within}[${index}].identifier`;
}

/** The URIs of the entities of one class that a package holds, by the identifier in lower case. */
type Targets = ReadonlyMap<string, string>;

function issue(path: string, rule: string, severity: CaseIssue["severity"], message: string): CaseIssue {
  return { path, rule, message, severity };
}

/** Lists the identifiers of the members of a list, with the path of the list. */
function identifiersOfList(list: readonly { readonly identifier: string }[] | undefined, path: string): Identified[] {
  return (list ?? []).map(({ identifier }, index) => ({ within: path, index, identifier }));
}

/** Lists the identifiers of an entity, and of its criteria and their levels when it is a rubric. */
function identifiersOfEntity(entity: Pick<CFRubric, "identifier" | "CFRubricCriteria">, path: string): Identified[] {
  const prefix = path === "" ? "" : `${path}.`;
  const found: Identified[] = [{ within: `${prefix}identifier`, index: -1, identifier: entity.identifier }];
  for (const [at, criterion] of (entity.CFRubricCriteria ?? []).entries()) {
    const criterionPath = `${prefix}CFRubricCriteria[${at}]`;
    found.push({ within: `${criterionPath}.identifier`, index: -1, identifier: criterion.identifier });
    found.push(...identifiersOfList(criterion.CFRubricCriterionLevels, `${criterionPath}.CFRubricCriterionLevels`));
  }
  return found;
}

/** Lists the identifiers of everything that a package holds, in the order of the package. */
function identifiersOfPackage(pkg: CasePackage): Identified[] {
  const definitions = pkg.CFDefinitions;
  return [
    ...identifiersOfEntity(pkg.CFDocument, "CFDocument"),
    ...identifiersOfList(pkg.CFItems, "CFItems"),
    ...identifiersOfList(pkg.CFAssociations, "CFAssociations"),
    ...identifiersOfList(definitions?.CFConcepts, "CFDefinitions.CFConcepts"),
    ...identifiersOfList(definitions?.CFSubjects, "CFDefinitions.CFSubjects"),
    ...identifiersOfList(definitions?.CFLicenses, "CFDefinitions.CFLicenses"),
    ...identifiersOfList(definitions?.CFItemTypes, "CFDefinitions.CFItemTypes"),
    ...identifiersOfList(definitions?.CFAssociationGroupings, "CFDefinitions.CFAssociationGroupings"),
    ...(pkg.CFRubrics ?? []).flatMap((rubric, at) => identifiersOfEntity(rubric, `CFRubrics[${at}]`)),
  ];
}

/** Lists the identifiers of an entity outside a package, and of the entities that it holds. */
function identifiersOfAnyEntity(entity: CaseEntity): Identified[] {
  if ("imsx_codeMajor" in entity) return [];
  if ("CFDocuments" in entity) return identifiersOfList(entity.CFDocuments, "CFDocuments");
  if ("CFConcepts" in entity) return identifiersOfList(entity.CFConcepts, "CFConcepts");
  if ("CFSubjects" in entity) return identifiersOfList(entity.CFSubjects, "CFSubjects");
  if ("CFItemTypes" in entity) return identifiersOfList(entity.CFItemTypes, "CFItemTypes");
  if ("CFAssociations" in entity) {
    return [
      ...identifiersOfEntity(entity.CFItem, "CFItem"),
      ...identifiersOfList(entity.CFAssociations, "CFAssociations"),
    ];
  }
  return identifiersOfEntity(entity, "");
}

/** Finds the identifiers that two entities share, and the identifiers that are not of the form of the Information Model. */
function* identifierIssues(identified: readonly Identified[]): Generator<CaseIssue> {
  const first = new Map<string, Identified>();
  for (const entry of identified) {
    const { identifier } = entry;
    const key = identifierKey(identifier);
    const earlier = first.get(key);
    if (earlier === undefined) first.set(key, entry);
    else {
      yield issue(
        pathOf(entry),
        "duplicate-identifier",
        "error",
        `the identifier ${JSON.stringify(identifier)} is also the identifier at ${pathOf(earlier)}; give each entity an identifier of its own.`,
      );
    }
    if (!INFORMATION_MODEL_UUID.test(identifier)) {
      yield issue(
        pathOf(entry),
        "identifier-form",
        "warning",
        `the identifier ${JSON.stringify(identifier)} is not of the form that the Information Model gives: a UUID of lower-case digits, of version 1 to 5.`,
      );
    }
  }
}

/** The entities of a package that links point to, by the class of the link. */
interface PackageTargets {
  readonly nodes: Targets;
  readonly items: Targets;
  readonly concepts: Targets;
  readonly subjects: Targets;
  readonly licenses: Targets;
  readonly itemTypes: Targets;
  readonly groupings: Targets;
}

/** Maps identifiers to URIs. */
function targetsOf(list: readonly { readonly identifier: string; readonly uri: string }[] | undefined): Targets {
  return new Map((list ?? []).map(({ identifier, uri }) => [identifierKey(identifier), uri]));
}

function packageTargets(pkg: CasePackage): PackageTargets {
  const definitions = pkg.CFDefinitions;
  const items = targetsOf(pkg.CFItems);
  return {
    nodes: new Map([...items, ...targetsOf([pkg.CFDocument])]),
    items,
    concepts: targetsOf(definitions?.CFConcepts),
    subjects: targetsOf(definitions?.CFSubjects),
    licenses: targetsOf(definitions?.CFLicenses),
    itemTypes: targetsOf(definitions?.CFItemTypes),
    groupings: targetsOf(definitions?.CFAssociationGroupings),
  };
}

/** Checks that a link points to an entity of the package, with the same URI. */
function* linkIssues(link: LinkURI | undefined, path: string, targets: Targets, what: string): Generator<CaseIssue> {
  if (link === undefined) return;
  const uri = targets.get(identifierKey(link.identifier));
  if (uri === undefined) {
    yield issue(
      path,
      "unresolved-reference",
      "warning",
      `the ${what} ${JSON.stringify(link.identifier)} is not in the package, which should hold what its links point to; add it to the definitions or leave the link out.`,
    );
  } else if (uri !== link.uri) {
    yield issue(
      path,
      "reference-mismatch",
      "warning",
      `the link to the ${what} ${JSON.stringify(link.identifier)} has the URI ${JSON.stringify(link.uri)}, and the ${what} has ${JSON.stringify(uri)}; use the URI of the ${what}.`,
    );
  }
}

/** Checks each link of a list. */
function* linksIssues(
  links: readonly LinkURI[] | undefined,
  path: string,
  targets: Targets,
  what: string,
): Generator<CaseIssue> {
  for (const [at, link] of (links ?? []).entries()) yield* linkIssues(link, `${path}[${at}]`, targets, what);
}

/** Checks the nodes of an association: a node that names the package's own document or item agrees with it in URI. */
function* nodeIssues(association: CFPckgAssociation, at: number, nodes: Targets): Generator<CaseIssue> {
  let local = 0;
  for (const side of ["originNodeURI", "destinationNodeURI"] as const) {
    const node = association[side];
    const uri = isCaseNode(node) ? nodes.get(identifierKey(node.identifier)) : undefined;
    if (uri === undefined) continue;
    local += 1;
    if (uri !== node.uri) {
      yield issue(
        `CFAssociations[${at}].${side}`,
        "reference-mismatch",
        "warning",
        `the node ${JSON.stringify(node.identifier)} has the URI ${JSON.stringify(node.uri)}, and the document or item of the package has ${JSON.stringify(uri)}; use the URI of the document or item.`,
      );
    }
  }
  if (local === 0) {
    yield issue(
      `CFAssociations[${at}]`,
      "association-outside-package",
      "warning",
      "neither node of the association is the document or an item of the package, which holds the associations of its own document and items; move the association to the package of its nodes.",
    );
  }
}

/** One `isChildOf` association between two nodes of the package: the child, the parent and the place of the association. */
interface ChildEdge {
  readonly parent: string;
  readonly at: number;
}

/** Collects the `isChildOf` associations whose nodes are both the document or an item of the package, by child. */
function childEdges(associations: readonly CFPckgAssociation[], nodes: Targets): Map<string, ChildEdge[]> {
  const edges = new Map<string, ChildEdge[]>();
  for (const [at, association] of associations.entries()) {
    const { originNodeURI: origin, destinationNodeURI: destination } = association;
    if (association.associationType !== "isChildOf" || !isCaseNode(origin) || !isCaseNode(destination)) continue;
    const [child, parent] = [identifierKey(origin.identifier), identifierKey(destination.identifier)];
    if (!nodes.has(child) || !nodes.has(parent)) continue;
    const parents = edges.get(child);
    if (parents === undefined) edges.set(child, [{ parent, at }]);
    else parents.push({ parent, at });
  }
  return edges;
}

/** One step of the walk from a child to its parents: the node and how many of its parents are visited. */
interface Frame {
  readonly node: string;
  visited: number;
}

/** The most nodes of a loop that its finding names, so that the message of a loop of any length stays short. */
const LOOP_NODES_NAMED = 5;

/** Names the nodes of a loop that starts at a place of the walk's stack, and goes back to its first node. */
function loopText(stack: readonly Frame[], start: number): string {
  const length = stack.length - start;
  const named = stack.slice(start, start + Math.min(length, LOOP_NODES_NAMED)).map(({ node }) => node);
  const more = length > LOOP_NODES_NAMED ? [`${length - LOOP_NODES_NAMED} more`] : [];
  return [...named, ...more, named[0]].join(" -> ");
}

/**
 * Finds the `isChildOf` associations that close a loop, by a walk that keeps its own stack so that a long chain cannot overflow.
 * Each node on the stack keeps its place there, so that an association that closes a loop costs the same however long it is.
 */
function* cycleIssues(edges: ReadonlyMap<string, readonly ChildEdge[]>): Generator<CaseIssue> {
  // The place on the stack of a node that the walk is in, or "done" for a node whose parents are all walked.
  const state = new Map<string, number | "done">();
  for (const start of edges.keys()) {
    if (state.has(start)) continue;
    const stack: Frame[] = [{ node: start, visited: 0 }];
    state.set(start, 0);
    for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
      const parents = edges.get(frame.node) ?? [];
      const edge = parents[frame.visited];
      frame.visited += 1;
      if (edge === undefined) {
        state.set(frame.node, "done");
        stack.pop();
        continue;
      }
      const place = state.get(edge.parent);
      if (typeof place === "number") {
        yield issue(
          `CFAssociations[${edge.at}]`,
          "child-of-cycle",
          "error",
          `the isChildOf associations loop through ${loopText(stack, place)}; a tree has no loop, so remove one of the associations.`,
        );
      } else if (place === undefined) {
        state.set(edge.parent, stack.length);
        stack.push({ node: edge.parent, visited: 0 });
      }
    }
  }
}

/** Collects the nodes that a chain of `isChildOf` associations leads down to from the document, the document included. */
function reachedFromDocument(pkg: CasePackage, edges: ReadonlyMap<string, readonly ChildEdge[]>): ReadonlySet<string> {
  const children = new Map<string, string[]>();
  for (const [child, parents] of edges) {
    for (const { parent } of parents) {
      const siblings = children.get(parent);
      if (siblings === undefined) children.set(parent, [child]);
      else siblings.push(child);
    }
  }
  const queue = [identifierKey(pkg.CFDocument.identifier)];
  const reached = new Set(queue);
  // The loop reads the entries that it appends: the queue is the walk, level by level.
  for (const node of queue) {
    for (const child of children.get(node) ?? []) {
      if (reached.has(child)) continue;
      reached.add(child);
      queue.push(child);
    }
  }
  return reached;
}

/** Finds the items that no chain of `isChildOf` associations leads from to the document, which the items are components of. */
function* outsideTreeIssues(pkg: CasePackage, edges: ReadonlyMap<string, readonly ChildEdge[]>): Generator<CaseIssue> {
  const reached = reachedFromDocument(pkg, edges);
  for (const [at, item] of (pkg.CFItems ?? []).entries()) {
    if (reached.has(identifierKey(item.identifier))) continue;
    yield issue(
      `CFItems[${at}]`,
      "item-outside-tree",
      "warning",
      "the item has no chain of isChildOf associations to the document, which its items are components of; add an isChildOf association from the item to its parent, or to the document.",
    );
  }
}

/** Checks the links of the document and of each item against the definitions of the package. */
function* definitionLinkIssues(pkg: CasePackage, targets: PackageTargets): Generator<CaseIssue> {
  const { CFDocument: document } = pkg;
  yield* linksIssues(document.subjectURI, "CFDocument.subjectURI", targets.subjects, "subject");
  yield* linkIssues(document.licenseURI, "CFDocument.licenseURI", targets.licenses, "license");
  for (const [at, item] of (pkg.CFItems ?? []).entries()) {
    // Most items link to no definition, and only those that do need their paths.
    const { conceptKeywordsURI, subjectURI, CFItemTypeURI, licenseURI } = item;
    if (!(conceptKeywordsURI || subjectURI || CFItemTypeURI || licenseURI)) continue;
    const path = `CFItems[${at}]`;
    yield* linkIssues(item.conceptKeywordsURI, `${path}.conceptKeywordsURI`, targets.concepts, "concept");
    yield* linksIssues(item.subjectURI, `${path}.subjectURI`, targets.subjects, "subject");
    yield* linkIssues(item.CFItemTypeURI, `${path}.CFItemTypeURI`, targets.itemTypes, "item type");
    yield* linkIssues(item.licenseURI, `${path}.licenseURI`, targets.licenses, "license");
  }
}

/** Checks the links of the associations: their groupings, their nodes, and the tree that `isChildOf` makes. */
function* associationIssues(pkg: CasePackage, targets: PackageTargets): Generator<CaseIssue> {
  const associations = pkg.CFAssociations ?? [];
  for (const [at, association] of associations.entries()) {
    if (association.CFAssociationGroupingURI !== undefined) {
      yield* linkIssues(
        association.CFAssociationGroupingURI,
        `CFAssociations[${at}].CFAssociationGroupingURI`,
        targets.groupings,
        "grouping",
      );
    }
    yield* nodeIssues(association, at, targets.nodes);
  }
  const edges = childEdges(associations, targets.nodes);
  yield* cycleIssues(edges);
  yield* outsideTreeIssues(pkg, edges);
}

/** Says that a criterion or a level names another parent than the one that holds it. */
function* parentIssues(path: string, claimed: string | undefined, parent: string, what: string): Generator<CaseIssue> {
  if (claimed === undefined || identifierKey(claimed) === identifierKey(parent)) return;
  yield issue(
    path,
    "reference-mismatch",
    "warning",
    `${JSON.stringify(claimed)} is not the identifier ${JSON.stringify(parent)} of the ${what} that holds it; name the ${what} that holds it.`,
  );
}

/** Checks that each criterion and level of the rubrics names its parent, and that a criterion's item is in the package. */
function* rubricIssues(pkg: CasePackage, targets: PackageTargets): Generator<CaseIssue> {
  for (const [at, rubric] of (pkg.CFRubrics ?? []).entries()) {
    for (const [index, criterion] of (rubric.CFRubricCriteria ?? []).entries()) {
      const path = `CFRubrics[${at}].CFRubricCriteria[${index}]`;
      yield* parentIssues(`${path}.rubricId`, criterion.rubricId, rubric.identifier, "rubric");
      yield* linkIssues(criterion.CFItemURI, `${path}.CFItemURI`, targets.items, "item");
      for (const [position, level] of (criterion.CFRubricCriterionLevels ?? []).entries()) {
        yield* parentIssues(
          `${path}.CFRubricCriterionLevels[${position}].rubricCriterionId`,
          level.rubricCriterionId,
          criterion.identifier,
          "criterion",
        );
      }
    }
  }
}

/**
 * Checks a package that has the shape of CASE: identifiers, links and the tree.
 *
 * @param pkg - The package.
 * @returns The findings, one at a time, so that a list that stops at its limit stops the check; in no order that a caller may
 * rely on.
 */
export function* packageIssues(pkg: CasePackage): Generator<CaseIssue> {
  const targets = packageTargets(pkg);
  yield* identifierIssues(identifiersOfPackage(pkg));
  yield* definitionLinkIssues(pkg, targets);
  yield* associationIssues(pkg, targets);
  yield* rubricIssues(pkg, targets);
}

/**
 * Checks an entity that has the shape of CASE: its identifiers.
 *
 * @param entity - The entity.
 * @returns The findings, one at a time.
 */
export function entityIssues(entity: CaseEntity): Generator<CaseIssue> {
  return identifierIssues(identifiersOfAnyEntity(entity));
}
