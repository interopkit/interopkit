const LIS = "http://purl.imsglobal.org/vocab/lis/v2";

/** Builds the URIs of a vocabulary from the names that follow its prefix. */
function uris(prefix: string, names: readonly string[]): readonly string[] {
  return names.map((name) => `${prefix}${name}`);
}

/**
 * The system roles of the LIS vocabulary, core and non-core.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec#lis-vocabulary-for-system-roles | LTI 1.3 Core, Appendix A}
 */
export const SYSTEM_ROLES: readonly string[] = uris(`${LIS}/system/person#`, [
  "Administrator",
  "None",
  "AccountAdmin",
  "Creator",
  "SysAdmin",
  "SysSupport",
  "User",
]);

/**
 * The institution roles of the LIS vocabulary, core and non-core.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec#lis-vocabulary-for-institution-roles | LTI 1.3 Core, Appendix A}
 */
export const INSTITUTION_ROLES: readonly string[] = uris(`${LIS}/institution/person#`, [
  "Administrator",
  "Faculty",
  "Guest",
  "None",
  "Other",
  "Staff",
  "Student",
  "Alumni",
  "Instructor",
  "Learner",
  "Member",
  "Mentor",
  "Observer",
  "ProspectiveStudent",
]);

/**
 * The context roles of the LIS vocabulary, core and non-core.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec#lis-vocabulary-for-context-roles | LTI 1.3 Core, Appendix A}
 */
export const CONTEXT_ROLES: readonly string[] = uris(`${LIS}/membership#`, [
  "Administrator",
  "ContentDeveloper",
  "Instructor",
  "Learner",
  "Mentor",
  "Manager",
  "Member",
  "Officer",
]);

/** The sub-roles of each principal context role. */
const SUB_ROLE_NAMES: readonly (readonly [role: string, names: readonly string[]])[] = [
  [
    "Administrator",
    [
      "Administrator",
      "Developer",
      "ExternalDeveloper",
      "ExternalSupport",
      "ExternalSystemAdministrator",
      "Support",
      "SystemAdministrator",
    ],
  ],
  ["ContentDeveloper", ["ContentDeveloper", "ContentExpert", "ExternalContentExpert", "Librarian"]],
  [
    "Instructor",
    [
      "ExternalInstructor",
      "Grader",
      "GuestInstructor",
      "Lecturer",
      "PrimaryInstructor",
      "SecondaryInstructor",
      "TeachingAssistant",
      "TeachingAssistantGroup",
      "TeachingAssistantOffering",
      "TeachingAssistantSection",
      "TeachingAssistantSectionAssociation",
      "TeachingAssistantTemplate",
    ],
  ],
  ["Learner", ["ExternalLearner", "GuestLearner", "Instructor", "Learner", "NonCreditLearner"]],
  ["Manager", ["AreaManager", "CourseCoordinator", "ExternalObserver", "Manager", "Observer"]],
  ["Member", ["Member"]],
  [
    "Mentor",
    [
      "Advisor",
      "Auditor",
      "ExternalAdvisor",
      "ExternalAuditor",
      "ExternalLearningFacilitator",
      "ExternalMentor",
      "ExternalReviewer",
      "ExternalTutor",
      "LearningFacilitator",
      "Mentor",
      "Reviewer",
      "Tutor",
    ],
  ],
  ["Officer", ["Chair", "Communications", "Secretary", "Treasurer", "Vice-Chair"]],
];

/**
 * The sub-roles of the context roles, as `.../membership/{role}#{sub-role}`.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec#context-sub-roles | LTI 1.3 Core, Appendix A}
 */
export const CONTEXT_SUB_ROLES: readonly string[] = SUB_ROLE_NAMES.flatMap(([role, names]) =>
  uris(`${LIS}/membership/${role}#`, names),
);

/**
 * The roles that LTI defines for launches: `TestUser`, a marker that a platform gives beside a real role to a user it made
 * to test with.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec#lti-vocabulary-for-system-roles | LTI 1.3 Core, Appendix A}
 */
export const LTI_SYSTEM_ROLES: readonly string[] = ["http://purl.imsglobal.org/vocab/lti/system/person#TestUser"];

/** The context role of a learner (LTI 1.3 Core Appendix A). */
export const LEARNER_ROLE = `${LIS}/membership#Learner`;
/** The context role of a mentor, which a message needs to carry `role_scope_mentor` (LTI 1.3 Core section 5.4.3). */
export const MENTOR_ROLE = `${LIS}/membership#Mentor`;

/**
 * The context types of the LIS vocabulary.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec#context-type-vocabulary | LTI 1.3 Core, Appendix A}
 */
export const CONTEXT_TYPES: readonly string[] = uris(`${LIS}/course#`, [
  "CourseTemplate",
  "CourseOffering",
  "CourseSection",
  "Group",
]);

const URN_CONTEXT_TYPE = "urn:lti:context-type:ims/lis/";

/** The name that follows the `#` of a URI of a vocabulary. */
function nameOf(uri: string): string {
  return uri.slice(uri.indexOf("#") + 1);
}

const CONTEXT_ROLE_BY_NAME: ReadonlyMap<string, string> = new Map(CONTEXT_ROLES.map((uri) => [nameOf(uri), uri]));
const CONTEXT_TYPE_BY_NAME: ReadonlyMap<string, string> = new Map(
  CONTEXT_TYPES.flatMap((uri) => [
    [nameOf(uri), uri],
    [`${URN_CONTEXT_TYPE}${nameOf(uri)}`, uri],
  ]),
);

/**
 * Returns the URI of a context role that a message names by its deprecated simple name, such as `Instructor`; any other
 * role is returned as it is.
 *
 * @remarks
 * LTI 1.3 recognizes the simple names of context roles for backward compatibility and deprecates them. The model keeps the
 * roles of a message as they were sent, so a host that compares roles calls this first. The deprecated URIs
 * `.../v2/person#...` of system and institution roles are not mapped: the same name exists in both vocabularies, and
 * the URI does not say which.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec#role-vocabularies | LTI 1.3 Core, Appendix A}
 * @param role - A role of a message.
 * @returns The URI of the role, or the role itself when it is not a simple name of a context role.
 */
export function canonicalizeRole(role: string): string {
  return CONTEXT_ROLE_BY_NAME.get(role) ?? role;
}

/**
 * Returns the URI of a context type that a message names by its deprecated simple name or URN, such as `CourseOffering` and
 * `urn:lti:context-type:ims/lis/CourseOffering`; any other type is returned as it is.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec#context-type-vocabulary | LTI 1.3 Core, Appendix A}
 * @param type - A context type of a message.
 * @returns The URI of the type, or the type itself when it is neither.
 */
export function canonicalizeContextType(type: string): string {
  return CONTEXT_TYPE_BY_NAME.get(type) ?? type;
}

const ROLE_VOCABULARY: ReadonlySet<string> = new Set([
  ...SYSTEM_ROLES,
  ...INSTITUTION_ROLES,
  ...CONTEXT_ROLES,
  ...CONTEXT_SUB_ROLES,
  ...LTI_SYSTEM_ROLES,
]);

/** Returns whether a role, after `canonicalizeRole`, is one of the roles of the vocabularies of LTI. */
export function isVocabularyRole(role: string): boolean {
  return ROLE_VOCABULARY.has(canonicalizeRole(role));
}

/** Returns whether a context type, after `canonicalizeContextType`, is one of the context types of the vocabulary. */
export function isVocabularyContextType(type: string): boolean {
  return CONTEXT_TYPES.includes(canonicalizeContextType(type));
}
