import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import {
  buildEntity,
  buildEvent,
  CALIPER_CONTEXT,
  type EventInput,
  LIBRARY_PROFILE_CONTEXT,
  readEvent,
} from "../src/index.js";
import { ACTOR, ASSESSMENT, fromJson, STARTED_DOCUMENT, startedInput } from "./fixture.js";

/** An event as a sender writes it: the Caliper context and the properties of an event of the Assessment Profile. */
const STARTED = STARTED_DOCUMENT;

/** Reads a value and returns the sentence of the error, or `undefined` when the value reads. */
function refusal(value: unknown): string | undefined {
  try {
    readEvent(value);
    return undefined;
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    return error.message;
  }
}

describe("readEvent", () => {
  it("reads an event and returns a copy that shares nothing with the input", () => {
    const input = deepFreeze(fromJson<Record<string, unknown>>(JSON.stringify(STARTED)));
    const event = readEvent(input);
    expect(event).toStrictEqual(input);
    expect(event.actor).not.toBe(input.actor);
  });

  it("reads the properties of the events that Caliper gives every event, and the extensions", () => {
    const event = readEvent({
      ...STARTED,
      target: { id: "https://exam.example/tests/42/frames/1", type: "Frame" },
      referrer: "https://exam.example/tests/41",
      group: { id: "https://exam.example/sections/1", type: "CourseSection" },
      membership: { id: "https://exam.example/rosters/1", type: "Membership", roles: ["Learner"], status: "Active" },
      session: { id: "https://exam.example/sessions/1", type: "Session" },
      federatedSession: { id: "https://lms.example/sessions/1", type: "LtiSession" },
      extensions: { room: "A" },
    });
    expect(event.type).toBe("AssessmentEvent");
    expect(Reflect.get(event, "extensions")).toStrictEqual({ room: "A" });
  });

  it("reads an actor, an object and an application as IRIs where the specification allows an entity", () => {
    const event = readEvent({ ...STARTED, actor: ACTOR, object: ASSESSMENT, edApp: "https://exam.example" });
    expect(event.actor).toBe(ACTOR);
    expect(event.object).toBe(ASSESSMENT);
  });

  it("reads an event without a profile or an application, which Caliper leaves optional", () => {
    const { profile: _profile, edApp: _edApp, ...rest } = STARTED;
    expect(readEvent(rest).type).toBe("AssessmentEvent");
  });

  it("reads the generic Event of the General Profile with any agent, any action and any entity", () => {
    const event = readEvent({
      "@context": CALIPER_CONTEXT,
      id: "urn:uuid:3a648e68-f00d-4c08-aa59-8738e1884f2c",
      type: "Event",
      profile: "GeneralProfile",
      actor: { id: ACTOR, type: "Person" },
      action: "Created",
      object: { id: ASSESSMENT, type: "Document" },
      eventTime: "2016-11-15T10:15:00.000Z",
    });
    expect(event.type).toBe("Event");
  });

  it("reads a list of contexts that ends with the context of Caliper, and the terms of one context written inline", () => {
    const local = { query: "http://schema.org/query" };
    for (const context of [
      [CALIPER_CONTEXT],
      [local, CALIPER_CONTEXT],
      ["https://schema.org/docs/jsonldcontext.json", local, CALIPER_CONTEXT],
      local,
    ]) {
      expect(readEvent({ ...STARTED, "@context": context })["@context"]).toStrictEqual(context);
    }
  });

  it.each([
    ["an unknown context", "http://purl.imsglobal.org/ctx/caliper/v1p1"],
    ["a list that does not end with Caliper's", [CALIPER_CONTEXT, "https://schema.org/docs/jsonldcontext.json"]],
    ["an empty list", []],
    ["a number", 7],
  ])("refuses %s as the context", (_, context) => {
    expect(refusal({ ...STARTED, "@context": context })).toMatch(/^The event is invalid at \["@context"\]/u);
  });

  it("reads the context of the Library Use Profile for its events", () => {
    const event = readEvent({
      "@context": LIBRARY_PROFILE_CONTEXT,
      id: "urn:uuid:fd245e24-d9fa-4384-8b0a-7d08d632e63f",
      type: "LibraryUseEvent",
      profile: "LibraryProfile",
      actor: { id: ACTOR, type: "Person" },
      action: "Used",
      object: { id: "https://example.edu/library", type: "Library" },
      eventTime: "2020-11-15T10:15:00.000Z",
      presenceDerivedFromSource: "wifi",
    });
    expect(event.type).toBe("LibraryUseEvent");
  });

  it.each([
    ["an id that is not a UUID URN", { id: "https://exam.example/events/1" }, "at id"],
    ["a time with an offset", { eventTime: "2023-11-14T22:13:20.000+00:00" }, "at eventTime"],
    ["a profile that is none of Caliper's", { profile: "PlayProfile" }, "at profile"],
    ["an action that the event does not allow", { action: "Graded" }, "at action: expected an action of Caliper"],
    ["an actor that is not a person", { actor: { id: ACTOR, type: "SoftwareApplication" } }, "at actor"],
    ["an object of another class", { object: { id: ASSESSMENT, type: "AssessmentItem" } }, "at object"],
    ["a generated entity of another class", { generated: { id: ASSESSMENT, type: "Score" } }, "at generated"],
    ["a property that no event has", { nickname: 1 }, "unexpected property"],
    ["a property that is no JSON", { extensions: { at: new Date(0) } }, "extensions.at"],
  ])("refuses %s, and names where", (_, change, where) => {
    expect(refusal({ ...STARTED, ...change })).toContain(where);
  });

  it("refuses an event of a type that is none of Caliper's, and a value that is no object", () => {
    expect(refusal({ ...STARTED, type: "RobotEvent" })).toBe(
      "The event is invalid: expected an event of any class, found an object whose type is not that of an event.",
    );
    for (const bad of [null, undefined, "event", 7, [], [STARTED]]) {
      expect(refusal(bad), String(bad)).toMatch(/^The event is invalid/u);
    }
  });

  it("requires the properties that the tables require", () => {
    for (const name of ["@context", "id", "type", "actor", "action", "object", "eventTime"]) {
      const { [name]: _dropped, ...rest } = STARTED as Record<string, unknown>;
      expect(refusal(rest), name).toMatch(/^The event is invalid/u);
    }
  });

  it("requires the resource that a copy made, and the session of the platform that a launch comes from", () => {
    const resource = { id: "https://example.edu/resources/1", type: "Document" };
    const base = {
      "@context": CALIPER_CONTEXT,
      id: "urn:uuid:3a648e68-f00d-4c08-aa59-8738e1884f2c",
      actor: { id: ACTOR, type: "Person" },
      eventTime: "2016-11-15T10:15:00.000Z",
    };
    const copy = { ...base, type: "ResourceManagementEvent", action: "Copied", object: resource };
    expect(refusal(copy)).toBe(
      "The event is invalid at generated: the event needs the resource that the Copied action made.",
    );
    expect(refusal({ ...copy, generated: { ...resource, id: "https://example.edu/resources/2" } })).toBeUndefined();
    expect(refusal({ ...copy, action: "Created" })).toBeUndefined();
    const launch = {
      ...base,
      type: "ToolLaunchEvent",
      action: "Launched",
      object: { id: "https://tool.example", type: "SoftwareApplication" },
    };
    expect(refusal(launch)).toBe(
      "The event is invalid at federatedSession: the event needs the session of the platform that the Launched action comes from.",
    );
    expect(
      refusal({ ...launch, federatedSession: { id: "https://lms.example/s/1", type: "LtiSession" } }),
    ).toBeUndefined();
    expect(refusal({ ...launch, action: "Returned" })).toBeUndefined();
  });

  it("takes a response or an attempt as what an item event made, though its table names only a response", () => {
    const item = { id: "https://exam.example/items/1", type: "AssessmentItem" };
    const event = { ...STARTED, type: "AssessmentItemEvent", object: item };
    expect(
      refusal({ ...event, generated: { id: "https://exam.example/r/1", type: "OpenEndedResponse" } }),
    ).toBeUndefined();
    expect(refusal({ ...event, generated: { id: "https://exam.example/a/1", type: "Attempt" } })).toBeUndefined();
    expect(refusal({ ...event, generated: { id: "https://exam.example/a/1", type: "Score" } })).toMatch(
      /at generated/u,
    );
  });

  it("gives a DataError and nothing else for any value of JSON, and for an event with one property of any value", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(refusal(value)).toBeTypeOf("string");
      }),
      { seed: 20_241_103, numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(STARTED)), fc.anything(), (key, value) => {
        const result = refusal({ ...STARTED, [key]: value });
        if (result !== undefined) expect(result).toMatch(/^The event is invalid/u);
      }),
      { seed: 20_241_103, numRuns: 300 },
    );
  });

  it("refuses a value that nests too deep, where the schemas would exhaust the stack", () => {
    let value: Record<string, unknown> = { id: "https://a.example/0", type: "Document" };
    for (let depth = 1; depth < 100_000; depth += 1) {
      value = { id: `https://a.example/${depth}`, type: "Document", isPartOf: value };
    }
    expect(refusal({ ...STARTED, object: value })).toMatch(
      /^The event is invalid: object(\.isPartOf)+ nests more than 64 levels/u,
    );
  });
});

