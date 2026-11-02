import type { CaliperEventType } from "../internal.js";
import type { Event } from "./event.js";
import type {
  AnnotationEvent,
  AssessmentEvent,
  AssessmentItemEvent,
  AssignableEvent,
  FeedbackEvent,
  ForumEvent,
  GradeEvent,
  LibraryParticipationEvent,
  LibraryResourceUseEvent,
  LibraryUseEvent,
  MediaEvent,
  MessageEvent,
  NavigationEvent,
  QuestionnaireEvent,
  QuestionnaireItemEvent,
  ResourceManagementEvent,
  SearchEvent,
  SessionEvent,
  SurveyEvent,
  SurveyInvitationEvent,
  ThreadEvent,
  ToolLaunchEvent,
  ToolUseEvent,
  ViewEvent,
} from "./events.js";

/** Any event that Caliper 1.2 and the Library Use Profile define, as an object. */
export type CaliperEvent =
  | Event
  | AnnotationEvent
  | AssessmentEvent
  | AssessmentItemEvent
  | AssignableEvent
  | FeedbackEvent
  | ForumEvent
  | GradeEvent
  | LibraryParticipationEvent
  | LibraryResourceUseEvent
  | LibraryUseEvent
  | MediaEvent
  | MessageEvent
  | NavigationEvent
  | QuestionnaireEvent
  | QuestionnaireItemEvent
  | ResourceManagementEvent
  | SearchEvent
  | SessionEvent
  | SurveyEvent
  | SurveyInvitationEvent
  | ThreadEvent
  | ToolLaunchEvent
  | ToolUseEvent
  | ViewEvent;

/** The event whose `type` is the term. */
export type EventOf<TType extends CaliperEventType> = Extract<
  CaliperEvent,
  {
    /** The term of the event's type. */
    readonly type: TType;
  }
>;

/** What `buildEvent` takes: an event without its `@context`, which the builder writes. */
export type EventInput = CaliperEvent extends infer TEvent
  ? TEvent extends CaliperEvent
    ? Omit<TEvent, "@context">
    : never
  : never;
