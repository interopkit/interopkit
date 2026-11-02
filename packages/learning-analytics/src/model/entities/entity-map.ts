import type { CaliperEntityType } from "../internal.js";
import type {
  Annotation,
  BookmarkAnnotation,
  HighlightAnnotation,
  SharedAnnotation,
  TagAnnotation,
} from "./annotations.js";
import type {
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
import type {
  AggregateMeasureCollection,
  Collection,
  DigitalResourceCollection,
  Forum,
  Questionnaire,
  Survey,
  Thread,
} from "./collections.js";
import type { Entity } from "./entity.js";
import type { SystemIdentifier, TextPositionSelector } from "./identifier.js";
import type { LibraryActivity, LibraryResource, LibrarySpace } from "./library.js";
import type {
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
import type {
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
import type {
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
import type { Query, SearchResponse } from "./search.js";

/** Any entity that Caliper 1.2 and the Library Use Profile define, as an object. */
export type CaliperEntity =
  | Entity
  | Agent
  | AggregateMeasure
  | AggregateMeasureCollection
  | Annotation
  | Assessment
  | AssessmentItem
  | AssignableDigitalResource
  | Attempt
  | AudioObject
  | BookmarkAnnotation
  | Chapter
  | Collection
  | Comment
  | CourseOffering
  | CourseSection
  | DateTimeQuestion
  | DateTimeResponse
  | DigitalResource
  | DigitalResourceCollection
  | Document
  | FillinBlankResponse
  | Forum
  | Frame
  | Group
  | HighlightAnnotation
  | ImageObject
  | LearningObjective
  | Library
  | LibraryActivity
  | LibraryResource
  | LibrarySpace
  | LikertScale
  | Link
  | LtiLink
  | LtiSession
  | MediaLocation
  | MediaObject
  | Membership
  | Message
  | MultipleChoiceResponse
  | MultipleResponseResponse
  | MultiselectQuestion
  | MultiselectResponse
  | MultiselectScale
  | NumericScale
  | OpenEndedQuestion
  | OpenEndedResponse
  | Organization
  | Page
  | Person
  | Query
  | Question
  | Questionnaire
  | QuestionnaireItem
  | Rating
  | RatingScaleQuestion
  | RatingScaleResponse
  | Response
  | Result
  | Scale
  | Score
  | SearchResponse
  | SelectTextResponse
  | Session
  | SharedAnnotation
  | SoftwareApplication
  | Survey
  | SurveyInvitation
  | SystemIdentifier
  | TagAnnotation
  | TextPositionSelector
  | Thread
  | TrueFalseResponse
  | VideoObject
  | WebPage;

/** The entity whose `type` is one of the terms, as an object. */
export type EntityOf<TType extends CaliperEntityType> = Extract<
  CaliperEntity,
  {
    /** The term of the entity's type. */
    readonly type: TType;
  }
>;