describe("buildEvent and buildEntity", () => {
  const input: EventInput = startedInput();

  it("writes the context of Caliper, after the contexts of the sender", () => {
    expect(buildEvent(input)["@context"]).toBe(CALIPER_CONTEXT);
    const local = { query: "http://schema.org/query" };
    expect(
      buildEvent(input, { contexts: ["https://schema.org/docs/jsonldcontext.json", local] })["@context"],
    ).toStrictEqual(["https://schema.org/docs/jsonldcontext.json", local, CALIPER_CONTEXT]);
  });

  it("writes the context of the Library Use Profile for the events and the entities that profile defines", () => {
    const library = { id: "https://example.edu/library", type: "Library" } as const;
    expect(buildEntity(library)["@context"]).toBe(LIBRARY_PROFILE_CONTEXT);
    expect(buildEntity({ id: ACTOR, type: "Person" })["@context"]).toBe(CALIPER_CONTEXT);
    const event = buildEvent({
      id: input.id,
      type: "LibraryUseEvent",
      actor: { id: ACTOR, type: "Person" },
      action: "Used",
      object: library,
      eventTime: input.eventTime,
    });
    expect(event["@context"]).toBe(LIBRARY_PROFILE_CONTEXT);
  });

  it("refuses an input that brings its own context, and options that are not an object of contexts", () => {
    expect(() => buildEvent(fromJson<EventInput>(JSON.stringify(STARTED)))).toThrow(
      'The event is invalid at ["@context"]: the builder writes the context, so give the contexts of your own in the option contexts.',
    );
    expect(() => buildEntity(fromJson(`{"@context":"${CALIPER_CONTEXT}","id":"${ACTOR}","type":"Person"}`))).toThrow(
      'The entity is invalid at ["@context"]',
    );
    for (const options of ["x", 7, [], { contexts: "x" }, { contexts: [7] }, { other: 1 }]) {
      expect(() => buildEvent(input, fromJson(JSON.stringify(options))), JSON.stringify(options)).toThrow(
        /^The options is invalid/u,
      );
    }
    expect(() => buildEvent(input, fromJson("null"))).toThrow("The options is invalid");
  });

  it("builds what readEvent and readEntity read, and nothing else", () => {
    expect(readEvent(buildEvent(input))).toStrictEqual(buildEvent(input));
    const entity = buildEntity({ id: ACTOR, type: "Person", name: "Ada" });
    expect(readEvent).toBeTypeOf("function");
    expect(entity).toStrictEqual({ "@context": CALIPER_CONTEXT, id: ACTOR, type: "Person", name: "Ada" });
    expect(() => buildEntity(fromJson('{"id":"x","type":"Person"}'))).toThrow(DataError);
    expect(() => buildEntity(fromJson("7"))).toThrow(DataError);
  });
});
