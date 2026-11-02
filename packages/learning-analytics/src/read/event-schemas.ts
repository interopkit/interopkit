import { describe, isRecord, jsonObjectSchema, type Schema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  ACTIONS,
  AGENT_TYPES,
  ANNOTATION_TYPES,
  ASSIGNABLE_TYPES,
  type CaliperAction,
  type CaliperEntityType,
  type CaliperEvent,
  type CaliperEventType,
  COURSE_OFFERING_TYPES,
  DIGITAL_RESOURCE_TYPES,
  ENTITY_TYPES,
  EVENT_TYPES,
  type EventOf,
  MEDIA_OBJECT_TYPES,
  ORGANIZATION_TYPES,
  PROFILES,
  RESPONSE_TYPES,
  SESSION_TYPES,
} from "../model/index.js";
import { contextSchema } from "./context.js";
import { to } from "./entity-schemas.js";
import { term, text, time, urn } from "./primitives.js";

/** The schemas of the events, by the term of their type. */
export type EventSchemas = { readonly [TType in CaliperEventType]: Schema<EventOf<TType>> };

/** What an event of a profile says of its properties: the actions, and the classes that each entity property takes. */
interface EventShape<
  TActions extends readonly CaliperAction[],
  TActor extends readonly CaliperEntityType[],
  TObject extends readonly CaliperEntityType[],
  TTarget extends readonly CaliperEntityType[],
  TGenerated extends readonly CaliperEntityType[],
  TReferrer extends readonly CaliperEntityType[],
> {
  /** The actions that the event allows. */
  readonly actions: TActions;
  /** The classes that may act. */
  readonly actor: TActor;
  /** The classes that may be acted on. */
  readonly object: TObject;
  /** The classes of the target. */
  readonly target: TTarget;
  /** The classes of the entity that the action makes. */
  readonly generated: TGenerated;
  /** The classes of the referrer. */
  readonly referrer: TReferrer;
}

/**
 * Makes the schema of an event: the properties that every event has, with the ranges and the actions of the event, and the
 * properties of its profile.
 *
 * @param type - The term of the event's type.
 * @param shape - The actions and the classes of the entity properties.
 * @param extra - The entries of the properties that only this event has.
 */
function eventRecord<
  const TType extends CaliperEventType,
  const TActions extends readonly [CaliperAction, ...CaliperAction[]],
  const TActor extends readonly CaliperEntityType[],
  const TObject extends readonly CaliperEntityType[],
  const TTarget extends readonly CaliperEntityType[],
  const TGenerated extends readonly CaliperEntityType[],
  const TReferrer extends readonly CaliperEntityType[],
  const TExtra extends v.ObjectEntries,
>(type: TType, shape: EventShape<TActions, TActor, TObject, TTarget, TGenerated, TReferrer>, extra: TExtra) {
  return strictRecord({
    "@context": contextSchema,
    id: urn,
    type: v.literal(type),
    profile: v.optional(term(PROFILES, "a profile")),
    actor: to(shape.actor),
    action: term(shape.actions, "an action"),
    object: to(shape.object),
    eventTime: time,
    edApp: v.optional(to(["SoftwareApplication"])),
    generated: v.optional(to(shape.generated)),
    target: v.optional(to(shape.target)),
    referrer: v.optional(to(shape.referrer)),
    group: v.optional(to(ORGANIZATION_TYPES)),
    membership: v.optional(to(["Membership"])),
    session: v.optional(to(SESSION_TYPES)),
    federatedSession: v.optional(to(["LtiSession"])),
    extensions: v.optional(jsonObjectSchema),
    ...extra,
  });
}

const ANY = ENTITY_TYPES;
const PERSON = ["Person"] as const;
const APPLICATION = ["SoftwareApplication"] as const;
const RESOURCE_OR_APPLICATION = [...DIGITAL_RESOURCE_TYPES, "SoftwareApplication"] as const;
const NONE = {} as const;

