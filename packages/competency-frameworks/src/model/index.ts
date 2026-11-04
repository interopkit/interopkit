/**
 * The model of CASE 1.1: a competency framework package, its entities and sets, the status of an answer, and the findings
 * of the readers. CASE 1.0 is the same model without what 1.1 adds.
 *
 * @module
 */
export type {
  CasePackage,
  CFAssociation,
  CFAssociationGrouping,
  CFConcept,
  CFDefinition,
  CFDocument,
  CFItem,
  CFItemType,
  CFLicense,
  CFPckgAssociation,
  CFPckgDocument,
  CFPckgItem,
  CFRubric,
  CFRubricCriterion,
  CFRubricCriterionLevel,
  CFSubject,
} from "./entities.js";
export type { Extensions } from "./json.js";
export {
  type CaseEntity,
  type CaseEntityKind,
  type CaseEntityMap,
  ENTITY_KINDS,
  SERVED_KINDS,
  type ServedKind,
} from "./kinds.js";
export type { LinkGenURI, LinkURI } from "./links.js";
export type { OpenApiDocument } from "./open-api.js";
export {
  type CaseCondition,
  type CaseFilter,
  type CaseQuery,
  FILTER_PREDICATES,
  type FilterPredicate,
  SORT_ORDERS,
  type SortOrder,
} from "./query.js";
export type { CFAssociationSet, CFConceptSet, CFDocumentSet, CFItemTypeSet, CFSubjectSet } from "./sets.js";
export {
  type ImsxStatusInfo,
  STATUS_CODES_MINOR,
  type StatusCodeMinorValue,
} from "./status-info.js";
export {
  ASSOCIATION_TYPES,
  type AssociationType,
  CASE_VERSIONS,
  type CaseVersion,
  type ExtensionTerm,
  type TargetType,
} from "./terms.js";
