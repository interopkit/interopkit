import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import { handleCaliperRequest, readEnvelope } from "../src/endpoint/index.js";
import {
  CALIPER_1_1_CONTEXT,
  CALIPER_CONTEXT,
  CALIPER_VERSIONS,
  LIBRARY_PROFILE_CONTEXT,
  readEntity,
  readEvent,
  validateEntity,
  validateEvent,
} from "../src/index.js";
import { DEPRECATED_IN_1_1, EXTENSION_CONTEXTS_1_1, NOT_IN_1_1, TERMS_NOT_IN_1_1 } from "../src/v1p1/index.js";
import { envelopeOf, post, recorder } from "./endpoint-fixture.js";
import { ACTOR, ASSESSMENT, fromJson, STARTED_DOCUMENT } from "./fixture.js";

/** An event as a sender of Caliper 1.1 writes it: the context of 1.1 and no profile, which 1.1 does not define. */
const { profile: _profile, ...WITHOUT_PROFILE } = STARTED_DOCUMENT;
const STARTED_1_1 = { ...WITHOUT_PROFILE, "@context": CALIPER_1_1_CONTEXT };

/** An entity describe as a sender of Caliper 1.1 writes it. */
const PERSON_1_1 = { "@context": CALIPER_1_1_CONTEXT, id: ACTOR, type: "Person" };

const V1P1 = { version: "1.1" } as const;

/** Reads a value as 1.1 and returns the sentence of the error, or `undefined` when the value reads. */
function refusal(read: (value: unknown, options: typeof V1P1) => unknown, value: unknown): string | undefined {
  try {
    read(value, V1P1);
    return undefined;
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    return error.message;
  }
}

const refusedEvent = (value: unknown) => refusal(readEvent, value);
const refusedEntity = (value: unknown) => refusal(readEntity, value);

