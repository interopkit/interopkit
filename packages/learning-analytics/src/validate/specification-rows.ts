import { ACTIONS, type CaliperAction } from "../model/index.js";
import { entry, type ProfileEntry } from "./profile-entry.js";

const MEDIA_ACTIONS: readonly CaliperAction[] = [
  "Started",
  "Ended",
  "Paused",
  "Resumed",
  "Restarted",
  "ForwardedTo",
  "JumpedTo",
  "ChangedResolution",
  "ChangedSize",
  "ChangedSpeed",
  "ChangedVolume",
  "EnabledClosedCaptioning",
  "DisabledClosedCaptioning",
  "EnteredFullScreen",
  "ExitedFullScreen",
  "Muted",
  "Unmuted",
  "OpenedPopout",
  "ClosedPopout",
];

const RESOURCE_ACTIONS: readonly CaliperAction[] = [
  "Created",
  "Modified",
  "Deleted",
  "Described",
  "Downloaded",
  "Uploaded",
  "Retrieved",
  "Printed",
  "Published",
  "Unpublished",
  "Archived",
  "Restored",
  "Saved",
];

/**
 * The tables of the profiles of section 3 of Caliper 1.2, and of the Library Use Profile: one entry for each event and what its
 * actions share, so that the rows of a table are the actions of its entries. `advised` is the sentence of a profile that says a
 * generated entity SHOULD be given.
 */
