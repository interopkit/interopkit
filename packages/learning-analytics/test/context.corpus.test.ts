import { describe, expect, it } from "vitest";
import { buildEvent, type CaliperEntity, type CaliperEvent, caliperTime, mintUrn, sendCaliper } from "../src/index.js";
import { ACTIONS, ENTITY_TYPES, EVENT_TYPES, PROFILES } from "../src/model/internal.js";
import { envelopeProblems, eventProblems, TERMS } from "./context-oracle.js";
import { ACTOR, ASSESSMENT, eventAt, fakeEndpoint, SENDER, startedInput, urnOf } from "./fixture.js";

/** An entity with every property that the model has: `Required` fails the check of the types when one is missing. */
const FULL_ENTITY: Required<CaliperEntity> = {
  id: "https://exam.example/scores/1",
  type: "Score",
  name: "Score 1",
  isPartOf: ASSESSMENT,
  assignee: ACTOR,
  assignable: ASSESSMENT,
  startedAtTime: "2023-11-14T22:13:20.000Z",
  endedAtTime: "2023-11-14T22:14:20.000Z",
  attempt: urnOf("attempt", "s-1"),
  maxScore: 10,
  scoreGiven: 7.5,
  scoredBy: "https://exam.example/raters/1",
  dateCreated: "2023-11-14T22:15:20.000Z",
};

describe("the published JSON-LD context of Caliper 1.2", () => {
  it("defines the term of every event type, profile, action and entity type that the model names", () => {
    for (const term of EVENT_TYPES) expect(TERMS.get(term), term).toBe(`caliper:${term}`);
    for (const term of ENTITY_TYPES) expect(TERMS.get(term), term).toBe(`caliper:${term}`);
    for (const term of PROFILES) expect(TERMS.get(term), term).toBe(`caliper:profiles/${term}`);
    for (const term of ACTIONS) expect(TERMS.get(term), term).toBe(`caliper:actions/${term}`);
  });

  it("accepts an event with every property of an entity and every property of an event", () => {
    const event = buildEvent({ ...startedInput(), generated: FULL_ENTITY });
    expect(eventProblems(event)).toStrictEqual([]);
    expect(Object.keys(event.generated ?? {}).sort()).toStrictEqual(Object.keys(FULL_ENTITY).sort());
  });

  it("accepts an event of each type with its profile and an action that the profile allows", () => {
    const actor = { id: ACTOR, type: "Person" } as const;
    const events: CaliperEvent[] = [
      buildEvent({ ...startedInput(), type: "AssessmentItemEvent", action: "Skipped" }),
      buildEvent({ ...startedInput(), type: "NavigationEvent", action: "NavigatedTo" }),
      buildEvent({
        ...startedInput(),
        id: mintUrn(["event", "s-1", 2, 0]),
        type: "GradeEvent",
        profile: "GradingProfile",
        action: "Graded",
        actor,
        object: { id: urnOf("attempt", "s-1"), type: "Attempt" },
        generated: FULL_ENTITY,
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
      sendTime: caliperTime(1_700_000_000_000, "The time"),
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
