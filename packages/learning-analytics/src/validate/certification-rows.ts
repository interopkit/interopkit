import { ACTIONS, type CaliperAction } from "../model/index.js";
import { entry, type ProfileEntry } from "./profile-entry.js";

const MEDIA_ACTIONS: readonly CaliperAction[] = [
  "ChangedResolution",
  "ChangedSize",
  "ChangedSpeed",
  "ChangedVolume",
  "ClosedPopout",
  "DisabledClosedCaptioning",
  "EnabledClosedCaptioning",
  "Ended",
  "EnteredFullScreen",
  "ExitedFullScreen",
  "ForwardedTo",
  "JumpedTo",
  "Muted",
  "OpenedPopout",
  "Paused",
  "Restarted",
  "Resumed",
  "Started",
  "Unmuted",
];

const RESOURCE_ACTIONS: readonly CaliperAction[] = [
  "Archived",
  "Deleted",
  "Described",
  "Downloaded",
  "Modified",
  "Printed",
  "Published",
  "Restored",
  "Retrieved",
  "Saved",
  "Unpublished",
  "Uploaded",
];

/**
 * The event conformance tables of the certification guide for the profiles of Caliper 1.2: one entry for each event and what its
 * actions share. They allow what the tables of section 3 do not in a few cells (the guide names a wider object for navigation and
 * viewing, and the action `Reset` of an assessment), so an event that fits only these is a warning.
 */
export const CERTIFICATION_ROWS: readonly ProfileEntry[] = [
  entry("GeneralProfile", "Event", ACTIONS, { actor: ["Agent"], object: ["Entity"] }),
  entry("AnnotationProfile", "AnnotationEvent", ["Bookmarked"], {
    object: ["DigitalResource"],
    generated: ["BookmarkAnnotation"],
  }),
  entry("AnnotationProfile", "AnnotationEvent", ["Highlighted"], {
    object: ["DigitalResource"],
    generated: ["HighlightAnnotation"],
  }),
  entry("AnnotationProfile", "AnnotationEvent", ["Shared"], {
    object: ["DigitalResource"],
    generated: ["SharedAnnotation"],
  }),
  entry("AnnotationProfile", "AnnotationEvent", ["Tagged"], {
    object: ["DigitalResource"],
    generated: ["TagAnnotation"],
  }),
  entry("AssessmentProfile", "AssessmentEvent", ["Paused", "Reset", "Restarted", "Resumed", "Started", "Submitted"], {
    object: ["Assessment"],
    generated: ["Attempt"],
  }),
  entry("AssessmentProfile", "AssessmentItemEvent", ["Completed"], {
    object: ["AssessmentItem"],
    generated: ["Response"],
  }),
  entry("AssessmentProfile", "AssessmentItemEvent", ["Skipped"], { object: ["AssessmentItem"] }),
  entry("AssessmentProfile", "AssessmentItemEvent", ["Started"], {
    object: ["AssessmentItem"],
    generated: ["Attempt"],
  }),
  entry("AssessmentProfile", "NavigationEvent", ["NavigatedTo"], { object: ["DigitalResource"] }),
  entry("AssessmentProfile", "ViewEvent", ["Viewed"], { object: ["DigitalResource"] }),
  entry("AssignableProfile", "AssignableEvent", ["Activated", "Deactivated"], {
    object: ["AssignableDigitalResource"],
  }),
  entry("AssignableProfile", "AssignableEvent", ["Completed", "Reviewed", "Started", "Submitted"], {
    object: ["AssignableDigitalResource"],
    generated: ["Attempt"],
  }),
  entry("AssignableProfile", "NavigationEvent", ["NavigatedTo"], { object: ["DigitalResource"] }),
  entry("AssignableProfile", "ViewEvent", ["Viewed"], { object: ["DigitalResource"] }),
  entry("FeedbackProfile", "FeedbackEvent", ["Commented", "Ranked"], { object: ["Entity"] }),
  entry("ForumProfile", "ForumEvent", ["Subscribed", "Unsubscribed"], { object: ["Forum"] }),
  entry("ForumProfile", "MessageEvent", ["MarkedAsRead", "MarkedAsUnread", "Posted"], { object: ["Message"] }),
  entry("ForumProfile", "ThreadEvent", ["MarkedAsRead", "MarkedAsUnread"], { object: ["Thread"] }),
  entry("ForumProfile", "NavigationEvent", ["NavigatedTo"], { object: ["DigitalResource"] }),
  entry("ForumProfile", "ViewEvent", ["Viewed"], { object: ["DigitalResource"] }),
  entry("GradingProfile", "GradeEvent", ["Graded"], { actor: ["Agent"], object: ["Attempt"], generated: ["Score"] }),
  entry("GradingProfile", "ViewEvent", ["Viewed"], { actor: ["Agent"], object: ["Result"] }),
  entry("MediaProfile", "MediaEvent", MEDIA_ACTIONS, { object: ["MediaObject"] }),
  entry("MediaProfile", "NavigationEvent", ["NavigatedTo"], { object: ["DigitalResource"] }),
  entry("MediaProfile", "ViewEvent", ["Viewed"], { object: ["DigitalResource"] }),
  entry("ReadingProfile", "NavigationEvent", ["NavigatedTo"], { object: ["DigitalResource"] }),
  entry("ReadingProfile", "ViewEvent", ["Viewed"], { object: ["DigitalResource"] }),
  entry("ResourceManagementProfile", "ResourceManagementEvent", RESOURCE_ACTIONS, { object: ["DigitalResource"] }),
  entry("ResourceManagementProfile", "ResourceManagementEvent", ["Copied", "Created"], {
    object: ["DigitalResource"],
    generated: ["DigitalResource"],
  }),
  entry("SearchProfile", "SearchEvent", ["Searched"], { object: ["DigitalResource"] }),
  entry("SessionProfile", "SessionEvent", ["LoggedIn", "LoggedOut"], { object: ["SoftwareApplication"] }),
  entry("SessionProfile", "SessionEvent", ["TimedOut"], { actor: ["SoftwareApplication"], object: ["Session"] }),
  entry("SurveyProfile", "SurveyInvitationEvent", ["Accepted", "Declined", "Sent"], { object: ["SurveyInvitation"] }),
  entry("SurveyProfile", "SurveyEvent", ["OptedIn", "OptedOut"], { object: ["Survey"] }),
  entry("SurveyProfile", "QuestionnaireEvent", ["Started", "Submitted"], {
    object: ["Questionnaire"],
    generated: ["Attempt"],
  }),
  entry("SurveyProfile", "QuestionnaireItemEvent", ["Completed"], {
    object: ["QuestionnaireItem"],
    generated: ["Response"],
  }),
  entry("SurveyProfile", "QuestionnaireItemEvent", ["Skipped", "Started"], {
    object: ["QuestionnaireItem"],
    generated: ["Attempt"],
  }),
  entry("SurveyProfile", "NavigationEvent", ["NavigatedTo"], { object: ["Questionnaire"] }),
  entry("SurveyProfile", "ViewEvent", ["Viewed"], { object: ["Questionnaire"] }),
  entry("ToolLaunchProfile", "ToolLaunchEvent", ["Launched", "Returned"], { object: ["SoftwareApplication"] }),
  entry("ToolUseProfile", "ToolUseEvent", ["Used"], { object: ["SoftwareApplication"] }),
];