export const SPECIFICATION_ROWS: readonly ProfileEntry[] = [
  entry("AnnotationProfile", "AnnotationEvent", ["Bookmarked"], {
    object: ["DigitalResource"],
    generated: ["BookmarkAnnotation"],
    advised: true,
  }),
  entry("AnnotationProfile", "AnnotationEvent", ["Highlighted"], {
    object: ["DigitalResource"],
    generated: ["HighlightAnnotation"],
    advised: true,
  }),
  entry("AnnotationProfile", "AnnotationEvent", ["Shared"], {
    object: ["DigitalResource"],
    generated: ["SharedAnnotation"],
    advised: true,
  }),
  entry("AnnotationProfile", "AnnotationEvent", ["Tagged"], {
    object: ["DigitalResource"],
    generated: ["TagAnnotation"],
    advised: true,
  }),
  entry("AssessmentProfile", "AssessmentEvent", ["Started", "Paused", "Resumed", "Restarted", "Submitted"], {
    object: ["Assessment"],
    generated: ["Attempt"],
    advised: true,
  }),
  entry("AssessmentProfile", "AssessmentItemEvent", ["Started", "Skipped"], {
    object: ["AssessmentItem"],
    generated: ["Attempt"],
  }),
  entry("AssessmentProfile", "AssessmentItemEvent", ["Completed"], {
    object: ["AssessmentItem"],
    generated: ["Response"],
  }),
  entry("AssessmentProfile", "NavigationEvent", ["NavigatedTo"], { object: ["Assessment", "AssessmentItem"] }),
  entry("AssessmentProfile", "ViewEvent", ["Viewed"], { object: ["Assessment", "AssessmentItem"] }),
  entry("AssignableProfile", "AssignableEvent", ["Activated", "Deactivated"], {
    object: ["AssignableDigitalResource"],
  }),
  entry("AssignableProfile", "AssignableEvent", ["Started", "Completed", "Submitted", "Reviewed"], {
    object: ["AssignableDigitalResource"],
    generated: ["Attempt"],
    advised: true,
  }),
  entry("AssignableProfile", "NavigationEvent", ["NavigatedTo"], { object: ["AssignableDigitalResource"] }),
  entry("AssignableProfile", "ViewEvent", ["Viewed"], { object: ["AssignableDigitalResource"] }),
  entry("FeedbackProfile", "FeedbackEvent", ["Commented"], {
    object: ["Entity"],
    generated: ["Comment"],
    advised: true,
  }),
  entry("FeedbackProfile", "FeedbackEvent", ["Ranked"], { object: ["Entity"], generated: ["Rating"], advised: true }),
  entry("ForumProfile", "ForumEvent", ["Subscribed", "Unsubscribed"], { object: ["Forum"] }),
  entry("ForumProfile", "ThreadEvent", ["MarkedAsRead", "MarkedAsUnread"], { object: ["Thread"] }),
  entry("ForumProfile", "MessageEvent", ["MarkedAsRead", "MarkedAsUnread", "Posted"], { object: ["Message"] }),
  entry("ForumProfile", "NavigationEvent", ["NavigatedTo"], { object: ["Forum", "Message", "Thread"] }),
  entry("ForumProfile", "ViewEvent", ["Viewed"], { object: ["Forum", "Message", "Thread"] }),
  entry("GradingProfile", "GradeEvent", ["Graded"], {
    actor: ["Agent"],
    object: ["Attempt"],
    generated: ["Score"],
    advised: true,
  }),
  entry("GradingProfile", "ViewEvent", ["Viewed"], { object: ["Result"] }),
  entry("MediaProfile", "MediaEvent", MEDIA_ACTIONS, { object: ["MediaObject"], target: ["MediaLocation"] }),
  entry("MediaProfile", "NavigationEvent", ["NavigatedTo"], { object: ["MediaObject"], target: ["MediaLocation"] }),
  entry("MediaProfile", "ViewEvent", ["Viewed"], { object: ["MediaObject"], target: ["MediaLocation"] }),
  entry("ReadingProfile", "NavigationEvent", ["NavigatedTo"], {
    object: ["DigitalResource"],
    target: ["DigitalResource"],
  }),
  entry("ReadingProfile", "ViewEvent", ["Viewed"], { object: ["DigitalResource"], target: ["DigitalResource"] }),
  entry("ResourceManagementProfile", "ResourceManagementEvent", RESOURCE_ACTIONS, { object: ["DigitalResource"] }),
  entry("ResourceManagementProfile", "ResourceManagementEvent", ["Copied"], {
    object: ["DigitalResource"],
    generated: ["DigitalResource"],
    advised: true,
  }),
  entry("SearchProfile", "SearchEvent", ["Searched"], {
    object: ["DigitalResource", "SoftwareApplication"],
    generated: ["SearchResponse"],
    advised: true,
  }),
  entry("SessionProfile", "SessionEvent", ["LoggedIn"], {
    object: ["SoftwareApplication"],
    target: ["DigitalResource"],
  }),
  entry("SessionProfile", "SessionEvent", ["LoggedOut"], { object: ["SoftwareApplication"] }),
  entry("SessionProfile", "SessionEvent", ["TimedOut"], { actor: ["SoftwareApplication"], object: ["Session"] }),
  entry("SurveyProfile", "SurveyInvitationEvent", ["Sent", "Accepted", "Declined"], { object: ["SurveyInvitation"] }),
  entry("SurveyProfile", "SurveyEvent", ["OptedIn", "OptedOut"], { object: ["Survey"] }),
  entry("SurveyProfile", "QuestionnaireEvent", ["Started", "Submitted"], {
    object: ["Questionnaire"],
    generated: ["Attempt"],
    advised: true,
  }),
  entry("SurveyProfile", "QuestionnaireItemEvent", ["Started", "Skipped"], {
    object: ["QuestionnaireItem"],
    generated: ["Attempt"],
  }),
  entry("SurveyProfile", "QuestionnaireItemEvent", ["Completed"], {
    object: ["QuestionnaireItem"],
    generated: ["Response"],
  }),
  entry("SurveyProfile", "NavigationEvent", ["NavigatedTo"], { object: ["Questionnaire", "QuestionnaireItem"] }),
  entry("SurveyProfile", "ViewEvent", ["Viewed"], { object: ["Questionnaire", "QuestionnaireItem"] }),
  entry("ToolLaunchProfile", "ToolLaunchEvent", ["Launched", "Returned"], {
    object: ["SoftwareApplication"],
    generated: ["DigitalResource"],
    target: ["Link", "LtiLink"],
  }),
  entry("ToolUseProfile", "ToolUseEvent", ["Used"], {
    object: ["SoftwareApplication"],
    generated: ["AggregateMeasureCollection"],
  }),
  entry("GeneralProfile", "Event", ACTIONS, { actor: ["Agent"], object: ["Entity"] }),
  entry("LibraryProfile", "LibraryUseEvent", ["Used"], { object: ["Library", "LibrarySpace"] }),
  entry("LibraryProfile", "LibraryResourceUseEvent", ["Accessed"], { object: ["LibraryResource", "DigitalResource"] }),
  entry("LibraryProfile", "LibraryParticipationEvent", ["Attended"], { object: ["LibraryActivity"] }),
];