describe("readEvent and readEntity as Caliper 1.1 defines them", () => {
  it("reads an event of 1.1 and returns a copy that shares nothing with the input", () => {
    const input = deepFreeze(fromJson<Record<string, unknown>>(JSON.stringify(STARTED_1_1)));
    const event = readEvent(input, V1P1);
    expect(event).toStrictEqual(input);
    expect(event.actor).not.toBe(input.actor);
  });

  it("reads an entity describe of 1.1 with its context first", () => {
    expect(readEntity(PERSON_1_1, V1P1)).toStrictEqual(PERSON_1_1);
  });

  it("reads 1.2 when it is told nothing, and refuses the context of the other version", () => {
    expect(CALIPER_VERSIONS).toStrictEqual(["1.2", "1.1"]);
    expect(readEvent(STARTED_DOCUMENT).type).toBe("AssessmentEvent");
    expect(readEvent(STARTED_DOCUMENT, { version: "1.2" }).type).toBe("AssessmentEvent");
    expect(refusedEvent(STARTED_DOCUMENT)).toBe(
      'The event is invalid at ["@context"]: expected the context of Caliper 1.1, or a list of contexts that ends with it.',
    );
    expect(() => readEvent(STARTED_1_1)).toThrow("expected the context of Caliper 1.2");
    expect(refusedEntity({ ...PERSON_1_1, "@context": CALIPER_CONTEXT })).toMatch(/context of Caliper 1\.1/u);
    expect(() => readEntity(PERSON_1_1)).toThrow("expected the context of Caliper 1.2");
  });

  it.each(EXTENSION_CONTEXTS_1_1)("reads the context of the profile %s as the context of Caliper 1.1", (context) => {
    expect(readEvent({ ...STARTED_1_1, "@context": context }, V1P1)["@context"]).toBe(context);
    expect(readEntity({ ...PERSON_1_1, "@context": context }, V1P1)["@context"]).toBe(context);
    expect(() => readEvent({ ...STARTED_1_1, "@context": context })).toThrow("context of Caliper 1.2");
  });

  it("reads a list of contexts that ends with the context of 1.1 or of a profile, with the contexts of the sender before", () => {
    const local = { query: "http://schema.org/query" };
    for (const last of [CALIPER_1_1_CONTEXT, EXTENSION_CONTEXTS_1_1[3]]) {
      const context = ["https://schema.org/docs/jsonldcontext.json", local, last];
      expect(readEvent({ ...STARTED_1_1, "@context": context }, V1P1)["@context"]).toStrictEqual(context);
      expect(readEntity({ ...PERSON_1_1, "@context": context }, V1P1)["@context"]).toStrictEqual(context);
    }
    for (const context of [[CALIPER_1_1_CONTEXT, local], [CALIPER_CONTEXT], [LIBRARY_PROFILE_CONTEXT], []]) {
      expect(refusedEvent({ ...STARTED_1_1, "@context": context }), JSON.stringify(context)).toMatch(
        /context of Caliper 1\.1|expected a length of at least 1/u,
      );
    }
  });

  it("refuses the context of the Library Use Profile, which extends 1.2, and a 1.1 profile in a reading of 1.2", () => {
    expect(refusedEvent({ ...STARTED_1_1, "@context": LIBRARY_PROFILE_CONTEXT })).toMatch(/context of Caliper 1\.1/u);
    expect(() => readEvent({ ...STARTED_DOCUMENT, "@context": EXTENSION_CONTEXTS_1_1[0] })).toThrow(
      "context of Caliper 1.2",
    );
  });

  it("refuses the profile of an event, which Caliper 1.1 does not define", () => {
    expect(refusedEvent({ ...STARTED_1_1, profile: "AssessmentProfile" })).toBe(
      "The event is invalid at profile: Caliper 1.1 does not define the property profile, which Caliper 1.2 added.",
    );
  });

  it.each([
    {
      property: "otherIdentifiers",
      of: "an actor",
      at: "actor",
      change: { actor: { id: ACTOR, type: "Person", otherIdentifiers: [] } },
    },
    {
      property: "otherIdentifiers",
      of: "an entity inside an entity",
      at: "object.isPartOf",
      change: {
        object: {
          id: ASSESSMENT,
          type: "Assessment",
          isPartOf: { id: ASSESSMENT, type: "Page", otherIdentifiers: [] },
        },
      },
    },
    {
      property: "storageName",
      of: "an object",
      at: "object",
      change: { object: { id: ASSESSMENT, type: "Assessment", storageName: "a.pdf" } },
    },
    {
      property: "client",
      of: "a session",
      at: "session",
      change: { session: { id: "https://exam.example/s/1", type: "Session", client: ACTOR } },
    },
    {
      property: "host",
      of: "an application",
      at: "edApp",
      change: { edApp: { id: "https://exam.example", type: "SoftwareApplication", host: "exam.example" } },
    },
    {
      property: "ipAddress",
      of: "an application",
      at: "edApp",
      change: { edApp: { id: "https://exam.example", type: "SoftwareApplication", ipAddress: "192.0.2.1" } },
    },
    {
      property: "userAgent",
      of: "an application",
      at: "edApp",
      change: { edApp: { id: "https://exam.example", type: "SoftwareApplication", userAgent: "Mozilla" } },
    },
  ])("refuses $property of $of, a property that Caliper 1.2 added", ({ property, at, change }) => {
    expect(refusedEvent({ ...STARTED_1_1, ...change })).toBe(
      `The event is invalid at ${at}.${property}: Caliper 1.1 does not define the property ${property}, which Caliper 1.2 added.`,
    );
  });

  it("reads the properties that 1.2 added in a document of 1.2", () => {
    const event = {
      ...STARTED_DOCUMENT,
      actor: { id: ACTOR, type: "Person", otherIdentifiers: [] },
      object: { id: ASSESSMENT, type: "Assessment", storageName: "a.pdf" },
      session: { id: "https://exam.example/s/1", type: "Session", client: "https://exam.example" },
      edApp: { id: "https://exam.example", type: "SoftwareApplication", host: "exam.example" },
    };
    expect(readEvent(event).type).toBe("AssessmentEvent");
    const { profile: _profile, ...noProfile } = event;
    expect(refusedEvent({ ...noProfile, "@context": CALIPER_1_1_CONTEXT })).toContain("Caliper 1.1 does not define");
  });

  it("refuses an entity describe with a property that 1.2 added, at the property", () => {
    expect(refusedEntity({ ...PERSON_1_1, otherIdentifiers: [] })).toBe(
      "The entity is invalid at otherIdentifiers: Caliper 1.1 does not define the property otherIdentifiers, which Caliper 1.2 added.",
    );
    expect(
      refusedEntity({ "@context": CALIPER_1_1_CONTEXT, id: ASSESSMENT, type: "Document", storageName: "a" }),
    ).toContain("storageName");
  });

  it.each(NOT_IN_1_1.events)("refuses the event %s, which Caliper 1.2 added", (type) => {
    const message = refusedEvent({ ...STARTED_1_1, type }) ?? "";
    expect(message).toBe(
      "The event is invalid: expected an event of any class, found an object whose type is not that of an event.",
    );
  });

  it.each(NOT_IN_1_1.entities)("refuses the entity %s, which Caliper 1.2 added", (type) => {
    const nested = { ...STARTED_1_1, object: { id: ASSESSMENT, type } };
    expect(refusedEvent(nested)).toMatch(/^The event is invalid at object: expected an entity of type /u);
    expect(refusedEvent(nested)).not.toContain(type === "SystemIdentifier" ? "SystemIdentifier," : `${type},`);
    expect(refusedEntity({ ...PERSON_1_1, id: ASSESSMENT, type })).toMatch(
      /^The entity is invalid: expected an entity of any class, found an entity of type/u,
    );
  });

  it.each(TERMS_NOT_IN_1_1.flatMap(({ property, terms }) => terms.map((term) => [property, term] as const)))(
    "refuses the %s %s, which Caliper 1.2 added",
    (property, term) => {
      const value =
        property === "action"
          ? { ...STARTED_1_1, type: "Event", action: term, object: { id: ASSESSMENT, type: "Document" } }
          : {
              ...STARTED_1_1,
              membership: { id: "https://exam.example/rosters/1", type: "Membership", roles: ["Learner", term] },
            };
      expect(
        readEvent(
          property === "action" ? { ...value, "@context": CALIPER_CONTEXT } : { ...value, "@context": CALIPER_CONTEXT },
        ),
      ).toBeDefined();
      const message = refusedEvent(value) ?? "";
      expect(message).toContain(`found "${term}", which Caliper 1.2 added.`);
      expect(message).toContain(property === "action" ? "at action:" : "at membership.roles[1]:");
    },
  );

  it.each(DEPRECATED_IN_1_1.events)("refuses the event %s, which Caliper 1.1 deprecated, and says so", (type) => {
    expect(refusedEvent({ ...STARTED_1_1, type })).toBe(
      `The event is invalid: expected an event of any class, found an event of type ${type}, which Caliper 1.1 deprecated and the reader does not take.`,
    );
    expect(() => readEvent({ ...STARTED_DOCUMENT, type })).toThrow("an object whose type is not that of an event");
  });

  it.each(DEPRECATED_IN_1_1.entities)("refuses the entity %s, which Caliper 1.1 deprecated, and says so", (type) => {
    expect(refusedEvent({ ...STARTED_1_1, object: { id: ASSESSMENT, type } })).toMatch(
      new RegExp(
        `^The event is invalid at object: expected an entity of type .*, found an entity of type ${type}, which Caliper 1.1 deprecated and the reader does not take\\.$`,
        "u",
      ),
    );
    expect(refusedEntity({ ...PERSON_1_1, id: ASSESSMENT, type })).toBe(
      `The entity is invalid: expected an entity of any class, found an entity of type ${type}, which Caliper 1.1 deprecated and the reader does not take.`,
    );
  });

  it("refuses the properties that 1.1 deprecated, as properties that the class does not have", () => {
    expect(refusedEntity({ "@context": CALIPER_1_1_CONTEXT, id: ASSESSMENT, type: "Document", objectType: "x" })).toBe(
      'The entity is invalid: unexpected property "objectType".',
    );
    expect(
      refusedEvent({
        ...STARTED_1_1,
        type: "NavigationEvent",
        action: "NavigatedTo",
        object: { id: ASSESSMENT, type: "WebPage" },
        navigatedFrom: ASSESSMENT,
      }),
    ).toBe('The event is invalid: unexpected property "navigatedFrom".');
  });

  it("refuses an action that 1.1 deprecated for an event, which the generic Event still allows", () => {
    const annotation = {
      ...STARTED_1_1,
      type: "AnnotationEvent",
      action: "Commented",
      object: { id: ASSESSMENT, type: "Document" },
    };
    expect(refusedEvent(annotation)).toContain("at action:");
    const generic = { ...annotation, type: "Event" };
    expect(refusedEvent(generic)).toBeUndefined();
  });

  it("reports a wrong value before a property that 1.2 added", () => {
    expect(refusedEvent({ ...STARTED_1_1, eventTime: "yesterday", profile: "AssessmentProfile" })).toContain(
      "at eventTime:",
    );
  });
});

