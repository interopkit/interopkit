import type { CaliperEntityType } from "../internal.js";
import type { EntityOf } from "./entity-map.js";

/** The terms of the agents: `Agent` and its subtypes. A property that takes an agent takes any of them. */
export const AGENT_TYPES = [
  "Agent",
  "CourseOffering",
  "CourseSection",
  "Group",
  "Library",
  "Organization",
  "Person",
  "SoftwareApplication",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the organizations: `Organization` and its subtypes. */
export const ORGANIZATION_TYPES = [
  "CourseOffering",
  "CourseSection",
  "Group",
  "Library",
  "Organization",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the course offerings: `CourseOffering` and `CourseSection`. */
export const COURSE_OFFERING_TYPES = [
  "CourseOffering",
  "CourseSection",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the digital resources: `DigitalResource` and its subtypes. */
export const DIGITAL_RESOURCE_TYPES = [
  "Assessment",
  "AssessmentItem",
  "AssignableDigitalResource",
  "AudioObject",
  "Chapter",
  "DateTimeQuestion",
  "DigitalResource",
  "DigitalResourceCollection",
  "Document",
  "Forum",
  "Frame",
  "ImageObject",
  "LtiLink",
  "MediaLocation",
  "MediaObject",
  "Message",
  "MultiselectQuestion",
  "OpenEndedQuestion",
  "Page",
  "Question",
  "Questionnaire",
  "QuestionnaireItem",
  "RatingScaleQuestion",
  "SurveyInvitation",
  "Thread",
  "VideoObject",
  "WebPage",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the assignable digital resources: `AssignableDigitalResource` and its subtypes. */
export const ASSIGNABLE_TYPES = [
  "Assessment",
  "AssessmentItem",
  "AssignableDigitalResource",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the media objects: `MediaObject` and its subtypes. */
export const MEDIA_OBJECT_TYPES = [
  "AudioObject",
  "ImageObject",
  "MediaObject",
  "VideoObject",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the sessions: `Session` and `LtiSession`. */
export const SESSION_TYPES = ["LtiSession", "Session"] as const satisfies readonly CaliperEntityType[];

/** The terms of the responses: `Response` and its subtypes. */
export const RESPONSE_TYPES = [
  "DateTimeResponse",
  "FillinBlankResponse",
  "MultipleChoiceResponse",
  "MultipleResponseResponse",
  "MultiselectResponse",
  "OpenEndedResponse",
  "RatingScaleResponse",
  "Response",
  "SelectTextResponse",
  "TrueFalseResponse",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the annotations: `Annotation` and its subtypes. */
export const ANNOTATION_TYPES = [
  "Annotation",
  "BookmarkAnnotation",
  "HighlightAnnotation",
  "SharedAnnotation",
  "TagAnnotation",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the questions: `Question` and its subtypes. */
export const QUESTION_TYPES = [
  "DateTimeQuestion",
  "MultiselectQuestion",
  "OpenEndedQuestion",
  "Question",
  "RatingScaleQuestion",
] as const satisfies readonly CaliperEntityType[];

/** The terms of the scales: `Scale` and its subtypes. */
export const SCALE_TYPES = [
  "LikertScale",
  "MultiselectScale",
  "NumericScale",
  "Scale",
] as const satisfies readonly CaliperEntityType[];

/** An agent or any of its subtypes, as an object. */
export type AnyAgent = EntityOf<(typeof AGENT_TYPES)[number]>;

/** An organization or any of its subtypes, as an object. */
export type AnyOrganization = EntityOf<(typeof ORGANIZATION_TYPES)[number]>;

/** A course offering or a course section, as an object. */
export type AnyCourseOffering = EntityOf<(typeof COURSE_OFFERING_TYPES)[number]>;

/** A digital resource or any of its subtypes, as an object. */
export type AnyDigitalResource = EntityOf<(typeof DIGITAL_RESOURCE_TYPES)[number]>;

/** An assignable digital resource or any of its subtypes, as an object. */
export type AnyAssignable = EntityOf<(typeof ASSIGNABLE_TYPES)[number]>;

/** A media object or any of its subtypes, as an object. */
export type AnyMediaObject = EntityOf<(typeof MEDIA_OBJECT_TYPES)[number]>;

/** A session or an LTI session, as an object. */
export type AnySession = EntityOf<(typeof SESSION_TYPES)[number]>;

/** A response or any of its subtypes, as an object. */
export type AnyResponse = EntityOf<(typeof RESPONSE_TYPES)[number]>;

/** An annotation or any of its subtypes, as an object. */
export type AnyAnnotation = EntityOf<(typeof ANNOTATION_TYPES)[number]>;

/** A question or any of its subtypes, as an object. */
export type AnyQuestion = EntityOf<(typeof QUESTION_TYPES)[number]>;

/** A scale or any of its subtypes, as an object. */
export type AnyScale = EntityOf<(typeof SCALE_TYPES)[number]>;
