import { nonEmptyStringSchema, parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type { AssociationType, CasePackage, CFPckgAssociation, ExtensionTerm } from "../model/index.js";
import { identifierKey, isCaseNode } from "../model/internal.js";
import { checkPackageView, copyOf, itemsByKey } from "./package-view.js";

/** The association types that say two items of different frameworks mean the same, or nearly. */
const CROSSWALK_TYPES: readonly string[] = ["exactMatchOf", "isRelatedTo", "isPeerOf", "isTranslationOf"];

/** An association between an item of one package and an item of another. */
export interface CrosswalkLink {
  /** The `uri` of the item in the first package. */
  readonly from: string;
  /** The `uri` of the item in the second package. */
  readonly to: string;
  /** The type of the association. */
  readonly type: AssociationType | ExtensionTerm;
  /** A copy of the association, which says which end is which. */
  readonly association: CFPckgAssociation;
}

/** What `crosswalk` may be asked. */
export interface CrosswalkOptions {
  /**
   * The association types that make a link, which may include `ext:` terms.
   *
   * @defaultValue `["exactMatchOf", "isRelatedTo", "isPeerOf", "isTranslationOf"]`
   */
  readonly types?: readonly (AssociationType | ExtensionTerm)[];
}

const optionsSchema = strictRecord({ types: v.optional(v.array(nonEmptyStringSchema)) });

/** Checks the options of `crosswalk`, and returns the types that make a link. */
function typesOf(options: unknown): ReadonlySet<string> {
  const { types = CROSSWALK_TYPES } = parseWith(optionsSchema, options === undefined ? {} : options, "The options");
  return new Set(types);
}

/**
 * Lists the associations that link the items of one package to the items of another: a crosswalk from one framework to the
 * other.
 *
 * @remarks
 * An association counts when one end is an item of `from` and the other an item of `to`, whichever end is the origin, so
 * the associations that either package holds are read. If both packages hold one association, it makes one link. The
 * links are in the order of the associations, those of `from` first. The ends are matched by identifier in either case, and
 * a node whose `targetType` is not `CASE` is not matched. Links to the document of a package, and between two items of one
 * package, are not links of a crosswalk. A consumer that meets an `ext:` association type it does not know should treat it as
 * `isRelatedTo`: add it to `types`.
 *
 * @param from - The package whose items are the starting points, such as `readPackage` returns.
 * @param to - The package whose items they lead to.
 * @param options - Which association types make a link.
 * @returns The links, with copies of the associations, which share nothing with the packages.
 * @throws `DataError` when a package lacks the document, or an identifier, URI, association type or node of an item or an
 * association, or holds a value that cannot be copied, or when the options are not valid.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1/impl | CASE Implementation Guide}, 3.3 and 4.7
 */
export function crosswalk(from: CasePackage, to: CasePackage, options?: CrosswalkOptions): readonly CrosswalkLink[] {
  checkPackageView(from, "The package from");
  checkPackageView(to, "The package to");
  const types = typesOf(options);
  const [fromItems, toItems] = [itemsByKey(from), itemsByKey(to)];
  const links: CrosswalkLink[] = [];
  const held = new Set<string>();
  for (const association of [...(from.CFAssociations ?? []), ...(to.CFAssociations ?? [])]) {
    const { originNodeURI: origin, destinationNodeURI: destination } = association;
    if (!types.has(association.associationType) || !isCaseNode(origin) || !isCaseNode(destination)) continue;
    const [first, second] = [identifierKey(origin.identifier), identifierKey(destination.identifier)];
    const forward = fromItems.has(first) && toItems.has(second);
    const [start, end] = forward ? [first, second] : [second, first];
    const [left, right] = [fromItems.get(start), toItems.get(end)];
    if (left === undefined || right === undefined || held.has(identifierKey(association.identifier))) continue;
    held.add(identifierKey(association.identifier));
    links.push({
      from: left.uri,
      to: right.uri,
      type: association.associationType,
      association: copyOf(association, `The association ${association.identifier}`),
    });
  }
  return links;
}