describe("the ranges that Caliper 1.1 narrows", () => {
  const frame = { id: "https://exam.example/frames/1", type: "Frame" };
  const page = { id: "https://exam.example/pages/1", type: "WebPage" };
  const navigation = {
    ...STARTED_1_1,
    type: "NavigationEvent",
    action: "NavigatedTo",
    object: page,
  };
  const view = { ...STARTED_1_1, type: "ViewEvent", action: "Viewed", object: page };

  it.each([
    ["a navigation", navigation],
    ["a view", view],
  ])("takes only a frame as the target of %s in 1.1, where 1.2 takes any entity", (_, event) => {
    expect(refusedEvent({ ...event, target: frame })).toBeUndefined();
    expect(refusedEvent({ ...event, target: page })).toMatch(
      /^The event is invalid at target: expected an entity of type Frame/u,
    );
    expect(() => readEvent({ ...event, "@context": CALIPER_CONTEXT, target: page })).not.toThrow();
  });

  it("takes any digital resource as the target of a navigation in 1.2, and a frame alone in 1.1", () => {
    const event = { ...navigation, "@context": CALIPER_CONTEXT, target: page };
    expect(readEvent(event).type).toBe("NavigationEvent");
    expect(() => readEvent({ ...event, target: { id: "https://exam.example/people/1", type: "Person" } })).toThrow(
      /at target/u,
    );
  });
});

