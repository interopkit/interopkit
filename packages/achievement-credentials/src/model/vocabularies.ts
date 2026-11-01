/**
 * The vocabularies of Open Badges 3.0, CLR 2.0 and the 1EdTech APIs. Each is a `const` tuple, and its type is derived from it.
 *
 * @module
 */

/**
 * The achievement types that Open Badges defines for `Achievement.achievementType` (OB B.1.28), open to `ext:` terms.
 */
export const ACHIEVEMENT_TYPES = [
  "Achievement",
  "ApprenticeshipCertificate",
  "Assessment",
  "Assignment",
  "AssociateDegree",
  "Award",
  "Badge",
  "BachelorDegree",
  "Certificate",
  "CertificateOfCompletion",
  "Certification",
  "CommunityService",
  "Competency",
  "Course",
  "CoCurricular",
  "Degree",
  "Diploma",
  "DoctoralDegree",
  "Fieldwork",
  "GeneralEducationDevelopment",
  "JourneymanCertificate",
  "LearningProgram",
  "License",
  "Membership",
  "ProfessionalDoctorate",
  "QualityAssuranceCredential",
  "MasterCertificate",
  "MasterDegree",
  "MicroCredential",
  "ResearchDoctorate",
  "SecondarySchoolDiploma",
] as const;

/** A term of `ACHIEVEMENT_TYPES`. */
export type AchievementType = (typeof ACHIEVEMENT_TYPES)[number];

/** The kinds of target that an `Alignment` names (OB B.1.29), open to `ext:` terms. */
export const ALIGNMENT_TARGET_TYPES = [
  "ceasn:Competency",
  "ceterms:Credential",
  "CFItem",
  "CFRubric",
  "CFRubricCriterion",
  "CFRubricCriterionLevel",
  "CTDL",
] as const;

/** A term of `ALIGNMENT_TARGET_TYPES`. */
export type AlignmentTargetType = (typeof ALIGNMENT_TARGET_TYPES)[number];

/** The kinds of identifier of `IdentityObject` and `IdentifierEntry` (OB B.1.30), open to `ext:` terms. */
export const IDENTIFIER_TYPES = [
  "name",
  "sourcedId",
  "systemId",
  "productId",
  "userName",
  "accountId",
  "emailAddress",
  "nationalIdentityNumber",
  "isbn",
  "issn",
  "lisSourcedId",
  "oneRosterSourcedId",
  "sisSourcedId",
  "ltiContextId",
  "ltiDeploymentId",
  "ltiToolId",
  "ltiPlatformId",
  "ltiUserId",
  "identifier",
] as const;

/** A term of `IDENTIFIER_TYPES`. */
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** The kinds of result that a `ResultDescription` describes (OB B.1.31), open to `ext:` terms. */
export const RESULT_TYPES = [
  "GradePointAverage",
  "LetterGrade",
  "Percent",
  "PerformanceLevel",
  "PredictedScore",
  "RawScore",
  "Result",
  "RubricCriterion",
  "RubricCriterionLevel",
  "RubricScore",
  "ScaledScore",
  "Status",
] as const;

/** A term of `RESULT_TYPES`. */
export type ResultType = (typeof RESULT_TYPES)[number];

/** The statuses of a `Result` (OB B.1.32). */
export const RESULT_STATUS_TYPES = [
  "Completed",
  "Enrolled",
  "Failed",
  "InProgress",
  "OnHold",
  "Provisional",
  "Withdrew",
] as const;

/** A term of `RESULT_STATUS_TYPES`. */
export type ResultStatusType = (typeof RESULT_STATUS_TYPES)[number];

/** The ways in which a CLR associates two achievements (CLR B.1.4). */
export const ASSOCIATION_TYPES = [
  "exactMatchOf",
  "isChildOf",
  "isParentOf",
  "isPartOf",
  "isPeerOf",
  "isRelatedTo",
  "precedes",
  "replacedBy",
] as const;

/** A term of `ASSOCIATION_TYPES`. */
export type AssociationType = (typeof ASSOCIATION_TYPES)[number];

/** The outcomes of a request as a whole (OB B.3.2). */
export const STATUS_CODES_MAJOR = ["failure", "processing", "success", "unsupported"] as const;

/** A term of `STATUS_CODES_MAJOR`. */
export type StatusCodeMajor = (typeof STATUS_CODES_MAJOR)[number];

/** How serious an outcome is (OB B.3.3). */
export const STATUS_SEVERITIES = ["error", "status", "warning"] as const;

/** A term of `STATUS_SEVERITIES`. */
export type StatusSeverity = (typeof STATUS_SEVERITIES)[number];

/** The details that an API gives for a field of a request (OB B.3.6). */
export const STATUS_CODES_MINOR = [
  "forbidden",
  "fullsuccess",
  "internal_server_error",
  "invalid_data",
  "invalid_query_parameter",
  "misdirected_request",
  "not_acceptable",
  "not_allowed",
  "not_found",
  "not_modified",
  "server_busy",
  "unauthorizedrequest",
  "unknown",
] as const;

/** A term of `STATUS_CODES_MINOR`. */
export type StatusCodeMinorValue = (typeof STATUS_CODES_MINOR)[number];

/** The errors of an OAuth 2.0 authorization response that the Open Badges API names (OB B.5.1, RFC 6749, 4.1.2.1). */
export const AUTHORIZATION_ERRORS = [
  "invalid_request",
  "unauthorized_client",
  "access_denied",
  "unsupported_response_type",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
] as const;

/** A term of `AUTHORIZATION_ERRORS`. */
export type AuthorizationError = (typeof AUTHORIZATION_ERRORS)[number];

/** The errors of a dynamic client registration that the Open Badges API names (OB B.5.2, RFC 7591, 3.2.2). */
export const REGISTRATION_ERRORS = [
  "invalid_redirect_uri",
  "invalid_client_metadata",
  "invalid_software_statement",
  "unapproved_software_statement",
] as const;

/** A term of `REGISTRATION_ERRORS`. */
export type RegistrationError = (typeof REGISTRATION_ERRORS)[number];

/** The errors of an OAuth 2.0 token response that the Open Badges API names (OB B.5.3, RFC 6749, 5.2). */
export const TOKEN_ERRORS = [
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "unsupported_token_type",
  "invalid_scope",
] as const;

/** A term of `TOKEN_ERRORS`. */
export type TokenError = (typeof TOKEN_ERRORS)[number];

/**
 * A term that an issuer adds to an extensible vocabulary: `ext:` and a name of letters, digits, `.`, `|` and `_` (OB C.2).
 */
export type ExtensionTerm = `ext:${string}`;
