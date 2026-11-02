/** The terms of the actions of Caliper 1.2 (Appendix D) and of the Library Use Profile, which adds `Accessed` and `Attended`. */
export const ACTIONS = [
  "Abandoned",
  "Accepted",
  "Accessed",
  "Activated",
  "Added",
  "Archived",
  "Attached",
  "Attended",
  "Bookmarked",
  "ChangedResolution",
  "ChangedSize",
  "ChangedSpeed",
  "ChangedVolume",
  "Classified",
  "ClosedPopout",
  "Commented",
  "Completed",
  "Copied",
  "Created",
  "Deactivated",
  "Declined",
  "Deleted",
  "Described",
  "DisabledClosedCaptioning",
  "Disliked",
  "Downloaded",
  "EnabledClosedCaptioning",
  "Ended",
  "EnteredFullScreen",
  "ExitedFullScreen",
  "ForwardedTo",
  "Graded",
  "Hid",
  "Highlighted",
  "Identified",
  "JumpedTo",
  "Launched",
  "Liked",
  "Linked",
  "LoggedIn",
  "LoggedOut",
  "MarkedAsRead",
  "MarkedAsUnread",
  "Modified",
  "Muted",
  "NavigatedTo",
  "OpenedPopout",
  "OptedIn",
  "OptedOut",
  "Paused",
  "Posted",
  "Printed",
  "Published",
  "Questioned",
  "Ranked",
  "Recommended",
  "Removed",
  "Reset",
  "Restarted",
  "Restored",
  "Resumed",
  "Retrieved",
  "Returned",
  "Reviewed",
  "Rewound",
  "Saved",
  "Searched",
  "Sent",
  "Shared",
  "Showed",
  "Skipped",
  "Started",
  "Submitted",
  "Subscribed",
  "Tagged",
  "TimedOut",
  "Unmuted",
  "Unpublished",
  "Unsubscribed",
  "Uploaded",
  "Used",
  "Viewed",
] as const;

/** An action of an event. */
export type CaliperAction = (typeof ACTIONS)[number];

/**
 * The terms of the profiles (Appendix E): the General Profile, the profiles of Caliper 1.2 and the Library Profile, whose
 * examples name it. Appendix E omits the Survey Profile, which section 3 describes and the schemas list.
 */
export const PROFILES = [
  "GeneralProfile",
  "AnnotationProfile",
  "AssessmentProfile",
  "AssignableProfile",
  "FeedbackProfile",
  "ForumProfile",
  "GradingProfile",
  "LibraryProfile",
  "MediaProfile",
  "ReadingProfile",
  "ResourceManagementProfile",
  "SearchProfile",
  "SessionProfile",
  "SurveyProfile",
  "ToolLaunchProfile",
  "ToolUseProfile",
] as const;

/** The profile that governs an event. */
export type CaliperProfile = (typeof PROFILES)[number];

/**
 * The roles of a membership: each of the eight core roles and its sub-roles, written `Role#Subrole`. They are the roles of
 * Appendix F, and `Mentor#Auditor`, which the published context and the schemas define and Appendix F omits.
 */
export const ROLES = [
  "Administrator",
  "Administrator#Administrator",
  "Administrator#Developer",
  "Administrator#ExternalDeveloper",
  "Administrator#ExternalSupport",
  "Administrator#ExternalSystemAdministrator",
  "Administrator#Support",
  "Administrator#SystemAdministrator",
  "ContentDeveloper",
  "ContentDeveloper#ContentDeveloper",
  "ContentDeveloper#ContentExpert",
  "ContentDeveloper#ExternalContentExpert",
  "ContentDeveloper#Librarian",
  "Instructor",
  "Instructor#ExternalInstructor",
  "Instructor#Grader",
  "Instructor#GuestInstructor",
  "Instructor#Instructor",
  "Instructor#Lecturer",
  "Instructor#PrimaryInstructor",
  "Instructor#SecondaryInstructor",
  "Instructor#TeachingAssistant",
  "Instructor#TeachingAssistantGroup",
  "Instructor#TeachingAssistantOffering",
  "Instructor#TeachingAssistantSection",
  "Instructor#TeachingAssistantTemplate",
  "Learner",
  "Learner#ExternalLearner",
  "Learner#GuestLearner",
  "Learner#Learner",
  "Learner#NonCreditLearner",
  "Manager",
  "Manager#AreaManager",
  "Manager#CourseCoordinator",
  "Manager#ExternalObserver",
  "Manager#Manager",
  "Manager#Observer",
  "Member",
  "Member#Member",
  "Mentor",
  "Mentor#Advisor",
  "Mentor#Auditor",
  "Mentor#ExternalAdvisor",
  "Mentor#ExternalAuditor",
  "Mentor#ExternalLearningFacilitator",
  "Mentor#ExternalMentor",
  "Mentor#ExternalReviewer",
  "Mentor#ExternalTutor",
  "Mentor#LearningFacilitator",
  "Mentor#Mentor",
  "Mentor#Reviewer",
  "Mentor#Tutor",
  "Officer",
  "Officer#Chair",
  "Officer#Secretary",
  "Officer#Treasurer",
  "Officer#Vice-Chair",
] as const;

