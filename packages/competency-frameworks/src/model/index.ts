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
export type { CaseIssue } from "./issue.js";
export type { Extensions } from "./json.js";
export { type CaseEntity, type CaseEntityKind, ENTITY_KINDS } from "./kinds.js";
export type { LinkGenURI, LinkURI } from "./links.js";
export type { CFAssociationSet, CFConceptSet, CFDocumentSet, CFItemTypeSet, CFSubjectSet } from "./sets.js";
export {
  type ImsxStatusInfo,
  STATUS_CODES_MAJOR,
  STATUS_CODES_MINOR,
  STATUS_SEVERITIES,
  type StatusCodeMajor,
  type StatusCodeMinor,
  type StatusCodeMinorField,
  type StatusCodeMinorValue,
  type StatusSeverity,
} from "./status-info.js";
export {
  ASSOCIATION_TYPES,
  type AssociationType,
  type CaseVersion,
  type ExtensionTerm,
  type TargetType,
} from "./terms.js";
