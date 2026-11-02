/**
 * The events of Caliper 1.2 and the Library Use Profile: one interface for each event, and the union of them.
 *
 * @module
 */
export type { Event } from "./event.js";
export type { CaliperEvent, EventInput, EventOf } from "./event-map.js";
export type {
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
