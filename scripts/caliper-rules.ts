/**
 * The rules of the profiles of Caliper 1.2 that a validator of events applies and that its tables do not print: one entry for each
 * sentence of section 3 of the specification and of the certification guide, each with an event that breaks it and what a
 * validator finds in that event.
 *
 * The entries are written from the sentences, and not from the code that judges events: the tests of the package change a sound
 * event with `fixture` and compare what `validateEvent` finds with `findings`. The rules that the profile tables print as rows are
 * compared with the pinned tables themselves (`scripts/caliper-tables.ts`), so this list holds the rest.
 */
import { all, remove, set } from "./xapi-rules.ts";

/** A JSON object, such as an event. */
export type Json = Record<string, unknown>;

/** What a validator finds: where, which rule and how serious. */
interface ExpectedFinding {
  readonly path: string;
  readonly rule: string;
  readonly severity: "error" | "warning";
}

/** A sentence of the specification, an event that breaks it, and every finding that a validator makes in that event. */
export interface CaliperRule {
  /** The place of the sentence, such as `Caliper 1.2, 3.2 Assessment Profile`. */
  readonly source: string;
  /** What the specification says, in its words or shortened. */
  readonly text: string;
  /** Changes the sound event into one that breaks the rule. It does not change its argument. */
  readonly fixture: (event: Json) => Json;
  /** Every finding of `validateEvent`, in order. */
  readonly findings: readonly ExpectedFinding[];
}

const error = (path: string, rule: string): ExpectedFinding => ({ path, rule, severity: "error" });
const warning = (path: string, rule: string): ExpectedFinding => ({ path, rule, severity: "warning" });

const PERSON = { id: "https://example.edu/users/554433", type: "Person" };
const APPLICATION = { id: "https://example.edu", type: "SoftwareApplication" };
const ASSESSMENT = "https://example.edu/terms/201601/courses/7/sections/1/assess/1";

/** An event that follows every rule: a candidate starts an assessment, with an attempt that has what a profile advises. */
export const SOUND_EVENT: Json = {
  "@context": "http://purl.imsglobal.org/ctx/caliper/v1p2",
  id: "urn:uuid:3a648e68-f00d-4c08-aa59-8738e1884f2c",
  type: "AssessmentEvent",
  profile: "AssessmentProfile",
  actor: PERSON,
  action: "Started",
  object: { id: ASSESSMENT, type: "Assessment" },
  generated: {
    id: `${ASSESSMENT}/users/554433/attempts/1`,
    type: "Attempt",
    assignee: PERSON.id,
    assignable: ASSESSMENT,
    count: 1,
  },
  eventTime: "2016-11-15T10:15:00.000Z",
};

/** The same, as an event that another class makes: the class, its profile, and the action, actor and object of a first row. */
const event = (type: string, profile: string, action: string, actor: unknown, object: unknown, more: Json = {}) =>
  all(
    set("type", type),
    set("profile", profile),
    set("action", action),
    set("actor", actor),
    set("object", object),
    remove("generated"),
    ...Object.entries(more).map(([name, value]) => set(name, value)),
  );

const SESSION = { id: "https://example.edu/sessions/1", type: "Session" };
const SESSION_FULL = {
  ...SESSION,
  user: PERSON.id,
  startedAtTime: "2016-11-15T10:00:00.000Z",
  endedAtTime: "2016-11-15T10:15:00.000Z",
  duration: "PT15M",
};
const LOCATION = { id: "https://example.edu/videos/1/location", type: "MediaLocation", currentTime: "PT30S" };
const VIDEO = { id: "https://example.edu/videos/1", type: "VideoObject" };
const DOCUMENT = { id: "https://example.edu/documents/1", type: "Document" };
const ATTEMPT = {
  id: `${ASSESSMENT}/attempts/9`,
  type: "Attempt",
  assignee: PERSON.id,
  assignable: ASSESSMENT,
  count: 1,
};