/** The schemas of the events that Caliper 1.2 and the Library Use Profile define. */
export const EVENT_SCHEMAS = {
  Event: eventRecord(
    "Event",
    { actions: ACTIONS, actor: AGENT_TYPES, object: ANY, target: ANY, generated: ANY, referrer: ANY },
    NONE,
  ),
  AnnotationEvent: eventRecord(
    "AnnotationEvent",
    {
      actions: ["Bookmarked", "Highlighted", "Shared", "Tagged"],
      actor: PERSON,
      object: DIGITAL_RESOURCE_TYPES,
      target: ["Frame"],
      generated: ANNOTATION_TYPES,
      referrer: ANY,
    },
    NONE,
  ),
  AssessmentEvent: eventRecord(
    "AssessmentEvent",
    {
      actions: ["Started", "Paused", "Resumed", "Restarted", "Reset", "Submitted"],
      actor: PERSON,
      object: ["Assessment"],
      target: ANY,
      generated: ["Attempt"],
      referrer: ANY,
    },
    NONE,
  ),
  AssessmentItemEvent: eventRecord(
    "AssessmentItemEvent",
    {
      actions: ["Started", "Skipped", "Completed"],
      actor: PERSON,
      object: ["AssessmentItem"],
      target: ANY,
      generated: [...RESPONSE_TYPES, "Attempt"],
      referrer: ["AssessmentItem"],
    },
    NONE,
  ),
  AssignableEvent: eventRecord(
    "AssignableEvent",
    {
      actions: ["Activated", "Deactivated", "Started", "Completed", "Submitted", "Reviewed"],
      actor: PERSON,
      object: ASSIGNABLE_TYPES,
      target: ["Frame"],
      generated: ["Attempt"],
      referrer: ANY,
    },
    NONE,
  ),
  FeedbackEvent: eventRecord(
    "FeedbackEvent",
    {
      actions: ["Commented", "Ranked"],
      actor: PERSON,
      object: ANY,
      target: ["Frame"],
      generated: ["Rating", "Comment"],
      referrer: ANY,
    },
    NONE,
  ),
  ForumEvent: eventRecord(
    "ForumEvent",
    {
      actions: ["Subscribed", "Unsubscribed"],
      actor: PERSON,
      object: ["Forum"],
      target: ANY,
      generated: ANY,
      referrer: ANY,
    },
    NONE,
  ),
  GradeEvent: eventRecord(
    "GradeEvent",
    { actions: ["Graded"], actor: AGENT_TYPES, object: ["Attempt"], target: ANY, generated: ["Score"], referrer: ANY },
    NONE,
  ),
  MediaEvent: eventRecord(
    "MediaEvent",
    {
      actions: [
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
      ],
      actor: PERSON,
      object: MEDIA_OBJECT_TYPES,
      target: ["MediaLocation"],
      generated: ANY,
      referrer: ANY,
    },
    NONE,
  ),
  MessageEvent: eventRecord(
    "MessageEvent",
    {
      actions: ["MarkedAsRead", "MarkedAsUnread", "Posted"],
      actor: PERSON,
      object: ["Message"],
      target: ANY,
      generated: ANY,
      referrer: ANY,
    },
    NONE,
  ),
  NavigationEvent: eventRecord(
    "NavigationEvent",
    {
      actions: ["NavigatedTo"],
      actor: PERSON,
      object: RESOURCE_OR_APPLICATION,
      target: DIGITAL_RESOURCE_TYPES,
      generated: ANY,
      referrer: RESOURCE_OR_APPLICATION,
    },
    NONE,
  ),
  QuestionnaireEvent: eventRecord(
    "QuestionnaireEvent",
    {
      actions: ["Started", "Submitted"],
      actor: PERSON,
      object: ["Questionnaire"],
      target: ANY,
      generated: ANY,
      referrer: ANY,
    },
    NONE,
  ),
  QuestionnaireItemEvent: eventRecord(
    "QuestionnaireItemEvent",
    {
      actions: ["Started", "Skipped", "Completed"],
      actor: PERSON,
      object: ["QuestionnaireItem"],
      target: ANY,
      generated: RESPONSE_TYPES,
      referrer: ANY,
    },
    NONE,
  ),
  ResourceManagementEvent: v.pipe(
    eventRecord(
      "ResourceManagementEvent",
      {
        actions: [
          "Archived",
          "Copied",
          "Created",
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
        ],
        actor: PERSON,
        object: DIGITAL_RESOURCE_TYPES,
        target: ANY,
        generated: DIGITAL_RESOURCE_TYPES,
        referrer: ANY,
      },
      NONE,
    ),
    v.forward(
      v.check(
        (event) => event.action !== "Copied" || event.generated !== undefined,
        "the event needs the resource that the Copied action made",
      ),
      ["generated"],
    ),
  ),
  SearchEvent: eventRecord(
    "SearchEvent",
    { actions: ["Searched"], actor: PERSON, object: ANY, target: ANY, generated: ["SearchResponse"], referrer: ANY },
    NONE,
  ),
  SessionEvent: eventRecord(
    "SessionEvent",
    {
      actions: ["LoggedIn", "LoggedOut", "TimedOut"],
      actor: [...PERSON, ...APPLICATION],
      object: [...SESSION_TYPES, ...APPLICATION],
      target: DIGITAL_RESOURCE_TYPES,
      generated: ANY,
      referrer: RESOURCE_OR_APPLICATION,
    },
    NONE,
  ),
  SurveyEvent: eventRecord(
    "SurveyEvent",
    { actions: ["OptedIn", "OptedOut"], actor: PERSON, object: ["Survey"], target: ANY, generated: ANY, referrer: ANY },
    NONE,
  ),
  SurveyInvitationEvent: eventRecord(
    "SurveyInvitationEvent",
    {
      actions: ["Accepted", "Declined", "Sent"],
      actor: PERSON,
      object: ["SurveyInvitation"],
      target: ANY,
      generated: ANY,
      referrer: ANY,
    },
    NONE,
  ),
  ThreadEvent: eventRecord(
    "ThreadEvent",
    {
      actions: ["MarkedAsRead", "MarkedAsUnread"],
      actor: PERSON,
      object: ["Thread"],
      target: ANY,
      generated: ANY,
      referrer: ANY,
    },
    NONE,
  ),
  ToolLaunchEvent: v.pipe(
    eventRecord(
      "ToolLaunchEvent",
      {
        actions: ["Launched", "Returned"],
        actor: PERSON,
        object: APPLICATION,
        target: ["Link", "LtiLink"],
        generated: DIGITAL_RESOURCE_TYPES,
        referrer: ANY,
      },
      NONE,
    ),
    v.forward(
      v.check(
        (event) => event.action !== "Launched" || event.federatedSession !== undefined,
        "the event needs the session of the platform that the Launched action comes from",
      ),
      ["federatedSession"],
    ),
  ),
  ToolUseEvent: eventRecord(
    "ToolUseEvent",
    {
      actions: ["Used"],
      actor: PERSON,
      object: APPLICATION,
      target: APPLICATION,
      generated: ["AggregateMeasureCollection"],
      referrer: ANY,
    },
    NONE,
  ),
  ViewEvent: eventRecord(
    "ViewEvent",
    { actions: ["Viewed"], actor: PERSON, object: DIGITAL_RESOURCE_TYPES, target: ANY, generated: ANY, referrer: ANY },
    NONE,
  ),
  LibraryUseEvent: eventRecord(
    "LibraryUseEvent",
    {
      actions: ["Used"],
      actor: PERSON,
      object: ["Library", "LibrarySpace"],
      target: ANY,
      generated: ANY,
      referrer: ANY,
    },
    { presenceDerivedFromSource: v.optional(text), presenceDerivedFromID: v.optional(text) },
  ),
  LibraryResourceUseEvent: eventRecord(
    "LibraryResourceUseEvent",
    {
      actions: ["Accessed"],
      actor: PERSON,
      object: ["LibraryResource", ...DIGITAL_RESOURCE_TYPES],
      target: ANY,
      generated: ANY,
      referrer: ANY,
    },
    { accessLocation: v.optional(text), forCourse: v.optional(to(COURSE_OFFERING_TYPES)) },
  ),
  LibraryParticipationEvent: eventRecord(
    "LibraryParticipationEvent",
    { actions: ["Attended"], actor: PERSON, object: ["LibraryActivity"], target: ANY, generated: ANY, referrer: ANY },
    {
      participationMode: v.optional(text),
      forCourse: v.optional(to(COURSE_OFFERING_TYPES)),
      arrivalTime: v.optional(time),
    },
  ),
} satisfies EventSchemas;

/** The schema of an event, of any class, chosen by its `type`. */
export const eventSchema: Schema<CaliperEvent> = v.lazy((input) => {
  const type = isRecord(input) ? input.type : undefined;
  const found = EVENT_TYPES.find((name) => name === type);
  if (found !== undefined) return EVENT_SCHEMAS[found];
  return v.never(
    `expected an event of any class, found ${isRecord(input) ? "an object whose type is not that of an event" : describe(input)}`,
  );
});
