import { checkNonEmptyString } from "@interopkit/core/checks";
import type { CasePackage, CFPckgAssociation } from "../model/index.js";
import { identifierKey, isCaseNode } from "../model/internal.js";
import { checkPackageView, copyOf } from "./package-view.js";

/** The associations of one node of a package, by the end of the association that the node is. */
export interface NodeAssociations {
  /** The associations that start at the node: it is their `originNodeURI`. For `isChildOf`, these lead to its parents. */
  readonly origin: readonly CFPckgAssociation[];
  /** The associations that end at the node: it is their `destinationNodeURI`. For `isChildOf`, these lead to its children. */
  readonly destination: readonly CFPckgAssociation[];
}

/**
 * Lists the associations of a package that have a node of CASE as one of their ends, whichever way they point.
 *
 * @remarks
 * Nodes are compared by identifier, in either case. A node whose `targetType` is not `CASE` is not matched, because the
 * identifier of a thing outside CASE is not an identifier of CASE. A package holds the associations of its own document and
 * items, so the associations of an item in another framework are in that framework's package. The lists are in the order of
 * the package.
 *
 * @param pkg - A package, such as `readPackage` returns. The result shares nothing with it.
 * @param identifier - The identifier of the document or the item.
 * @returns The associations that start at the node and those that end at it. Both lists are empty for a node that the
 * package has nothing about.
 * @throws `DataError` when the identifier is not a non-empty string, or the package lacks the document, or an identifier,
 * URI, association type or node of an item or an association, or holds a value that cannot be copied.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1/impl | CASE Implementation Guide}, 3.3.7
 */
export function associationsOf(pkg: CasePackage, identifier: string): NodeAssociations {
  checkPackageView(pkg, "The package");
  checkNonEmptyString(identifier, "The identifier");
  const key = identifierKey(identifier);
  const ends = (association: CFPckgAssociation, node: "originNodeURI" | "destinationNodeURI") =>
    isCaseNode(association[node]) && identifierKey(association[node].identifier) === key;
  const copies = (node: "originNodeURI" | "destinationNodeURI") =>
    (pkg.CFAssociations ?? [])
      .filter((association) => ends(association, node))
      .map((association) => copyOf(association, `The association ${association.identifier}`));
  return { origin: copies("originNodeURI"), destination: copies("destinationNodeURI") };
}
