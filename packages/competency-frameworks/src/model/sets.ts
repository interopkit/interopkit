import type { CFConcept, CFDocument, CFItem, CFItemType, CFPckgAssociation, CFSubject } from "./entities.js";

/** The answer for a document list (Information Model 7.1.13): at least one document. */
export interface CFDocumentSet {
  /** The documents. */
  readonly CFDocuments: readonly CFDocument[];
}

/** The answer for the associations of an item (Information Model 7.1.5): the item and its associations. */
export interface CFAssociationSet {
  /** The item that the associations are of. */
  readonly CFItem: CFItem;
  /** The associations of the item, at least one. */
  readonly CFAssociations: readonly CFPckgAssociation[];
}

/** The answer for a concept (Information Model 7.1.8): the concept and its child concepts, at least one. */
export interface CFConceptSet {
  /** The concept and its children. */
  readonly CFConcepts: readonly CFConcept[];
}

/** The answer for a subject (Information Model 7.1.34): the subject and its child subjects, at least one. */
export interface CFSubjectSet {
  /** The subject and its children. */
  readonly CFSubjects: readonly CFSubject[];
}

/** The answer for an item type (Information Model 7.1.18): the item type and its child item types, at least one. */
export interface CFItemTypeSet {
  /** The item type and its children. */
  readonly CFItemTypes: readonly CFItemType[];
}
