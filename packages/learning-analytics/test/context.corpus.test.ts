import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  buildEvent,
  type CaliperEvent,
  ENTITY_TYPES,
  EVENT_TYPES,
  formatDateTime,
  LTI_MESSAGE_TYPES,
  METRICS,
  mintUrn,
  PROFILES,
  ROLES,
  type Score,
  STATUSES,
  SYSTEM_IDENTIFIER_TYPES,
  sendCaliper,
} from "../src/index.js";
import { envelopeProblems, eventProblems, TERMS } from "./context-oracle.js";
import { ACTOR, ASSESSMENT, eventAt, fakeEndpoint, SENDER, startedInput, urnOf } from "./fixture.js";

/** A score with every property that the model has: `Required` fails the check of the types when one is missing. */
const FULL_ENTITY: Required<Omit<Score, "@context">> = {
  id: "https://exam.example/scores/1",
  type: "Score",
  name: "Score 1",
  description: "The score of the first attempt",
  attempt: urnOf("attempt", "s-1"),
  maxScore: 10,
  scoreGiven: 7.5,
  scoredBy: "https://exam.example/raters/1",
  comment: "Well done",
  dateCreated: "2023-11-14T22:15:20.000Z",
  dateModified: "2023-11-14T22:16:20.000Z",
  otherIdentifiers: [{ type: "SystemIdentifier", identifier: "s-1", identifierType: "Other" }],
  extensions: { rubric: "A" },
};

describe("the published JSON-LD context of Caliper 1.2", () => {
  it("defines every term of the model, but those that the context and the specification disagree on", () => {
    const missing = (terms: readonly string[]) => terms.filter((term) => !TERMS.has(term));
    expect(missing(EVENT_TYPES)).toStrictEqual([
      "LibraryParticipationEvent",
      "LibraryResourceUseEvent",
      "LibraryUseEvent",
    ]);
    expect(missing(PROFILES)).toStrictEqual(["LibraryProfile", "SurveyProfile"]);
    expect(missing(ROLES)).toStrictEqual(["Manager#Manager"]);
    // The context of the Library Use Profile answers 404, and the context of Caliper 1.2 lacks two actions of Appendix D.
    expect(missing(ACTIONS)).toStrictEqual([
      "Accessed",
      "Attended",
      "DisabledClosedCaptioning",
      "EnabledClosedCaptioning",
    ]);
    expect(missing(ENTITY_TYPES)).toStrictEqual(["Library", "LibraryActivity", "LibraryResource", "LibrarySpace"]);
    expect(missing(SYSTEM_IDENTIFIER_TYPES)).toStrictEqual([
      "Barcode",
      "DeweyDecimalCallNumber",
      "DigitalObjectIdentifier",
      "InternationalStandardBookNumber",
      "InternationalStandardSerialNumber",
      "LibGuideID",
      "LibraryCongressCallNumber",
      "OCLCNumber",
      "PubMedID",
      "SuperintendentDocumentsClassification",
    ]);
    expect(missing([...STATUSES, ...LTI_MESSAGE_TYPES, ...METRICS])).toStrictEqual([]);
    for (const term of PROFILES.filter((name) => TERMS.has(name)))
      expect(TERMS.get(term), term).toBe(`caliper:profiles/${term}`);
    for (const term of ENTITY_TYPES.filter((name) => TERMS.has(name)))
      expect(TERMS.get(term), term).toBe(`caliper:${term}`);
    for (const term of ACTIONS.filter((name) => TERMS.has(name)))
      expect(TERMS.get(term), term).toBe(`caliper:actions/${term}`);
  });

  it("accepts an event with every property of an entity and every property of an event", () => {
    const event = buildEvent({
      ...startedInput(),
      type: "GradeEvent",
      profile: "GradingProfile",
      action: "Graded",
      object: { id: urnOf("attempt", "s-1"), type: "Attempt" },
      generated: FULL_ENTITY,
    });
    expect(eventProblems(event)).toStrictEqual([]);
    expect(Object.keys(event.generated ?? {}).sort()).toStrictEqual(Object.keys(FULL_ENTITY).sort());
  });

  it("accepts an event of each type that the builder is given with its profile and an action that the profile allows", () => {
    const { eventTime, edApp } = startedInput();
    const actor = { id: ACTOR, type: "Person" } as const;
    const item = { id: "https://exam.example/tests/42/items/3", type: "AssessmentItem" } as const;
    const events: CaliperEvent[] = [
      buildEvent({
        id: mintUrn(["event", "s-1", 2, 1]),
        type: "AssessmentItemEvent",
        profile: "AssessmentProfile",
        actor,
        action: "Skipped",
        object: item,
        eventTime,
        edApp,
      }),
      buildEvent({
        id: mintUrn(["event", "s-1", 2, 2]),
        type: "NavigationEvent",
        profile: "AssessmentProfile",
        actor,
        action: "NavigatedTo",
        object: { id: "https://exam.example/tests/42/items/4", type: "AssessmentItem" },
        referrer: item,
        eventTime,
        edApp,
      }),
      buildEvent({
        id: mintUrn(["event", "s-1", 2, 0]),
        type: "GradeEvent",
        profile: "GradingProfile",
        actor,
        action: "Graded",
        object: { id: urnOf("attempt", "s-1"), type: "Attempt" },
        generated: FULL_ENTITY,
        eventTime,
        edApp,
      }),
    ];
    for (const event of events) expect(eventProblems(event), event.type).toStrictEqual([]);
  });

  it("accepts the envelope that the sensor sends", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper([eventAt(0), eventAt(1)], { ...SENDER, fetch: endpoint.fetch });
    const body = endpoint.requests[0]?.init.body;
    expect(envelopeProblems(JSON.parse(typeof body === "string" ? body : ""))).toStrictEqual([]);
  });
});

