import type {
  CFAssociation,
  CFAssociationGrouping,
  CFConcept,
  CFDocument,
  CFItem,
  CFItemType,
  CFLicense,
  CFRubric,
  CFSubject,
} from "./entities.js";
import type { CFAssociationSet, CFConceptSet, CFDocumentSet, CFItemTypeSet, CFSubjectSet } from "./sets.js";
import type { ImsxStatusInfo } from "./status-info.js";

/**
 * The entities that a provider serves by identifier, each by the name of its class: a document, an item, an association, an
 * association grouping, a concept, a subject, a license, an item type and a rubric. Each has the endpoint of its own.
 */
export const SERVED_KINDS = [
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

/** The name of the class of an entity that a provider serves by identifier. */
export type ServedKind = (typeof SERVED_KINDS)[number];

/**
 * The entities that CASE exchanges outside a package, each by the name of its class: the nine that a provider serves by
 * identifier, the five sets that it answers with for a list, an item's associations, a concept, a subject and an item
 * type, and the status that it answers with when it refuses.
 */
export const ENTITY_KINDS = [
  ...SERVED_KINDS,
  "CFDocumentSet",
  "CFAssociationSet",
  "CFConceptSet",
  "CFSubjectSet",
  "CFItemTypeSet",
  "imsx_StatusInfo",
] as const;

/** The name of the class of an entity that CASE exchanges outside a package. */
export type CaseEntityKind = (typeof ENTITY_KINDS)[number];

/** The entity that each kind names. */
export interface CaseEntityMap {
  /** A document outside a package. */
  readonly CFDocument: CFDocument;
  /** An item outside a package. */
  readonly CFItem: CFItem;
  /** An association outside a package. */
  readonly CFAssociation: CFAssociation;
  /** An association grouping. */
  readonly CFAssociationGrouping: CFAssociationGrouping;
  /** A concept. */
  readonly CFConcept: CFConcept;
  /** A subject. */
  readonly CFSubject: CFSubject;
  /** A license. */
  readonly CFLicense: CFLicense;
  /** An item type. */
  readonly CFItemType: CFItemType;
  /** A rubric. */
  readonly CFRubric: CFRubric;
  /** The answer for a list of documents. */
  readonly CFDocumentSet: CFDocumentSet;
  /** The answer for the associations of an item. */
  readonly CFAssociationSet: CFAssociationSet;
  /** The answer for a concept. */
  readonly CFConceptSet: CFConceptSet;
  /** The answer for a subject. */
  readonly CFSubjectSet: CFSubjectSet;
  /** The answer for an item type. */
  readonly CFItemTypeSet: CFItemTypeSet;
  /** The status of an answer that is not a success. */
  readonly imsx_StatusInfo: ImsxStatusInfo;
}

/** An entity that CASE exchanges outside a package. */
export type CaseEntity = CaseEntityMap[CaseEntityKind];
