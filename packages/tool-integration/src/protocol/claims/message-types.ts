/**
 * The values of the `message_type` claim of the five messages that a platform sends and a tool reads (LTI 1.3 Core section
 * 5.3.1, Deep Linking 2.0, Submission Review 1.0, Proctoring Services 1.0).
 */
export const PLATFORM_MESSAGE_TYPES = [
  "LtiResourceLinkRequest",
  "LtiDeepLinkingRequest",
  "LtiSubmissionReviewRequest",
  "LtiStartProctoring",
  "LtiEndAssessment",
] as const;

/** The values of the `message_type` claim of the two messages that a tool sends and a platform reads. */
export const TOOL_MESSAGE_TYPES = ["LtiDeepLinkingResponse", "LtiStartAssessment"] as const;

/** The values of the `message_type` claim that the packages model: the seven messages of both directions. */
export const MESSAGE_TYPES = [...PLATFORM_MESSAGE_TYPES, ...TOOL_MESSAGE_TYPES] as const;

/** A value of the `message_type` claim that the packages model. */
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** The version of LTI that the messages say: `1.3.0` (LTI 1.3 Core section 5.3.2). */
export const LTI_VERSION = "1.3.0";