describe("the check against the published context", () => {
  // The check is the oracle of the tests above, so it must fail on documents that are wrong.
  const mutate = (change: (event: Record<string, unknown>) => void): string[] => {
    const copy: Record<string, unknown> = JSON.parse(JSON.stringify(buildEvent(startedInput())));
    change(copy);
    return eventProblems(copy);
  };

  it("accepts an event of the Assessment Profile that the specification prints", () => {
    const printed = {
      "@context": "http://purl.imsglobal.org/ctx/caliper/v1p2",
      id: "urn:uuid:04e27704-73bf-4d3c-912c-1b2da40aef8f",
      type: "AssessmentItemEvent",
      profile: "AssessmentProfile",
      actor: { id: "https://example.edu/users/554433", type: "Person" },
      action: "Skipped",
      object: {
        id: "https://example.edu/terms/201601/courses/7/sections/1/assess/1/items/2",
        type: "AssessmentItem",
        name: "Assessment Item 2",
        isPartOf: { id: "https://example.edu/terms/201601/courses/7/sections/1/assess/1", type: "Assessment" },
        dateToStartOn: "2016-11-14T05:00:00.000Z",
        dateToSubmit: "2016-11-18T11:59:59.000Z",
        maxAttempts: 2,
        maxSubmits: 2,
        maxScore: 1.0,
        isTimeDependent: false,
        version: "1.0",
      },
      eventTime: "2016-11-15T10:14:30.000Z",
      edApp: { id: "https://example.edu", type: "SoftwareApplication", version: "v2" },
      membership: {
        id: "https://example.edu/terms/201601/courses/7/sections/1/rosters/1",
        type: "Membership",
        member: "https://example.edu/users/554433",
        organization: "https://example.edu/terms/201601/courses/7/sections/1",
        roles: ["Learner"],
        status: "Active",
        dateCreated: "2016-08-01T06:00:00.000Z",
      },
    };
    expect(eventProblems(printed)).toStrictEqual([]);
  });

  it("finds a term that the context does not define", () => {
    expect(
      mutate((event) => {
        event.attemptCount = 1;
      }),
    ).toStrictEqual(["event.attemptCount: the term attemptCount is not defined by the Caliper context"]);
  });

  it("finds a value of the wrong type, a malformed time and an action that is not a term", () => {
    expect(
      mutate((event) => {
        event.eventTime = "2016-11-15 10:14:30";
      }),
    ).toStrictEqual(["event.eventTime: 2016-11-15 10:14:30 is not YYYY-MM-DDTHH:mm:ss.SSSZ"]);
    expect(
      mutate((event) => {
        event.object = { id: ASSESSMENT, type: "Assessment", name: 5 };
      }),
    ).toStrictEqual(["event.object.name: 5 is not a string"]);
    expect(
      mutate((event) => {
        event.action = "Began";
      }),
    ).toStrictEqual(["event.action: Began is not a term of the context"]);
  });

  it("finds a missing context, a missing required property and an identifier that is not a UUID URN", () => {
    expect(
      mutate((event) => {
        event["@context"] = "https://example.edu/context";
      }),
    ).toStrictEqual(["@context is https://example.edu/context"]);
    expect(
      mutate((event) => {
        delete event.actor;
      }),
    ).toStrictEqual(["actor is required and missing"]);
    expect(
      mutate((event) => {
        event.id = "https://example.edu/events/1";
      }),
    ).toStrictEqual(["id is not urn:uuid:<UUID>"]);
  });

  it("finds an entity that has no absolute IRI or whose type is not a node type", () => {
    expect(
      mutate((event) => {
        event.object = { id: "item-1", type: "Assessment" };
      }),
    ).toStrictEqual(["event.object: id is not an absolute IRI"]);
    expect(
      mutate((event) => {
        event.object = { id: ASSESSMENT, type: "Started" };
      }),
    ).toStrictEqual(["event.object: type is not a node type"]);
  });

  it("finds an envelope with a custom property, a missing version and no events", () => {
    const envelope = {
      sensor: "https://exam.example/sensors/1",
      sendTime: formatDateTime(1_700_000_000_000, "The time"),
      dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p2",
    };
    expect(envelopeProblems({ ...envelope, data: [], extra: 1 })).toStrictEqual([
      "The envelope has the properties sensor, sendTime, dataVersion, data, extra, not sensor, sendTime, dataVersion, data",
      "data is not a non-empty array",
    ]);
    expect(envelopeProblems({ ...envelope, dataVersion: "v1", data: [{}] })).toContain(
      "dataVersion is not the Caliper context",
    );
  });
});
