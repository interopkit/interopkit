import type { Extensions } from "./json.js";
import type { LinkGenURI, LinkURI } from "./links.js";
import type { AssociationType, ExtensionTerm } from "./terms.js";

/**
 * The document that heads a framework, as it is in a package (Information Model 7.1.24): the framework's title, creator and
 * status.
 *
 * @remarks
 * Its `identifier` is also the identifier of the package. `description` and `notes` may hold Markdown or LaTeX. The package
 * carries the text and never renders it: a consumer that shows it renders it through a sanitizing renderer and never as
 * HTML.
 */
export interface CFPckgDocument {
  /** The globally unique identifier of the document, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the document. */
  readonly uri: string;
  /** What kind of framework this is, such as `CourseCodes`, the one type that CASE 1.1 names. CASE 1.1 only. */
  readonly frameworkType?: string;
  /** The version of CASE that the document follows. CASE 1.1 only. */
  readonly caseVersion?: "1.1";
  /** The authority that promulgates the framework. */
  readonly creator: string;
  /** The title of the document. */
  readonly title: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** The URL of the original document of the standards, which people read. */
  readonly officialSourceURL?: string;
  /** The entity that makes the document available. */
  readonly publisher?: string;
  /** A description of the document. */
  readonly description?: string;
  /** The subjects that the document covers. */
  readonly subject?: readonly string[];
  /** Links to the subjects, which a package defines in its `CFDefinitions`. */
  readonly subjectURI?: readonly LinkURI[];
  /** The language of the text of the framework, as ISO 639-2. */
  readonly language?: string;
  /** The revision of the document. */
  readonly version?: string;
  /** The status of the document, such as `Draft`, `Pending Implementation`, `Implemented` or `Retired`. */
  readonly adoptionStatus?: string;
  /** The date the status began, as an RFC 3339 date. */
  readonly statusStartDate?: string;
  /** The date the status ended or changed, as an RFC 3339 date. */
  readonly statusEndDate?: string;
  /** A link to the license of the framework, which a package defines in its `CFDefinitions`. */
  readonly licenseURI?: LinkURI;
  /** A comment on the document. */
  readonly notes?: string;
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/** A document outside a package (Information Model 7.1.11), which also links to the package that it heads. */
export interface CFDocument extends CFPckgDocument {
  /** A link to the package of the document. */
  readonly CFPackageURI: LinkURI;
}

/**
 * An item of a framework as it is in a package (Information Model 7.1.25): a competency, or a group of them in the taxonomy
 * of the document.
 *
 * @remarks
 * `fullStatement` and `notes` may hold Markdown or LaTeX, which a consumer renders through a sanitizing renderer and never
 * as HTML.
 */
export interface CFPckgItem {
  /** The globally unique identifier of the item, a UUID. */
  readonly identifier: string;
  /** The statement of the competency. */
  readonly fullStatement: string;
  /** Another term for the item, such as outcome or objective. */
  readonly alternativeLabel?: string;
  /** The label of the class of the item, as the promulgating body names it. */
  readonly CFItemType?: string;
  /** The network-resolvable URI of the item. */
  readonly uri: string;
  /** A code for the item that people can refer to, such as `RL.5.1`. */
  readonly humanCodingScheme?: string;
  /** Characters that give the item's place in a list. The `sequenceNumber` of an association is preferred. */
  readonly listEnumeration?: string;
  /** A short form of the statement. */
  readonly abbreviatedStatement?: string;
  /** Keywords that name the topic of the item. */
  readonly conceptKeywords?: readonly string[];
  /** A link to a concept, which a package defines in its `CFDefinitions`. */
  readonly conceptKeywordsURI?: LinkURI;
  /** Information about how the statement came about, such as a clarifying statement. */
  readonly notes?: string;
  /** The subjects that the item covers. CASE 1.1 only. */
  readonly subject?: readonly string[];
  /** Links to the subjects, which a package defines in its `CFDefinitions`. CASE 1.1 only. */
  readonly subjectURI?: readonly LinkURI[];
  /** The language of the statement, as ISO 639-2. */
  readonly language?: string;
  /** The grade or level that the item is meant for. */
  readonly educationLevel?: readonly string[];
  /** A link to the item type, which a package defines in its `CFDefinitions`. */
  readonly CFItemTypeURI?: LinkURI;
  /** A link to the license of the item, which a package defines in its `CFDefinitions`. */
  readonly licenseURI?: LinkURI;
  /** The date the status began, as an RFC 3339 date. */
  readonly statusStartDate?: string;
  /** The date the status ended or changed, as an RFC 3339 date. */
  readonly statusEndDate?: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/** An item outside a package (Information Model 7.1.14), which also links to the document that it belongs to. */
export interface CFItem extends CFPckgItem {
  /** A link to the document of the item. */
  readonly CFDocumentURI: LinkURI;
}

/**
 * A relationship between two documents or two items, as it is in a package (Information Model 7.1.23): the origin and the
 * destination and the type of the link. An `isChildOf` association gives the framework its tree.
 */
export interface CFPckgAssociation {
  /** The globally unique identifier of the association, a UUID. */
  readonly identifier: string;
  /** The type: a term of CASE or an `ext:` term of a provider. `isTranslationOf` and `ext:` terms are CASE 1.1 only. */
  readonly associationType: AssociationType | ExtensionTerm;
  /** The place of the association among the associations of its origin or destination, which orders a list of children. */
  readonly sequenceNumber?: number;
  /** The network-resolvable URI of the association. */
  readonly uri: string;
  /** The node that the association starts from: for `isChildOf`, the child. */
  readonly originNodeURI: LinkGenURI;
  /** The node that the association points to: for `isChildOf`, the parent. */
  readonly destinationNodeURI: LinkGenURI;
  /** A link to the grouping of the association, which a package defines in its `CFDefinitions`. */
  readonly CFAssociationGroupingURI?: LinkURI;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** A comment on the association. CASE 1.1 only. */
  readonly notes?: string;
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/** An association outside a package (Information Model 7.1.1), which may also link to a document. */
export interface CFAssociation extends CFPckgAssociation {
  /** A link to the document that the association is in the context of. */
  readonly CFDocumentURI?: LinkURI;
}

/** A group of associations (Information Model 7.1.3). */
export interface CFAssociationGrouping {
  /** The globally unique identifier of the grouping, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the grouping. */
  readonly uri: string;
  /** The title of the grouping. */
  readonly title: string;
  /** A description of the grouping. */
  readonly description?: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/** A concept that items are about (Information Model 7.1.6). */
export interface CFConcept {
  /** The globally unique identifier of the concept, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the concept. */
  readonly uri: string;
  /** The title of the concept. */
  readonly title: string;
  /** Keywords of the concept. */
  readonly keywords?: string;
  /** The place of the concept in the hierarchy of concepts, such as `1.2.3`. */
  readonly hierarchyCode: string;
  /** A description of the concept. */
  readonly description?: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/** A subject that a document or an item covers (Information Model 7.1.32). */
export interface CFSubject {
  /** The globally unique identifier of the subject, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the subject. */
  readonly uri: string;
  /** The title of the subject. */
  readonly title: string;
  /** The place of the subject in the hierarchy of subjects, such as `1.2.3`. */
  readonly hierarchyCode: string;
  /** A description of the subject. */
  readonly description?: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/** A license for the use of a framework or an item (Information Model 7.1.19). */
export interface CFLicense {
  /** The globally unique identifier of the license, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the license. */
  readonly uri: string;
  /** The title of the license. */
  readonly title: string;
  /** A description of the license. */
  readonly description?: string;
  /** The text of the license. */
  readonly licenseText: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/** A class of items that a framework uses, such as a standard, a strand or a course code (Information Model 7.1.16). */
export interface CFItemType {
  /** The globally unique identifier of the item type, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the item type. */
  readonly uri: string;
  /** The title of the item type. */
  readonly title: string;
  /** A description of the item type. */
  readonly description: string;
  /** The place of the item type in the hierarchy of item types, such as `1.2.3`. */
  readonly hierarchyCode: string;
  /** The code of the item type, as the promulgating body names it. */
  readonly typeCode?: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/**
 * The definitions that the document and the items of a package refer to (Information Model 7.1.9). Each list holds what the
 * package's links point to, so that the package stands alone.
 */
export interface CFDefinition {
  /** The concepts that the items are about. */
  readonly CFConcepts?: readonly CFConcept[];
  /** The subjects that the document and the items cover. */
  readonly CFSubjects?: readonly CFSubject[];
  /** The licenses of the document and the items. */
  readonly CFLicenses?: readonly CFLicense[];
  /** The item types of the items. */
  readonly CFItemTypes?: readonly CFItemType[];
  /** The groupings of the associations. */
  readonly CFAssociationGroupings?: readonly CFAssociationGrouping[];
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/** A level of a criterion of a rubric: the column of the matrix of a rubric (Information Model 7.1.29). */
export interface CFRubricCriterionLevel {
  /** The globally unique identifier of the level, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the level. */
  readonly uri: string;
  /** A description of the level. */
  readonly description?: string;
  /** The quality that the level stands for, such as `Excellent`. */
  readonly quality?: string;
  /** The score of the level. */
  readonly score?: number;
  /** The feedback that goes with the level. */
  readonly feedback?: string;
  /** The place of the level among the levels of its criterion. */
  readonly position?: number;
  /** The identifier of the criterion that the level is of. */
  readonly rubricCriterionId?: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** Proprietary data, a list of objects in the specification. CASE 1.1 only. */
  readonly extensions?: readonly Extensions[];
}

/** A criterion of a rubric: the row of the matrix of a rubric (Information Model 7.1.27). */
export interface CFRubricCriterion {
  /** The globally unique identifier of the criterion, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the criterion. */
  readonly uri: string;
  /** The category of the criterion. */
  readonly category?: string;
  /** A description of the criterion. */
  readonly description?: string;
  /** A link to the item that the criterion is aligned to. */
  readonly CFItemURI?: LinkURI;
  /** The weight of the criterion in the rubric. */
  readonly weight?: number;
  /** The place of the criterion among the criteria of its rubric. */
  readonly position?: number;
  /** The identifier of the rubric that the criterion is of. */
  readonly rubricId?: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** The levels of the criterion. */
  readonly CFRubricCriterionLevels?: readonly CFRubricCriterionLevel[];
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/**
 * A rubric (Information Model 7.1.26): a matrix whose rows are criteria and whose columns are levels, which says how to
 * tell that a competency is mastered. `description` may hold Markdown or LaTeX.
 */
export interface CFRubric {
  /** The globally unique identifier of the rubric, a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the rubric. */
  readonly uri: string;
  /** The title of the rubric. */
  readonly title?: string;
  /** A description of the rubric. */
  readonly description?: string;
  /** The time of the latest change, as an RFC 3339 date and time. */
  readonly lastChangeDateTime: string;
  /** The criteria of the rubric. */
  readonly CFRubricCriteria?: readonly CFRubricCriterion[];
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}

/**
 * A competency framework package (Information Model 7.1.21): one document and everything that it needs to stand alone, its
 * items, associations, definitions and rubrics.
 *
 * @remarks
 * A package holds the associations of its own document and items, which may point to nodes of other frameworks that it does
 * not hold. An array that is absent is the same as an empty one, which the reader does not change.
 */
export interface CasePackage {
  /** The document of the framework. */
  readonly CFDocument: CFPckgDocument;
  /** The items of the framework. */
  readonly CFItems?: readonly CFPckgItem[];
  /** The associations of the document and the items. */
  readonly CFAssociations?: readonly CFPckgAssociation[];
  /** The definitions that the links of the package point to. */
  readonly CFDefinitions?: CFDefinition;
  /** The rubrics of the framework. */
  readonly CFRubrics?: readonly CFRubric[];
  /** Proprietary data. CASE 1.1 only. */
  readonly extensions?: Extensions;
}