/** The rules that the tables do not print. */
export const RULES: readonly CaliperRule[] = [
  {
    source: "Caliper 1.2, 3.2 Assessment Profile",
    text: "Although optional, the governing profile SHOULD also be specified.",
    fixture: remove("profile"),
    findings: [warning("profile", "profile-missing")],
  },
  {
    source: "Caliper 1.2, 3.15 General Profile",
    text: "Only the generic Event may be utilized [with the General Profile].",
    fixture: set("profile", "GeneralProfile"),
    findings: [error("profile", "profile-event")],
  },
  {
    source: "Caliper 1.2, 3 Profiles",
    text: "Each Event type included in a profile place constraints on the various entities and actions that can be utilized.",
    fixture: set("profile", "ForumProfile"),
    findings: [error("profile", "profile-event")],
  },
  {
    source: "Certification guide, 3.4.2 Event Conformance Table of the Assessment Profile",
    text: "An AssessmentEvent allows the action Reset, which the table of section 3.2 does not list.",
    fixture: set("action", "Reset"),
    findings: [warning("action", "profile-action")],
  },
  {
    source: "Certification guide, 3.4.2 Event Conformance Table of the Assessment Profile",
    text: "A NavigationEvent in the Assessment Profile has a DigitalResource as its object, where section 3.2 names an Assessment or an AssessmentItem.",
    fixture: event("NavigationEvent", "AssessmentProfile", "NavigatedTo", PERSON, DOCUMENT),
    findings: [warning("object", "profile-object")],
  },
  {
    source: "Caliper 1.2, 3.2 Assessment Profile",
    text: "A NavigationEvent in the Assessment Profile has an Assessment or an AssessmentItem as its object.",
    fixture: event("NavigationEvent", "AssessmentProfile", "NavigatedTo", PERSON, APPLICATION),
    findings: [error("object", "profile-object")],
  },
  {
    source: "Caliper 1.2, 3.11 Session Profile",
    text: "For LoggedIn and LoggedOut actions, a Person MUST be specified as the actor.",
    fixture: event("SessionEvent", "SessionProfile", "LoggedIn", APPLICATION, APPLICATION),
    findings: [error("actor", "profile-actor")],
  },
  {
    source: "Caliper 1.2, 3.11 Session Profile",
    text: "For a TimedOut action, a SoftwareApplication MUST be specified as the actor.",
    fixture: event("SessionEvent", "SessionProfile", "TimedOut", PERSON, SESSION_FULL),
    findings: [error("actor", "profile-actor")],
  },
  {
    source: "Caliper 1.2, 3.11 Session Profile",
    text: "For a TimedOut action, the Session MUST be specified as the object.",
    fixture: event("SessionEvent", "SessionProfile", "TimedOut", APPLICATION, APPLICATION),
    findings: [error("object", "profile-object")],
  },
  {
    source: "Caliper 1.2, 3.11 Session Profile",
    text: "If a Session is expressed as an object, the user, startedAtTime, endedAtTime, and duration property values SHOULD be provided.",
    fixture: event("SessionEvent", "SessionProfile", "TimedOut", APPLICATION, SESSION),
    findings: [
      warning("object", "property-advised"),
      warning("object", "property-advised"),
      warning("object", "property-advised"),
      warning("object", "property-advised"),
    ],
  },
  {
    source: "Caliper 1.2, 3.2 Assessment Profile",
    text: "For AssessmentEvent actions, the generated Attempt SHOULD be specified.",
    fixture: remove("generated"),
    findings: [warning("generated", "generated-missing")],
  },
  {
    source: "Caliper 1.2, 3.2 Assessment Profile",
    text: "If an Attempt is expressed as an object the Attempt SHOULD define, at a minimum, the assignee, the assignable, and the count.",
    fixture: set("generated", { id: ATTEMPT.id, type: "Attempt" }),
    findings: [
      warning("generated", "property-advised"),
      warning("generated", "property-advised"),
      warning("generated", "property-advised"),
    ],
  },
  {
    source: "Caliper 1.2, 3.1 Annotation Profile",
    text: "Pair the action with the appropriate Annotation subtype (e.g., Bookmarked with BookmarkAnnotation).",
    fixture: event("AnnotationEvent", "AnnotationProfile", "Bookmarked", PERSON, DOCUMENT, {
      generated: { id: "https://example.edu/annotations/1", type: "TagAnnotation" },
    }),
    findings: [warning("generated", "generated-class")],
  },
  {
    source: "Caliper 1.2, 3.1 Annotation Profile",
    text: "In particular, a generated Annotation SHOULD be expressed.",
    fixture: event("AnnotationEvent", "AnnotationProfile", "Highlighted", PERSON, DOCUMENT),
    findings: [warning("generated", "generated-missing")],
  },
  {
    source: "Caliper 1.2, 3.6 Grading Profile",
    text: "When describing a Graded action, the generated Score SHOULD be specified.",
    fixture: event("GradeEvent", "GradingProfile", "Graded", APPLICATION, { id: ATTEMPT.id, type: "Attempt" }),
    findings: [warning("generated", "generated-missing")],
  },
  {
    source: "Caliper 1.2, 3.6 Grading Profile",
    text: "If the generated Score is expressed as an object the attempt, maxScore, and scoreGiven property values SHOULD be provided.",
    fixture: event(
      "GradeEvent",
      "GradingProfile",
      "Graded",
      APPLICATION,
      { id: ATTEMPT.id, type: "Attempt" },
      {
        generated: { id: "https://example.edu/scores/1", type: "Score" },
      },
    ),
    findings: [
      warning("generated", "property-advised"),
      warning("generated", "property-advised"),
      warning("generated", "property-advised"),
    ],
  },
  {
    source: "Caliper 1.2, 3.7 Media Profile",
    text: "For other MediaEvent supported actions the MediaLocation currentTime value MUST be set to the location in the audio or video stream where the action occurred.",
    fixture: event("MediaEvent", "MediaProfile", "Muted", PERSON, VIDEO, {
      target: { id: LOCATION.id, type: "MediaLocation" },
    }),
    findings: [error("target", "media-location-time")],
  },
  {
    source: "Caliper 1.2, 3.7 Media Profile",
    text: "A MediaLocation MAY be specified as the target in order to indicate the current playback position in an audio or video stream.",
    fixture: event("NavigationEvent", "MediaProfile", "NavigatedTo", PERSON, VIDEO, {
      target: { id: "https://example.edu/videos/1/frame", type: "Frame" },
    }),
    findings: [warning("target", "target-class")],
  },
  {
    source: "Caliper 1.2, 3.15 General Profile",
    text: "Use of the General Profile is strictly limited to describing interactions not modeled by the current set of Caliper Profiles.",
    fixture: event("Event", "GeneralProfile", "Created", PERSON, DOCUMENT),
    findings: [warning("type", "general-profile-modeled")],
  },
  {
    source: "Caliper 1.2, 3.15 General Profile",
    text: "Any of the Caliper actions described in this specification can be used to describe the interaction between the actor and the object.",
    fixture: event("Event", "GeneralProfile", "Abandoned", APPLICATION, DOCUMENT),
    findings: [],
  },
];

