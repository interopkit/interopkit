/**
 * The names and vocabularies of the messages of LTI: the claim names, the message types, the scopes, the approved
 * algorithms and the role and context type vocabularies of LTI 1.3 Core Appendix A.
 *
 * @module
 */
export { APPROVED_ALGORITHMS, type JwsAlgorithm } from "./algorithms.js";
export {
  LTI_VERSION,
  MESSAGE_TYPES,
  type MessageType,
  PLATFORM_MESSAGE_TYPES,
  TOOL_MESSAGE_TYPES,
} from "./message-types.js";
export { CLAIM } from "./names.js";
export {
  BOOLEAN,
  type Claims,
  CUSTOM_RECORD,
  HTTPS_URL,
  IDENTIFIER,
  MAX_IDENTIFIER_LENGTH,
  NON_EMPTY_STRING,
  NULLABLE_STRING,
  NUMBER,
  optional,
  POSITIVE_NUMBER,
  required,
  requiredFrom,
  STRING,
  STRING_ARRAY,
  STRING_RECORD,
} from "./schemas.js";
export { SCOPES } from "./scopes.js";
export {
  CONTEXT_ROLES,
  CONTEXT_SUB_ROLES,
  CONTEXT_TYPES,
  canonicalizeContextType,
  canonicalizeRole,
  INSTITUTION_ROLES,
  isVocabularyContextType,
  isVocabularyRole,
  LEARNER_ROLE,
  LTI_SYSTEM_ROLES,
  MENTOR_ROLE,
  SYSTEM_ROLES,
} from "./vocabularies.js";
