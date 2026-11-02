/**
 * The entities of Caliper 1.2 and the Library Use Profile: one interface for each class, the ranges that properties take, and
 * the way an entity is named by an object or an IRI.
 *
 * @module
 */
export type {
  Annotation,
  BookmarkAnnotation,
  HighlightAnnotation,
  SharedAnnotation,
  TagAnnotation,
} from "./annotations.js";
export type {
  AggregateMeasure,
  Assessment,
  AssessmentItem,
  Attempt,
  DateTimeResponse,
  FillinBlankResponse,
  MultipleChoiceResponse,
  MultipleResponseResponse,
  MultiselectResponse,
  OpenEndedResponse,
  RatingScaleResponse,
  Response,
  Result,
  Score,
  SelectTextResponse,
  TrueFalseResponse,
} from "./assessment.js";
export type {
  AggregateMeasureCollection,
  Collection,
  DigitalResourceCollection,
  Forum,
  Questionnaire,
  Survey,
  Thread,
} from "./collections.js";
export type { Entity, Ref } from "./entity.js";
export type { CaliperEntity, EntityOf } from "./entity-map.js";
export type { SystemIdentifier, TextPositionSelector } from "./identifier.js";
export type { LibraryActivity, LibraryResource, LibrarySpace } from "./library.js";
export type {
  Agent,
  CourseOffering,
  CourseSection,
  Group,
  Library,
  LtiSession,
  Membership,
  Organization,
  Person,
  Session,
  SoftwareApplication,
} from "./people.js";
export type {
  Comment,
  DateTimeQuestion,
  LikertScale,
  MultiselectQuestion,
  MultiselectScale,
  NumericScale,
  OpenEndedQuestion,
  Question,
  QuestionnaireItem,
  Rating,
  RatingScaleQuestion,
  Scale,
  SurveyInvitation,
} from "./questionnaire.js";
export {
  AGENT_TYPES,
  ANNOTATION_TYPES,
  type AnyAgent,
  type AnyAnnotation,
  type AnyAssignable,
  type AnyCourseOffering,
  type AnyDigitalResource,
  type AnyMediaObject,
  type AnyOrganization,
  type AnyQuestion,
  type AnyResponse,
  type AnyScale,
  type AnySession,
  ASSIGNABLE_TYPES,
  COURSE_OFFERING_TYPES,
  DIGITAL_RESOURCE_TYPES,
  MEDIA_OBJECT_TYPES,
  ORGANIZATION_TYPES,
  QUESTION_TYPES,
  RESPONSE_TYPES,
  SCALE_TYPES,
  SESSION_TYPES,
} from "./ranges.js";
export type {
  AssignableDigitalResource,
  AudioObject,
  Chapter,
  DigitalResource,
  Document,
  Frame,
  ImageObject,
  LearningObjective,
  Link,
  LtiLink,
  MediaLocation,
  MediaObject,
  Message,
  Page,
  VideoObject,
  WebPage,
} from "./resources.js";
export type { Query, SearchResponse } from "./search.js";