/** A role of a member of an organization. */
export type CaliperRole = (typeof ROLES)[number];

/** The statuses of a membership (Appendix G). */
export const STATUSES = ["Active", "Inactive"] as const;

/** The standing of a member of an organization. */
export type CaliperStatus = (typeof STATUSES)[number];

/** The LTI message types that an `LtiLink` names (Appendix H). */
export const LTI_MESSAGE_TYPES = ["LtiDeepLinkingRequest", "LtiResourceLinkRequest"] as const;

/** The LTI message type by which a link was reached. */
export type LtiMessageType = (typeof LTI_MESSAGE_TYPES)[number];

/** The types of a system identifier: Appendix I, then those of the Library Use Profile. */
export const SYSTEM_IDENTIFIER_TYPES = [
  "AccountUserName",
  "EmailAddress",
  "LisSourcedId",
  "LtiContextId",
  "LtiDeploymentId",
  "LtiPlatformId",
  "LtiToolId",
  "LtiUserId",
  "OneRosterSourcedId",
  "Other",
  "SisSourcedId",
  "SystemId",
  "Barcode",
  "DeweyDecimalCallNumber",
  "DigitalObjectIdentifier",
  "InternationalStandardBookNumber",
  "InternationalStandardSerialNumber",
  "LibGuideID",
  "LibraryCongressCallNumber",
  "OCLCNumber",
  "PubMedID",
  "SuperintendentDocumentsClassification",
] as const;

/** The kind of a system identifier. */
export type SystemIdentifierType = (typeof SYSTEM_IDENTIFIER_TYPES)[number];

/** The metrics of an aggregate measure (Appendix J). */
export const METRICS = [
  "AssessmentsPassed",
  "AssessmentsSubmitted",
  "MinutesOnTask",
  "SkillsMastered",
  "StandardsMastered",
  "UnitsCompleted",
  "UnitsPassed",
  "WordsRead",
] as const;

/** What an aggregate measure counts. */
export type CaliperMetric = (typeof METRICS)[number];

/** The synchronicity of a library activity: how it was meant to be consumed (Library Use Profile 5.2). */
export const SYNCHRONICITIES = ["synchronous", "asynchronous", "both"] as const;

/** How a library activity was meant to be consumed. */
export type Synchronicity = (typeof SYNCHRONICITIES)[number];

/** How a library resource is reached (Library Use Profile 5.3). */
export const ACCESS_FORMS = ["physical", "digital"] as const;

/** Whether a library resource is physical or digital. */
export type AccessForm = (typeof ACCESS_FORMS)[number];

/**
 * The terms of the entities: the generic `Entity`, the entities of Appendix B and C, and those of the Library Use Profile.
 */
export const ENTITY_TYPES = [
  "Entity",
  "Agent",
  "AggregateMeasure",
  "AggregateMeasureCollection",
  "Annotation",
  "Assessment",
  "AssessmentItem",
  "AssignableDigitalResource",
  "Attempt",
  "AudioObject",
  "BookmarkAnnotation",
  "Chapter",
  "Collection",
  "Comment",
  "CourseOffering",
  "CourseSection",
  "DateTimeQuestion",
  "DateTimeResponse",
  "DigitalResource",
  "DigitalResourceCollection",
  "Document",
  "FillinBlankResponse",
  "Forum",
  "Frame",
  "Group",
  "HighlightAnnotation",
  "ImageObject",
  "LearningObjective",
  "Library",
  "LibraryActivity",
  "LibraryResource",
  "LibrarySpace",
  "LikertScale",
  "Link",
  "LtiLink",
  "LtiSession",
  "MediaLocation",
  "MediaObject",
  "Membership",
  "Message",
  "MultipleChoiceResponse",
  "MultipleResponseResponse",
  "MultiselectQuestion",
  "MultiselectResponse",
  "MultiselectScale",
  "NumericScale",
  "OpenEndedQuestion",
  "OpenEndedResponse",
  "Organization",
  "Page",
  "Person",
  "Query",
  "Question",
  "Questionnaire",
  "QuestionnaireItem",
  "Rating",
  "RatingScaleQuestion",
  "RatingScaleResponse",
  "Response",
  "Result",
  "Scale",
  "Score",
  "SearchResponse",
  "SelectTextResponse",
  "Session",
  "SharedAnnotation",
  "SoftwareApplication",
  "Survey",
  "SurveyInvitation",
  "SystemIdentifier",
  "TagAnnotation",
  "TextPositionSelector",
  "Thread",
  "TrueFalseResponse",
  "VideoObject",
  "WebPage",
] as const;

/** The term of an entity type: the `type` of an entity. */
export type CaliperEntityType = (typeof ENTITY_TYPES)[number];

/** The terms of the events that `buildEvent` builds. */
export const EVENT_TYPES = ["AssessmentEvent", "AssessmentItemEvent", "NavigationEvent", "GradeEvent"] as const;

/** The term of an event type: the `type` of an event. */
export type CaliperEventType = (typeof EVENT_TYPES)[number];
