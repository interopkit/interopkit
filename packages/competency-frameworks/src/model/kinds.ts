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
 * The entities that CASE exchanges outside a package, each by the name of its class: the nine that a provider serves by
 * identifier, the five sets that it answers with for a list, an item's associations, a concept, a subject and an item
 * type, and the status that it answers with when it refuses.
 */
export const ENTITY_KINDS = [
  "CFDocument",
  "CFItem",
  "CFAssociation",
  "CFAssociationGrouping",
  "CFConcept",
  "CFSubject",
  "CFLicense",
  "CFItemType",
  "CFRubric",
  "CFDocumentSet",
  "CFAssociationSet",
  "CFConceptSet",
  "CFSubjectSet",
  "CFItemTypeSet",
  "imsx_StatusInfo",
] as const;

/** The name of the class of an entity that CASE exchanges outside a package. */
export type CaseEntityKind = (typeof ENTITY_KINDS)[number];

/** An entity that CASE exchanges outside a package. */
export type CaseEntity =
  | CFDocument
  | CFItem
  | CFAssociation
  | CFAssociationGrouping
  | CFConcept
  | CFSubject
  | CFLicense
  | CFItemType
  | CFRubric
  | CFDocumentSet
  | CFAssociationSet
  | CFConceptSet
  | CFSubjectSet
  | CFItemTypeSet
  | ImsxStatusInfo;
