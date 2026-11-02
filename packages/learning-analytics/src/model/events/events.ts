import type {
  AggregateMeasureCollection,
  AnyAgent,
  AnyAnnotation,
  AnyAssignable,
  AnyCourseOffering,
  AnyDigitalResource,
  AnyMediaObject,
  AnyResponse,
  AnySession,
  Assessment,
  AssessmentItem,
  Attempt,
  CaliperEntity,
  Comment,
  Forum,
  Frame,
  Library,
  LibraryActivity,
  LibraryResource,
  LibrarySpace,
  Link,
  LtiLink,
  MediaLocation,
  Message,
  Person,
  Questionnaire,
  QuestionnaireItem,
  Rating,
  Ref,
  Score,
  SearchResponse,
  SoftwareApplication,
  Survey,
  SurveyInvitation,
  Thread,
} from "../entities/index.js";
import type { Event } from "./event.js";

/** An event of the Annotation Profile: a person annotates a digital resource (Caliper 1.2 A.1). */
export interface AnnotationEvent
  extends Event<
    "AnnotationEvent",
    "Bookmarked" | "Highlighted" | "Shared" | "Tagged",
    Person,
    AnyDigitalResource,
    Frame,
    AnyAnnotation
  > {}

/** An event of the Assessment Profile: a person works on an assessment (Caliper 1.2 A.2). */
export interface AssessmentEvent
  extends Event<
    "AssessmentEvent",
    "Started" | "Paused" | "Resumed" | "Restarted" | "Reset" | "Submitted",
    Person,
    Assessment,
    CaliperEntity,
    Attempt
  > {}

/** An event of the Assessment Profile: a person works on one item of an assessment (Caliper 1.2 A.3). */
export interface AssessmentItemEvent
  extends Event<
    "AssessmentItemEvent",
    "Started" | "Skipped" | "Completed",
    Person,
    AssessmentItem,
    CaliperEntity,
    AnyResponse | Attempt,
    AssessmentItem
  > {}

/** An event of the Assignable Profile: a person works on a resource that was assigned (Caliper 1.2 A.4). */
export interface AssignableEvent
  extends Event<
    "AssignableEvent",
    "Activated" | "Deactivated" | "Started" | "Completed" | "Submitted" | "Reviewed",
    Person,
    AnyAssignable,
    Frame,
    Attempt
  > {}

/** An event of the Feedback Profile: a person comments on or ranks an entity (Caliper 1.2 A.5). */
export interface FeedbackEvent
  extends Event<"FeedbackEvent", "Commented" | "Ranked", Person, CaliperEntity, Frame, Rating | Comment> {}

/** An event of the Forum Profile: a person subscribes to a forum or leaves it (Caliper 1.2 A.6). */
export interface ForumEvent extends Event<"ForumEvent", "Subscribed" | "Unsubscribed", Person, Forum> {}

/** An event of the Grading Profile: an agent grades an attempt (Caliper 1.2 A.7). */
export interface GradeEvent extends Event<"GradeEvent", "Graded", AnyAgent, Attempt, CaliperEntity, Score> {}

/** An event of the Media Profile: a person plays or changes a media object (Caliper 1.2 A.8). */
export interface MediaEvent
  extends Event<
    "MediaEvent",
    | "Started"
    | "Ended"
    | "Paused"
    | "Resumed"
    | "Restarted"
    | "ForwardedTo"
    | "JumpedTo"
    | "ChangedResolution"
    | "ChangedSize"
    | "ChangedSpeed"
    | "ChangedVolume"
    | "EnabledClosedCaptioning"
    | "DisabledClosedCaptioning"
    | "EnteredFullScreen"
    | "ExitedFullScreen"
    | "Muted"
    | "Unmuted"
    | "OpenedPopout"
    | "ClosedPopout",
    Person,
    AnyMediaObject,
    MediaLocation
  > {}

/** An event of the Forum Profile: a person posts a message or marks one as read or unread (Caliper 1.2 A.9). */
export interface MessageEvent
  extends Event<"MessageEvent", "MarkedAsRead" | "MarkedAsUnread" | "Posted", Person, Message> {}

/** An event of the Reading Profile: an actor goes from one digital resource to another (Caliper 1.2 A.10). */
export interface NavigationEvent
  extends Event<
    "NavigationEvent",
    "NavigatedTo",
    Person,
    AnyDigitalResource | SoftwareApplication,
    AnyDigitalResource,
    CaliperEntity,
    AnyDigitalResource | SoftwareApplication
  > {}

/** An event of the Survey Profile: a person starts or submits a questionnaire (Caliper 1.2 A.11). */
export interface QuestionnaireEvent
  extends Event<"QuestionnaireEvent", "Started" | "Submitted", Person, Questionnaire> {}

