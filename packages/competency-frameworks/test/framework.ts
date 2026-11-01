import type { AssociationType, CasePackage, CFPckgAssociation, CFPckgItem, ExtensionTerm } from "../src/index.js";
import { id, uri } from "./full-package.js";

/** The number of the document of a framework built with {@link framework}; the items are 2 and above. */
export const DOCUMENT = 1;

const TIME = "2024-06-13T18:46:03+00:00";

/** What a test says of an item. */
export interface ItemSpec {
  readonly number: number;
  /** The `humanCodingScheme`. */
  readonly code?: string;
  readonly statement?: string;
  readonly changed?: string;
}

/** What a test says of an association: its type, the numbers of its ends and the place it asks for. */
export interface AssociationSpec {
  readonly type: AssociationType | ExtensionTerm;
  readonly origin: number;
  readonly destination: number;
  readonly sequence?: number;
  /** The number of the association, by default the next free one above 1,000. */
  readonly number?: number;
}

/** The address of the entity with a number: the document is number 1, and every other number is an item. */
function addressOf(number: number): string {
  return uri(number === DOCUMENT ? "CFDocuments" : "CFItems", number);
}

/** Builds an item with a number and, when the test needs them, a code, a statement and a time of change. */
export function itemOf({ number, code, statement, changed }: ItemSpec): CFPckgItem {
  return {
    identifier: id(number),
    uri: addressOf(number),
    fullStatement: statement ?? `Statement ${number}`,
    ...(code === undefined ? {} : { humanCodingScheme: code }),
    lastChangeDateTime: changed ?? TIME,
  };
}

/** Builds an association between the entities with two numbers. */
export function associationOf(spec: AssociationSpec, number: number): CFPckgAssociation {
  const node = (at: number) => ({ title: `Node ${at}`, identifier: id(at), uri: addressOf(at) });
  return {
    identifier: id(spec.number ?? number),
    associationType: spec.type,
    ...(spec.sequence === undefined ? {} : { sequenceNumber: spec.sequence }),
    uri: uri("CFAssociations", spec.number ?? number),
    originNodeURI: node(spec.origin),
    destinationNodeURI: node(spec.destination),
    lastChangeDateTime: TIME,
  };
}

/** The first number of the associations that a test does not number. */
const FIRST_ASSOCIATION = 1000;

/**
 * Builds a package of a framework from the numbers of its items and the associations between them. The document is
 * number 1.
 */
export function framework(items: readonly ItemSpec[], associations: readonly AssociationSpec[] = []): CasePackage {
  return {
    CFDocument: {
      identifier: id(DOCUMENT),
      uri: addressOf(DOCUMENT),
      creator: "Ministry of Education",
      title: "Mathematics",
      lastChangeDateTime: TIME,
    },
    CFItems: items.map(itemOf),
    CFAssociations: associations.map((spec, at) => associationOf(spec, FIRST_ASSOCIATION + at)),
  };
}

/** An `isChildOf` association from the child to the parent. */
export function childOf(child: number, parent: number, sequence?: number): AssociationSpec {
  return { type: "isChildOf", origin: child, destination: parent, ...(sequence === undefined ? {} : { sequence }) };
}
