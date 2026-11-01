/**
 * CASE 1.1 competency frameworks: the model of a framework package and its entities, readers that check them against the
 * 1EdTech schemas and the rules of a package, and the conversion to CASE 1.0.
 *
 * @module @interopkit/competency-frameworks
 */
export {
  ASSOCIATION_TYPES,
  type AssociationType,
  type CaseEntity,
  type CaseEntityKind,
  type CaseIssue,
  type CasePackage,
  type CaseVersion,
  type CFAssociation,
  type CFAssociationGrouping,
  type CFAssociationSet,
  type CFConcept,
  type CFConceptSet,
  type CFDefinition,
  type CFDocument,
  type CFDocumentSet,
  type CFItem,
  type CFItemType,
  type CFItemTypeSet,
  type CFLicense,
  type CFPckgAssociation,
  type CFPckgDocument,
  type CFPckgItem,
  type CFRubric,
  type CFRubricCriterion,
  type CFRubricCriterionLevel,
  type CFSubject,
  type CFSubjectSet,
  ENTITY_KINDS,
  type Extensions,
  type ExtensionTerm,
  type ImsxStatusInfo,
  type LinkGenURI,
  type LinkURI,
  STATUS_CODES_MAJOR,
  STATUS_CODES_MINOR,
  STATUS_SEVERITIES,
  type StatusCodeMajor,
  type StatusCodeMinor,
  type StatusCodeMinorField,
  type StatusCodeMinorValue,
  type StatusSeverity,
  type TargetType,
} from "./model/index.js";
export {
  type ReadOptions,
  readEntity,
  readPackage,
  validateEntity,
  validatePackage,
} from "./read/index.js";
export { type Converted, toCaseVersion, type VersionedValue } from "./version/index.js";
