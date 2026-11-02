/**
 * The contexts of the extension profiles of Caliper 1.1, each of which extends the context of Caliper 1.1 with the terms of one
 * profile: the Feedback, Resource Management, Search, Survey, Tool Launch and Tool Use profiles. A document names the context of
 * its profile as its last context, where a document of the core profiles names the context of Caliper 1.1.
 *
 * @see {@link https://github.com/1EdTech/caliper-spec/tree/60f7cb7398eeabe76dd0a916c53280af0e78f9d5/contexts/v1p1 | The contexts of Caliper 1.1}
 */
export const EXTENSION_CONTEXTS_1_1 = [
  "http://purl.imsglobal.org/ctx/caliper/v1p1/FeedbackProfile-extension",
  "http://purl.imsglobal.org/ctx/caliper/v1p1/ResourceManagementProfile-extension",
  "http://purl.imsglobal.org/ctx/caliper/v1p1/SearchProfile-extension",
  "http://purl.imsglobal.org/ctx/caliper/v1p1/SurveyProfile-extension",
  "http://purl.imsglobal.org/ctx/caliper/v1p1/ToolLaunchProfile-extension",
  "http://purl.imsglobal.org/ctx/caliper/v1p1/ToolUseProfile-extension",
] as const;
