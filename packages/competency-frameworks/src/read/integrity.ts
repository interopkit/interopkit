import type { CaseEntity, CaseIssue, CasePackage, CFPckgAssociation, CFRubric, LinkURI } from "../model/index.js";
import { INFORMATION_MODEL_UUID, identifierKey, isCaseNode } from "../model/internal.js";

/** An identifier of an entity, and where it is. */
interface Identified {
  /** The path of the `identifier` property. */
  readonly path: string;
  readonly identifier: string;
}

/** The URIs of the entities of one class that a package holds, by the identifier in lower case. */
type Targets = ReadonlyMap<string, string>;

function issue(path: string, rule: string, severity: CaseIssue["severity"], message: string): CaseIssue {
  return { path, rule, message, severity };
}

/** Lists the identifiers of the members of a list, with the path of the list. */
function identifiersOfList(list: readonly { readonly identifier: string }[] | undefined, path: string): Identified[] {
  return (list ?? []).map(({ identifier }, at) => ({ path: `${path}[${at}].identifier`, identifier }));
}

/** Lists the identifiers of an entity, and of its criteria and their levels when it is a rubric. */
function identifiersOfEntity(entity: Pick<CFRubric, "identifier" | "CFRubricCriteria">, path: string): Identified[] {
  const prefix = path === "" ? "" : `${path}.`;
  const found: Identified[] = [{ path: `${prefix}identifier`, identifier: entity.identifier }];
  for (const [at, criterion] of (entity.CFRubricCriteria ?? []).entries()) {
    const criterionPath = `${prefix}CFRubricCriteria[${at}]`;
    found.push({ path: `${criterionPath}.identifier`, identifier: criterion.identifier });
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
function identifierIssues(identified: readonly Identified[]): CaseIssue[] {
  const issues: CaseIssue[] = [];
  const first = new Map<string, string>();
  for (const { path, identifier } of identified) {
    const key = identifierKey(identifier);
    const earlier = first.get(key);
    if (earlier === undefined) first.set(key, path);
    else {
      issues.push(
        issue(
          path,
          "duplicate-identifier",
          "error",
          `the identifier ${JSON.stringify(identifier)} is also the identifier at ${earlier}; give each entity an identifier of its own.`,
        ),
      );
    }
    if (!INFORMATION_MODEL_UUID.test(identifier)) {
      issues.push(
        issue(
          path,
          "identifier-form",
          "warning",
          `the identifier ${JSON.stringify(identifier)} is not of the form that the Information Model gives: a UUID of lower-case digits, of version 1 to 5.`,
        ),
      );
    }
  }
  return issues;
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
function linkIssues(link: LinkURI | undefined, path: string, targets: Targets, what: string): CaseIssue[] {
  if (link === undefined) return [];
  const uri = targets.get(identifierKey(link.identifier));
  if (uri === undefined) {
    return [
      issue(
        path,
        "unresolved-reference",
        "warning",
        `the ${what} ${JSON.stringify(link.identifier)} is not in the package, which should hold what its links point to; add it to the definitions or leave the link out.`,
      ),
    ];
  }
  return uri === link.uri
    ? []
    : [
        issue(
          path,
          "reference-mismatch",
          "warning",
          `the link to the ${what} ${JSON.stringify(link.identifier)} has the URI ${JSON.stringify(link.uri)}, and the ${what} has ${JSON.stringify(uri)}; use the URI of the ${what}.`,
        ),
      ];
}

/** Checks each link of a list. */
function linksIssues(links: readonly LinkURI[] | undefined, path: string, targets: Targets, what: string): CaseIssue[] {
  return (links ?? []).flatMap((link, at) => linkIssues(link, `${path}[${at}]`, targets, what));
}

/** Checks the nodes of an association: a node that names the package's own document or item agrees with it in URI. */
function nodeIssues(association: CFPckgAssociation, path: string, nodes: Targets): CaseIssue[] {
  const issues: CaseIssue[] = [];
  let local = 0;
  for (const side of ["originNodeURI", "destinationNodeURI"] as const) {
    const node = association[side];
    const uri = isCaseNode(node) ? nodes.get(identifierKey(node.identifier)) : undefined;
    if (uri === undefined) continue;
    local += 1;
    if (uri !== node.uri) {
      issues.push(
        issue(
          `${path}.${side}`,
          "reference-mismatch",
          "warning",
          `the node ${JSON.stringify(node.identifier)} has the URI ${JSON.stringify(node.uri)}, and the document or item of the package has ${JSON.stringify(uri)}; use the URI of the document or item.`,
        ),
      );
    }
  }
  if (local === 0) {
    issues.push(
      issue(
        path,
        "association-outside-package",
        "warning",
        "neither node of the association is the document or an item of the package, which holds the associations of its own document and items; move the association to the package of its nodes.",
      ),
    );
  }
  return issues;
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
    edges.set(child, [...(edges.get(child) ?? []), { parent, at }]);
  }
  return edges;
}

/** One step of the walk from a child to its parents: the node and how many of its parents are visited. */
interface Frame {
  readonly node: string;
  visited: number;
}

/** Finds the `isChildOf` associations that close a loop, by a walk that keeps its own stack so that a long chain cannot overflow. */
function cycleIssues(edges: ReadonlyMap<string, readonly ChildEdge[]>): CaseIssue[] {
  const issues: CaseIssue[] = [];
  const state = new Map<string, "open" | "done">();
  for (const start of edges.keys()) {
    if (state.has(start)) continue;
    const stack: Frame[] = [{ node: start, visited: 0 }];
    state.set(start, "open");
    for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
      const parents = edges.get(frame.node) ?? [];
      const edge = parents[frame.visited];
      frame.visited += 1;
      if (edge === undefined) {
        state.set(frame.node, "done");
        stack.pop();
        continue;
      }
      const status = state.get(edge.parent);
      if (status === "open") {
        const loop = [
          ...stack.slice(stack.findIndex(({ node }) => node === edge.parent)).map(({ node }) => node),
          edge.parent,
        ];
        issues.push(
          issue(
            `CFAssociations[${edge.at}]`,
            "child-of-cycle",
            "error",
            `the isChildOf associations loop through ${loop.join(" -> ")}; a tree has no loop, so remove one of the associations.`,
          ),
        );
      } else if (status === undefined) {
        state.set(edge.parent, "open");
        stack.push({ node: edge.parent, visited: 0 });
      }
    }
  }
  return issues;
}

/** Finds the items that no chain of `isChildOf` associations leads from to the document, which the items are components of. */
function outsideTreeIssues(pkg: CasePackage, edges: ReadonlyMap<string, readonly ChildEdge[]>): CaseIssue[] {
  const children = new Map<string, string[]>();
  for (const [child, parents] of edges) {
    for (const { parent } of parents) children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const reached = new Set([identifierKey(pkg.CFDocument.identifier)]);
  const queue = [...reached];
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    for (const child of children.get(node) ?? []) {
      if (reached.has(child)) continue;
      reached.add(child);
      queue.push(child);
    }
  }
  return (pkg.CFItems ?? []).flatMap((item, at) =>
    reached.has(identifierKey(item.identifier))
      ? []
      : [
          issue(
            `CFItems[${at}]`,
            "item-outside-tree",
            "warning",
            "the item has no chain of isChildOf associations to the document, which its items are components of; add an isChildOf association from the item to its parent, or to the document.",
          ),
        ],
  );
}

/** Checks the links of the document and of each item against the definitions of the package. */
function definitionLinkIssues(pkg: CasePackage, targets: PackageTargets): CaseIssue[] {
  const { CFDocument: document } = pkg;
  const issues = [
    ...linksIssues(document.subjectURI, "CFDocument.subjectURI", targets.subjects, "subject"),
    ...linkIssues(document.licenseURI, "CFDocument.licenseURI", targets.licenses, "license"),
  ];
  for (const [at, item] of (pkg.CFItems ?? []).entries()) {
    const path = `CFItems[${at}]`;
    issues.push(
      ...linkIssues(item.conceptKeywordsURI, `${path}.conceptKeywordsURI`, targets.concepts, "concept"),
      ...linksIssues(item.subjectURI, `${path}.subjectURI`, targets.subjects, "subject"),
      ...linkIssues(item.CFItemTypeURI, `${path}.CFItemTypeURI`, targets.itemTypes, "item type"),
      ...linkIssues(item.licenseURI, `${path}.licenseURI`, targets.licenses, "license"),
    );
  }
  return issues;
}

/** Checks the links of the associations: their groupings, their nodes, and the tree that `isChildOf` makes. */
function associationIssues(pkg: CasePackage, targets: PackageTargets): CaseIssue[] {
  const associations = pkg.CFAssociations ?? [];
  const issues = associations.flatMap((association, at) => {
    const path = `CFAssociations[${at}]`;
    return [
      ...linkIssues(
        association.CFAssociationGroupingURI,
        `${path}.CFAssociationGroupingURI`,
        targets.groupings,
        "grouping",
      ),
      ...nodeIssues(association, path, targets.nodes),
    ];
  });
  const edges = childEdges(associations, targets.nodes);
  return [...issues, ...cycleIssues(edges), ...outsideTreeIssues(pkg, edges)];
}

/** Checks that each criterion and level of the rubrics names its parent, and that a criterion's item is in the package. */
function rubricIssues(pkg: CasePackage, targets: PackageTargets): CaseIssue[] {
  const issues: CaseIssue[] = [];
  const parentIssue = (path: string, claimed: string | undefined, parent: string, what: string) =>
    claimed === undefined || identifierKey(claimed) === identifierKey(parent)
      ? []
      : [
          issue(
            path,
            "reference-mismatch",
            "warning",
            `${JSON.stringify(claimed)} is not the identifier ${JSON.stringify(parent)} of the ${what} that holds it; name the ${what} that holds it.`,
          ),
        ];
  for (const [at, rubric] of (pkg.CFRubrics ?? []).entries()) {
    for (const [index, criterion] of (rubric.CFRubricCriteria ?? []).entries()) {
      const path = `CFRubrics[${at}].CFRubricCriteria[${index}]`;
      issues.push(
        ...parentIssue(`${path}.rubricId`, criterion.rubricId, rubric.identifier, "rubric"),
        ...linkIssues(criterion.CFItemURI, `${path}.CFItemURI`, targets.items, "item"),
      );
      for (const [position, level] of (criterion.CFRubricCriterionLevels ?? []).entries()) {
        issues.push(
          ...parentIssue(
            `${path}.CFRubricCriterionLevels[${position}].rubricCriterionId`,
            level.rubricCriterionId,
            criterion.identifier,
            "criterion",
          ),
        );
      }
    }
  }
  return issues;
}

/**
 * Checks a package that has the shape of CASE: identifiers, links and the tree.
 *
 * @param pkg - The package.
 * @returns The findings, in no order that a caller may rely on.
 */
export function packageIssues(pkg: CasePackage): CaseIssue[] {
  const targets = packageTargets(pkg);
  return [
    ...identifierIssues(identifiersOfPackage(pkg)),
    ...definitionLinkIssues(pkg, targets),
    ...associationIssues(pkg, targets),
    ...rubricIssues(pkg, targets),
  ];
}

/**
 * Checks an entity that has the shape of CASE: its identifiers.
 *
 * @param entity - The entity.
 * @returns The findings.
 */
export function entityIssues(entity: CaseEntity): CaseIssue[] {
  return identifierIssues(identifiersOfAnyEntity(entity));
}