/** A sentence of the specification that is about an entity describe, an entity that breaks it, and what a validator finds. */
export interface EntityRule {
  /** The place of the sentence. */
  readonly source: string;
  /** What the specification says, in its words or shortened. */
  readonly text: string;
  /** The entity describe that breaks the rule. */
  readonly entity: Json;
  /** Every finding of `validateEntity`, in order. */
  readonly findings: readonly ExpectedFinding[];
}

const CONTEXT = "http://purl.imsglobal.org/ctx/caliper/v1p2";

/** The rules about the entities that a profile advises to define. */
export const ENTITY_RULES: readonly EntityRule[] = [
  {
    source: "Caliper 1.2, 3.2 Assessment Profile",
    text: "If an Attempt is expressed as an object the Attempt SHOULD define, at a minimum, the assignee, the assignable, and the count.",
    entity: { "@context": CONTEXT, id: ATTEMPT.id, type: "Attempt" },
    findings: [warning("", "property-advised"), warning("", "property-advised"), warning("", "property-advised")],
  },
  {
    source: "Caliper 1.2, 3.2 Assessment Profile",
    text: "An Attempt that defines the assignee, the assignable, and the count is as the profile advises.",
    entity: { "@context": CONTEXT, ...ATTEMPT },
    findings: [],
  },
  {
    source: "Caliper 1.2, 3.6 Grading Profile",
    text: "If the generated Score is expressed as an object the attempt, maxScore, and scoreGiven property values SHOULD be provided.",
    entity: { "@context": CONTEXT, id: "https://example.edu/scores/1", type: "Score", maxScore: 25 },
    findings: [warning("", "property-advised"), warning("", "property-advised")],
  },
  {
    source: "Caliper 1.2, 3.6 Grading Profile",
    text: "If a Result is expressed as an object the attempt, maxResultScore, and resultScore property values SHOULD be provided.",
    entity: { "@context": CONTEXT, id: "https://example.edu/results/1", type: "Result", resultScore: 20 },
    findings: [warning("", "property-advised"), warning("", "property-advised")],
  },
];