describe("readEvent and readEntity: options of other types", () => {
  it.each([
    ["null options", "null"],
    ["options as an array", "[]"],
    ["options as text", '"1.1"'],
    ["a version as a number", '{"version":1.1}'],
    ["a version that no reader knows", '{"version":"1.0"}'],
    ["a version as null", '{"version":null}'],
    ["an option that does not exist", '{"profile":"x"}'],
  ])("refuses %s with a DataError that names the options", (_, text) => {
    const options = fromJson<never>(text);
    expect(() => readEvent(STARTED_DOCUMENT, options)).toThrow(DataError);
    expect(() => readEvent(STARTED_DOCUMENT, options)).toThrow(/^The read options is invalid/u);
    expect(() => readEntity(PERSON_1_1, options)).toThrow(/^The read options is invalid/u);
  });

  it("names the versions that it reads when the version is not one of them", () => {
    expect(() => readEvent(STARTED_DOCUMENT, fromJson<never>('{"version":"1.0"}'))).toThrow(
      'The read options is invalid at version: expected a version of Caliper that the readers know, 1.2 or 1.1, found "1.0".',
    );
  });

  it("accepts the options of an absent version and an empty object", () => {
    expect(readEvent(STARTED_DOCUMENT, {}).type).toBe("AssessmentEvent");
    expect(readEvent(STARTED_DOCUMENT, undefined).type).toBe("AssessmentEvent");
  });
});

