/**
 * xAPI Profiles 1.0: the model of a profile, its reader and validator, and the validation of Statements against its Statement
 * Templates and Patterns.
 *
 * @module @interopkit/learning-records/profiles
 */
export {
  type ActivityConcept,
  type Concept,
  DOCUMENT_RESOURCE_TYPES,
  type DocumentResourceConcept,
  type DocumentResourceType,
  EXTENSION_CONCEPT_TYPES,
  type ExtensionConcept,
  type ExtensionConceptType,
  type ProfileActivityDefinition,
  type ProfileInteractionComponent,
  VOCABULARY_CONCEPT_TYPES,
  type VocabularyConcept,
  type VocabularyConceptType,
} from "./concepts.js";
export { MAX_JSON_PATH_LENGTH, MAX_JSON_PATH_WALKS } from "./json-path.js";
export type { TemplateOutcome } from "./judge-statement.js";
export { MAX_MATCHED_MEMBERS, MAX_MATCHED_PATTERNS, type PatternOutcome } from "./pattern-match.js";
export { PATTERN_KINDS, type Pattern, type PatternKind } from "./patterns.js";
export {
  ACTIVITY_CONTEXT,
  PROFILE_CONTEXT,
  PROFILES_SPECIFICATION,
  type Profile,
  type ProfileAuthor,
  type ProfileVersion,
  SUBREGISTRATION_EXTENSION,
} from "./profile.js";
export {
  createProfileValidator,
  type PatternVerdict,
  type ProfileValidator,
  type ProfileValidatorOptions,
  type RegistrationVerdict,
  type StatementsVerdict,
  type StatementVerdict,
} from "./profile-validator.js";
export { type ProfileReadOptions, readProfile, validateProfile } from "./read-profile.js";
export { RULE_PRESENCES, type RulePresence, type StatementTemplate, type StatementTemplateRule } from "./templates.js";
