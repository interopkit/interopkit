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
  type CaliperVersion,
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
import { contextSchemaOf } from "./context.js";
import { term, text, time, urn } from "./primitives.js";
import type { RangeFactory } from "./range.js";
import { definesClass, restrictToVersion, retiredNote } from "./version.js";

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
 * @param to - Makes the schema of a range of entities, and says which version of Caliper the event is read in.
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
>(
  to: RangeFactory,
  type: TType,
  shape: EventShape<TActions, TActor, TObject, TTarget, TGenerated, TReferrer>,
  extra: TExtra,
) {
  const record = strictRecord({
    "@context": contextSchemaOf(to.version),
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
  return restrictToVersion(to.version, type, record);
}

const ANY = ENTITY_TYPES;
const PERSON = ["Person"] as const;
const FRAME = ["Frame"] as const;
const APPLICATION = ["SoftwareApplication"] as const;
const RESOURCE_OR_APPLICATION = [...DIGITAL_RESOURCE_TYPES, "SoftwareApplication"] as const;
const NONE = {} as const;

/**
 * Makes the schemas of the events that Caliper 1.2 and the Library Use Profile define, as a version of Caliper reads them.
 *
 * @param to - Makes the schema of a range of entities, and says which version of Caliper the events are read in.
 */
export function createEventSchemas(to: RangeFactory) {
  return {
    Event: eventRecord(
      to,
      "Event",
      { actions: ACTIONS, actor: AGENT_TYPES, object: ANY, target: ANY, generated: ANY, referrer: ANY },
      NONE,
    ),
    AnnotationEvent: eventRecord(
      to,
      "AnnotationEvent",
      {
        actions: ["Bookmarked", "Highlighted", "Shared", "Tagged"],
        actor: PERSON,
        object: DIGITAL_RESOURCE_TYPES,
        target: FRAME,
        generated: ANNOTATION_TYPES,
        referrer: ANY,
      },
      NONE,
    ),
    AssessmentEvent: eventRecord(
      to,
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
      to,
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
      to,
      "AssignableEvent",
      {
        actions: ["Activated", "Deactivated", "Started", "Completed", "Submitted", "Reviewed"],
        actor: PERSON,
        object: ASSIGNABLE_TYPES,
        target: FRAME,
        generated: ["Attempt"],
        referrer: ANY,
      },
      NONE,
    ),
    FeedbackEvent: eventRecord(
      to,
      "FeedbackEvent",
      {
        actions: ["Commented", "Ranked"],
        actor: PERSON,
        object: ANY,
        target: FRAME,
        generated: ["Rating", "Comment"],
        referrer: ANY,
      },
      NONE,
    ),
    ForumEvent: eventRecord(
      to,
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
      to,
      "GradeEvent",
      {
        actions: ["Graded"],
        actor: AGENT_TYPES,
        object: ["Attempt"],
        target: ANY,
        generated: ["Score"],
        referrer: ANY,
      },
      NONE,
    ),
    MediaEvent: eventRecord(
      to,
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
      to,
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
      to,
      "NavigationEvent",
      {
        actions: ["NavigatedTo"],
        actor: PERSON,
        object: RESOURCE_OR_APPLICATION,
        // Caliper 1.1 names a frame as the target of a navigation, and 1.2 any digital resource.
        target: to.version === "1.1" ? FRAME : DIGITAL_RESOURCE_TYPES,
        generated: ANY,
        referrer: RESOURCE_OR_APPLICATION,
      },
      NONE,
    ),
    QuestionnaireEvent: eventRecord(
      to,
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
      to,
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
        to,
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
      to,
      "SearchEvent",
      { actions: ["Searched"], actor: PERSON, object: ANY, target: ANY, generated: ["SearchResponse"], referrer: ANY },
      NONE,
    ),
    SessionEvent: eventRecord(
      to,
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
      to,
      "SurveyEvent",
      {
        actions: ["OptedIn", "OptedOut"],
        actor: PERSON,
        object: ["Survey"],
        target: ANY,
        generated: ANY,
        referrer: ANY,
      },
      NONE,
    ),
    SurveyInvitationEvent: eventRecord(
      to,
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
      to,
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
        to,
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
      to,
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
      to,
      "ViewEvent",
      {
        actions: ["Viewed"],
        actor: PERSON,
        object: DIGITAL_RESOURCE_TYPES,
        // Caliper 1.1 names a frame as the target of a view, and 1.2 leaves it open.
        target: to.version === "1.1" ? FRAME : ANY,
        generated: ANY,
        referrer: ANY,
      },
      NONE,
    ),
    LibraryUseEvent: eventRecord(
      to,
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
      to,
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
      to,
      "LibraryParticipationEvent",
      { actions: ["Attended"], actor: PERSON, object: ["LibraryActivity"], target: ANY, generated: ANY, referrer: ANY },
      {
        participationMode: v.optional(text),
        forCourse: v.optional(to(COURSE_OFFERING_TYPES)),
        arrivalTime: v.optional(time),
      },
    ),
  } satisfies EventSchemas;
}

/**
 * Makes the schema of an event of any class, chosen by its `type`.
 *
 * @param schemas - Returns the schemas of all events.
 * @param version - The version of Caliper that the schema reads: a class that the version does not define is not an event.
 */
export function createEventSchema(schemas: () => EventSchemas, version: CaliperVersion): Schema<CaliperEvent> {
  return v.lazy((input) => {
    const type = isRecord(input) ? input.type : undefined;
    const found = EVENT_TYPES.find((name) => name === type && definesClass(version, name));
    if (found !== undefined) return schemas()[found];
    const retired = typeof type === "string" ? retiredNote(version, type) : "";
    if (retired !== "") return v.never(`expected an event of any class, found an event of type ${type}${retired}`);
    return v.never(
      `expected an event of any class, found ${isRecord(input) ? "an object whose type is not that of an event" : describe(input)}`,
    );
  });
}