describe("validateEvent and validateEntity as Caliper 1.1 defines them", () => {
  it("does not warn of the recommendations of the profiles of 1.2, which an event of 1.1 does not name", () => {
    const { generated: _generated, ...withoutAttempt } = STARTED_1_1;
    expect(validateEvent(withoutAttempt, V1P1)).toStrictEqual([]);
    expect(validateEvent({ ...withoutAttempt, "@context": CALIPER_CONTEXT }).map(({ rule }) => rule)).toStrictEqual([
      "profile-missing",
      "generated-missing",
    ]);
  });

  it("finds nothing in an event that reads, and judges no profile table of 1.2", () => {
    expect(validateEvent(STARTED_1_1, V1P1)).toStrictEqual([]);
    // Under 1.2 the same event has a profile to name and a generated entity to give.
    const { generated: _generated, ...noAttempt } = WITHOUT_PROFILE;
    expect(validateEvent(noAttempt).map(({ rule }) => rule)).toContain("profile-missing");
    expect(validateEvent({ ...noAttempt, "@context": CALIPER_1_1_CONTEXT }, V1P1)).toStrictEqual([]);
  });

  it("lists the errors of the reading of 1.1, each with its path", () => {
    const findings = validateEvent({ ...STARTED_1_1, profile: "AssessmentProfile", eventTime: "yesterday" }, V1P1);
    expect(findings).toStrictEqual([
      {
        path: "eventTime",
        rule: "invalid-format",
        severity: "error",
        message: expect.stringContaining("expected a time as YYYY-MM-DDTHH:mm:ss.SSSZ"),
      },
    ]);
    expect(validateEvent({ ...STARTED_1_1, profile: "AssessmentProfile" }, V1P1)).toStrictEqual([
      {
        path: "profile",
        rule: "invalid-value",
        severity: "error",
        message: "Caliper 1.1 does not define the property profile, which Caliper 1.2 added.",
      },
    ]);
  });

  it("finds the context of the other version, and the classes that 1.1 deprecated", () => {
    expect(validateEvent(STARTED_DOCUMENT, V1P1)).toMatchObject([{ path: '["@context"]', severity: "error" }]);
    expect(validateEvent({ ...STARTED_1_1, type: "OutcomeEvent" }, V1P1)).toMatchObject([
      { path: "", severity: "error", message: expect.stringContaining("which Caliper 1.1 deprecated") },
    ]);
  });

  it("judges an entity describe, and does not ask a 1.1 entity for the properties that the profiles of 1.2 advise", () => {
    const attempt = { "@context": CALIPER_1_1_CONTEXT, id: "https://exam.example/a/1", type: "Attempt" };
    expect(validateEntity(attempt, V1P1)).toStrictEqual([]);
    expect(validateEntity({ ...attempt, "@context": CALIPER_CONTEXT }).map(({ rule }) => rule)).toStrictEqual([
      "property-advised",
      "property-advised",
      "property-advised",
    ]);
    expect(validateEntity({ ...PERSON_1_1, otherIdentifiers: [] }, V1P1)).toMatchObject([
      { path: "otherIdentifiers", severity: "error" },
    ]);
  });

  it("limits its findings in a reading of 1.1 as in one of 1.2", () => {
    const wrong = { ...STARTED_1_1, actor: 5, object: 6, eventTime: 7 };
    const findings = validateEvent(wrong, { version: "1.1", maxFindings: 1 });
    expect(findings.map(({ path, rule }) => [path, rule])).toStrictEqual([
      ["actor", "invalid-format"],
      ["", "findings-stopped"],
    ]);
  });

  it.each([
    ["null options", "null"],
    ["a version as text of another form", '{"version":"1.1.0"}'],
    ["a version as a number", '{"version":1.1}'],
    ["a version that no reader knows", '{"version":"1.0"}'],
  ])("refuses %s with a DataError", (_, text) => {
    expect(() => validateEvent(STARTED_1_1, fromJson<never>(text))).toThrow(DataError);
    expect(() => validateEntity(PERSON_1_1, fromJson<never>(text))).toThrow(DataError);
  });
});