/** An event of the Survey Profile: a person works on one item of a questionnaire (Caliper 1.2 A.12). */
export interface QuestionnaireItemEvent
  extends Event<
    "QuestionnaireItemEvent",
    "Started" | "Skipped" | "Completed",
    Person,
    QuestionnaireItem,
    CaliperEntity,
    AnyResponse
  > {}

/** An event of the Resource Management Profile: a person manages a digital resource (Caliper 1.2 A.13). */
export interface ResourceManagementEvent
  extends Event<
    "ResourceManagementEvent",
    | "Archived"
    | "Copied"
    | "Created"
    | "Deleted"
    | "Described"
    | "Downloaded"
    | "Modified"
    | "Printed"
    | "Published"
    | "Restored"
    | "Retrieved"
    | "Saved"
    | "Unpublished"
    | "Uploaded",
    Person,
    AnyDigitalResource,
    CaliperEntity,
    AnyDigitalResource
  > {}

/** An event of the Search Profile: a person queries a resource (Caliper 1.2 A.14). */
export interface SearchEvent
  extends Event<"SearchEvent", "Searched", Person, CaliperEntity, CaliperEntity, SearchResponse> {}

/** An event of the Session Profile: a session starts or ends (Caliper 1.2 A.15). */
export interface SessionEvent
  extends Event<
    "SessionEvent",
    "LoggedIn" | "LoggedOut" | "TimedOut",
    Person | SoftwareApplication,
    AnySession | SoftwareApplication,
    AnyDigitalResource,
    CaliperEntity,
    AnyDigitalResource | SoftwareApplication
  > {}

/** An event of the Survey Profile: a person takes part in a survey or declines (Caliper 1.2 A.16). */
export interface SurveyEvent extends Event<"SurveyEvent", "OptedIn" | "OptedOut", Person, Survey> {}

/** An event of the Survey Profile: a survey invitation is sent, accepted or declined (Caliper 1.2 A.17). */
export interface SurveyInvitationEvent
  extends Event<"SurveyInvitationEvent", "Accepted" | "Declined" | "Sent", Person, SurveyInvitation> {}

/** An event of the Forum Profile: a person marks a thread as read or unread (Caliper 1.2 A.18). */
export interface ThreadEvent extends Event<"ThreadEvent", "MarkedAsRead" | "MarkedAsUnread", Person, Thread> {}

/**
 * An event of the Tool Launch Profile: a person launches a tool, or returns from it (Caliper 1.2 A.19). The session of the
 * platform is required when the action is `Launched`.
 */
export interface ToolLaunchEvent
  extends Event<
    "ToolLaunchEvent",
    "Launched" | "Returned",
    Person,
    SoftwareApplication,
    Link | LtiLink,
    AnyDigitalResource
  > {}

/** An event of the Tool Use Profile: a person uses a tool (Caliper 1.2 A.20). */
export interface ToolUseEvent
  extends Event<"ToolUseEvent", "Used", Person, SoftwareApplication, SoftwareApplication, AggregateMeasureCollection> {}

/** An event of the Reading Profile: a person looks at a digital resource (Caliper 1.2 A.21). */
export interface ViewEvent extends Event<"ViewEvent", "Viewed", Person, AnyDigitalResource> {}

/** An event of the Library Use Profile: a person uses a library or a part of it (Library Use Profile 3.1). */
export interface LibraryUseEvent extends Event<"LibraryUseEvent", "Used", Person, Library | LibrarySpace> {
  /** The source from which the presence in the library is derived, such as wifi, reservation or swipe card. */
  readonly presenceDerivedFromSource?: string;
  /** The identifier of that source, such as the address of a router or of a swipe machine. */
  // biome-ignore lint/style/useNamingConvention: the Library Use Profile spells the property so.
  readonly presenceDerivedFromID?: string;
}

/** An event of the Library Use Profile: a person uses a resource of a library (Library Use Profile 3.2). */
export interface LibraryResourceUseEvent
  extends Event<"LibraryResourceUseEvent", "Accessed", Person, LibraryResource | AnyDigitalResource> {
  /** Where the person was when the resource was reached, such as on campus or off campus. */
  readonly accessLocation?: string;
  /** The course offering or section for which the resource was reached. */
  readonly forCourse?: Ref<AnyCourseOffering>;
}

/** An event of the Library Use Profile: a person takes part in an activity of a library (Library Use Profile 3.3). */
export interface LibraryParticipationEvent
  extends Event<"LibraryParticipationEvent", "Attended", Person, LibraryActivity> {
  /** How the person took part, such as online or in person. */
  readonly participationMode?: string;
  /** The course offering or section for which the person took part. */
  readonly forCourse?: Ref<AnyCourseOffering>;
  /** When the person arrived, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly arrivalTime?: string;
}