describe("the endpoint and a sensor of Caliper 1.1", () => {
  const sound = (index: number) => ({ ...STARTED_1_1, id: `urn:uuid:3a648e68-f00d-4c08-aa59-8738e1884f0${index}` });
  const given = (data: readonly unknown[], changes: Record<string, unknown> = {}) =>
    envelopeOf(data, { dataVersion: CALIPER_1_1_CONTEXT, ...changes });

  it("receives an envelope of 1.1, names its version, and hands the items over as they were written", async () => {
    const endpoint = recorder();
    const response = await handleCaliperRequest(post(given([PERSON_1_1, sound(1)])), endpoint.options);
    expect(response).toStrictEqual({ status: 200, headers: {}, body: "" });
    expect(endpoint.received[0]).toMatchObject({
      principal: "tool-7",
      dataVersion: CALIPER_1_1_CONTEXT,
      data: [PERSON_1_1, sound(1)],
      findings: [],
    });
  });

  it("reads each item as the version of its envelope, and names the items that read as another", async () => {
    const endpoint = recorder();
    const items = [sound(1), STARTED_DOCUMENT, { ...PERSON_1_1, "@context": CALIPER_CONTEXT }];
    await handleCaliperRequest(post(given(items)), endpoint.options);
    const [envelope] = endpoint.received;
    expect(envelope?.data).toStrictEqual([sound(1)]);
    expect(envelope?.findings.map(({ path, rule }) => [path, rule])).toStrictEqual([
      ['data[1]["@context"]', "invalid-format"],
      ['data[2]["@context"]', "invalid-format"],
    ]);
    const other = recorder();
    await handleCaliperRequest(post(envelopeOf([STARTED_1_1])), other.options);
    expect(other.received[0]?.data).toStrictEqual([]);
    expect(other.received[0]?.findings[0]?.path).toBe('data[0]["@context"]');
  });

  it("names an event that 1.1 deprecated, and an entity that 1.2 added, in the findings of the envelope", async () => {
    const endpoint = recorder();
    const retired = { ...sound(1), type: "OutcomeEvent" };
    const added = { ...PERSON_1_1, otherIdentifiers: [] };
    await handleCaliperRequest(post(given([retired, sound(2), added])), endpoint.options);
    const [envelope] = endpoint.received;
    expect(envelope?.data).toStrictEqual([sound(2)]);
    expect(envelope?.findings.map(({ path, message }) => [path, message])).toStrictEqual([
      [
        "data[0]",
        "expected an event of any class, found an event of type OutcomeEvent, which Caliper 1.1 deprecated and the reader does not take.",
      ],
      [
        "data[2].otherIdentifiers",
        "Caliper 1.1 does not define the property otherIdentifiers, which Caliper 1.2 added.",
      ],
    ]);
  });

  it("refuses under strict an envelope of 1.1 with an item that 1.1 does not read, and reads one that does", async () => {
    const strict = recorder({ strict: true });
    expect((await handleCaliperRequest(post(given([sound(1)])), strict.options)).status).toBe(200);
    const refused = await handleCaliperRequest(post(given([sound(1), STARTED_DOCUMENT])), strict.options);
    expect(refused.status).toBe(400);
    expect(strict.received).toHaveLength(1);
  });

  it("reads an envelope of 1.1 with readEnvelope, and one of 1.2 when its versions leave 1.1 out", () => {
    expect(readEnvelope(given([sound(1)])).dataVersion).toBe(CALIPER_1_1_CONTEXT);
    expect(readEnvelope(given([sound(1)]), { versions: ["1.1"] }).data).toStrictEqual([sound(1)]);
    expect(readEnvelope(envelopeOf(), { versions: ["1.2"] }).dataVersion).toBe(CALIPER_CONTEXT);
    expect(() => readEnvelope(given([sound(1)]), { versions: ["1.2"] })).toThrow(DataError);
    expect(() => readEnvelope(envelopeOf(), { versions: ["1.1"] })).toThrow(DataError);
  });
});
