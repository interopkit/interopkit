import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { v5 } from "uuid";
import { describe, expect, it } from "vitest";
import { CALIPER_NAMESPACE } from "../src/build/internal.js";
import {
  buildEvent,
  CALIPER_CONTEXT,
  type CaliperEntity,
  type CaliperEvent,
  checkIri,
  type EventInput,
  formatDateTime,
  mintUrn,
  readEntity,
} from "../src/index.js";
import { ACTOR, ASSESSMENT, EVENT_TIME, fromJson, IDS, SESSION, startedInput, urnOf } from "./fixture.js";

const MAX_TIME = 253_402_300_799_999;
/**
 * Scores that JSON carries unchanged. JSON writes -0 as 0, and `toStrictEqual` tells the two apart, so -0 is drawn on purpose
 * and then becomes 0 (-0 + 0 is 0).
 */
const SCORES = fc.oneof(fc.constant(-0), fc.double({ noNaN: true, noDefaultInfinity: true })).map((score) => score + 0);

describe("the namespace of the identifiers", () => {
  it("is used with a library that gives the worked example of RFC 9562 Appendix A.4", () => {
    const { rfc9562 } = IDS;
    expect(v5(rfc9562.name, rfc9562.namespace)).toBe(rfc9562.uuid);
  });

  it("gives the UUIDs that Python's uuid5 gives for the names of the identifiers", () => {
    for (const { name, uuid } of IDS.names) expect(v5(name, CALIPER_NAMESPACE), name).toBe(uuid);
  });

  it("is the UUID of the address in the URL namespace, and never changes", () => {
    expect(v5(IDS.address, v5.URL)).toBe(CALIPER_NAMESPACE);
    expect(CALIPER_NAMESPACE).toBe("4bcd2e8b-df2f-56d9-b6c1-d17e5077c977");
    expect(CALIPER_NAMESPACE).toBe(IDS.namespace);
  });
});

describe("mintUrn", () => {
  it("writes the URN of the UUID that Python computed for every list of parts of the fixture", () => {
    for (const { parts, uuid } of IDS.names) expect(mintUrn(parts), JSON.stringify(parts)).toBe(`urn:uuid:${uuid}`);
  });

  it("names parts that a plain join would confuse by different identifiers", () => {
    const confusable = [
      mintUrn(["event", "a\nb", "start", 0]),
      mintUrn(["event", "a", "\nb", 0]),
      mintUrn(["event", "1", 1, 1]),
      mintUrn(["event", 1, "1", 1]),
    ];
    expect(new Set(confusable).size).toBe(confusable.length);
    expect(confusable).toStrictEqual([
      urnOf("event", "a\nb", "start", 0),
      urnOf("event", "a", "\nb", 0),
      urnOf("event", "1", 1, 1),
      urnOf("event", 1, "1", 1),
    ]);
  });

  it("keeps text outside ASCII and the characters JSON escapes as they are in the name", () => {
    expect(mintUrn(["event", "café ✓", "start", 0])).toBe(urnOf("event", "café ✓", "start", 0));
    expect(mintUrn(["event", 'a"b\\c', 7, 12])).toBe(urnOf("event", 'a"b\\c', 7, 12));
  });

  it("rejects parts that are not a non-empty array of strings and finite numbers", () => {
    const bad: [string, unknown][] = [
      ["null", fromJson("null")],
      ["a string", "event"],
      ["an object", fromJson('{"0":"event"}')],
      ["no parts", []],
      ["a null part", fromJson('["event",null]')],
      ["a boolean part", fromJson('["event",true]')],
      ["a nested array", fromJson('["event",["x"]]')],
      ["NaN", ["event", Number.NaN]],
      ["Infinity", ["event", Number.POSITIVE_INFINITY]],
    ];
    for (const [name, parts] of bad) expect(() => mintUrn(parts as never), name).toThrow(DataError);
    expect(() => mintUrn(["event", Number.NaN])).toThrow(
      "The list of parts is invalid at [1]: expected a string or a finite number.",
    );
  });

  it("gives the same URN for the same parts and a different URN for different parts", () => {
    const part = fc.oneof(fc.string(), fc.integer());
    fc.assert(
      fc.property(
        fc.array(part, { minLength: 1, maxLength: 5 }),
        fc.array(part, { minLength: 1, maxLength: 5 }),
        (a, b) => {
          expect(mintUrn(a)).toBe(mintUrn([...a]));
          fc.pre(JSON.stringify(a) !== JSON.stringify(b));
          expect(mintUrn(a)).not.toBe(mintUrn(b));
        },
      ),
      { numRuns: 80, seed: 20_261_101 },
    );
  });
});

describe("formatDateTime", () => {
  it("writes millisecond precision in UTC, as Caliper requires", () => {
    expect(formatDateTime(0, "The time")).toBe("1970-01-01T00:00:00.000Z");
    expect(formatDateTime(1_700_000_000_123, "The time")).toBe("2023-11-14T22:13:20.123Z");
    expect(formatDateTime(MAX_TIME, "The time")).toBe("9999-12-31T23:59:59.999Z");
  });

  it("truncates a fraction of a millisecond, as a deadline may have one", () => {
    expect(formatDateTime(1000.9, "The time")).toBe("1970-01-01T00:00:01.000Z");
  });

  it("rejects times that the form cannot write, and other types", () => {
    for (const bad of [
      -1,
      MAX_TIME + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      fromJson('"5"'),
      fromJson("null"),
      fromJson("[]"),
    ]) {
      expect(() => formatDateTime(bad, "The time of the event"), String(bad)).toThrow(DataError);
    }
    expect(() => formatDateTime(-1, "The time of the event")).toThrow(
      "The time of the event must be epoch milliseconds from 1970 to the end of the year 9999, found -1.",
    );
  });

  it("says what it found for a value that cannot be turned into text", () => {
    expect(() => formatDateTime(fromJson('{"toString":""}'), "The time")).toThrow(
      "The time must be epoch milliseconds from 1970 to the end of the year 9999, found an object.",
    );
    expect(() => formatDateTime(Object.create(null), "The time")).toThrow(DataError);
    expect(() => formatDateTime("5", "The time")).toThrow('found "5".');
  });

  it("writes a time that reads back as the same millisecond", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_TIME }), (at) => {
        const text = formatDateTime(at, "The time");
        expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
        expect(Date.parse(text)).toBe(at);
      }),
      { numRuns: 100, seed: 20_261_101 },
    );
  });
});

describe("checkIri", () => {
  it("accepts an absolute IRI of any scheme", () => {
    for (const iri of [ASSESSMENT, ACTOR, "mailto:a@b.example", "https://exam.example/tests/42#part"]) {
      expect(() => checkIri(iri, "The actor")).not.toThrow();
    }
  });

  it("rejects what is not an absolute IRI, and other types", () => {
    for (const bad of ["item-1", "/tests/42", "", "://x", fromJson("null"), 5, fromJson("[]")]) {
      expect(() => checkIri(bad, "The actor"), String(bad)).toThrow(DataError);
    }
    expect(() => checkIri("item-1", "The actor")).toThrow('The actor must be an absolute IRI, found "item-1".');
    expect(() => checkIri(5, "The actor")).toThrow("The actor must be a string, found 5.");
  });

  it("refuses white space that URL would remove or encode, as the readers refuse it in an entity", () => {
    for (const bad of [
      "https://exam.example/a b",
      "https://exam.\nexample/x",
      "https://exam.example/x\t",
      " https://exam.example",
    ]) {
      expect(() => checkIri(bad, "The actor"), JSON.stringify(bad)).toThrow(DataError);
    }
  });

  it("accepts what the readers take as the IRI of an entity, and nothing else", () => {
    const iriLike = fc.oneof(
      fc.webUrl({ withFragments: true, withQueryParameters: true }),
      fc
        .tuple(fc.webUrl(), fc.constantFrom(" ", "\t", "\n", "\r"), fc.string())
        .map(([url, space, rest]) => `${url}${space}${rest}`),
      fc.string(),
    );
    fc.assert(
      fc.property(iriLike, (value) => {
        fc.pre(!value.startsWith("_:"));
        const checked = (() => {
          try {
            checkIri(value, "The IRI");
            return true;
          } catch {
            return false;
          }
        })();
        const read = (() => {
          try {
            readEntity({ "@context": CALIPER_CONTEXT, id: value, type: "Person" });
            return true;
          } catch {
            return false;
          }
        })();
        expect(checked, JSON.stringify(value)).toBe(read);
      }),
      { numRuns: 300, seed: 20_261_103 },
    );
  });
});

describe("buildEvent", () => {
  it("writes the context and keeps every property of the input", () => {
    const input = startedInput();
    const event = buildEvent(input);
    expect(event).toStrictEqual({ "@context": CALIPER_CONTEXT, ...input });
    expect(event["@context"]).toBe("http://purl.imsglobal.org/ctx/caliper/v1p2");
  });

  it("leaves out generated when the input has none", () => {
    const { generated: _generated, ...input } = startedInput();
    const event = buildEvent(input);
    expect("generated" in event).toBe(false);
    expect(Object.keys(event)).toStrictEqual([
      "@context",
      "id",
      "type",
      "profile",
      "actor",
      "action",
      "object",
      "eventTime",
      "edApp",
    ]);
  });

  it("writes the same bytes for the same event whatever the order of the properties in the input", () => {
    const input = startedInput();
    const reversed = fromJson<EventInput>(JSON.stringify(Object.fromEntries(Object.entries(input).reverse())));
    expect(JSON.stringify(buildEvent(reversed))).toBe(JSON.stringify(buildEvent(input)));
  });

  it("shares nothing with the input and does not change it", () => {
    const input = startedInput();
    const before = JSON.stringify(input);
    const event = buildEvent(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(event.actor).not.toBe(input.actor);
    expect(event.object).not.toBe(input.object);
    expect(event.generated).not.toBe(input.generated);
  });

  it("builds an event of every type, profile and action that the build names, and every property of a score", () => {
    const entity: CaliperEntity = {
      id: "https://exam.example/scores/1",
      type: "Score",
      name: "Score 1",
      description: "The score of the first attempt",
      attempt: "urn:uuid:3f0c8a8e-7b8e-4b6a-9c1d-2a4f6e8b0c1d",
      maxScore: 10,
      scoreGiven: 7.5,
      scoredBy: "https://exam.example/raters/1",
      comment: "Well done",
      dateCreated: "2023-11-14T22:15:20.000Z",
      dateModified: "2023-11-14T22:16:20.000Z",
      extensions: { rubric: "A" },
    };
    const event = buildEvent({
      ...startedInput(),
      type: "GradeEvent",
      profile: "GradingProfile",
      action: "Graded",
      object: { id: urnOf("attempt", SESSION), type: "Attempt" },
      generated: entity,
    });
    expect(event.generated).toStrictEqual(entity);
  });

  it("accepts the UUID URN in capitals, which RFC 4122 allows on input", () => {
    const id = "urn:uuid:3F0C8A8E-7B8E-4B6A-9C1D-2A4F6E8B0C1D";
    expect(buildEvent({ ...startedInput(), id }).id).toBe(id);
  });

  const without = (input: Record<string, unknown>, key: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(input).filter(([name]) => name !== key));

  const changes: [string, (input: Record<string, unknown>) => Record<string, unknown>, string][] = [
    ["an id that is not a UUID URN", (i) => ({ ...i, id: "https://exam.example/events/1" }), "at id"],
    ["an id as a number", (i) => ({ ...i, id: 5 }), "at id"],
    ["a type that is not an event of Caliper", (i) => ({ ...i, type: "RobotEvent" }), "expected an event of any class"],
    ["a profile that is not a profile of Caliper", (i) => ({ ...i, profile: "PlayProfile" }), "at profile"],
    ["an action that is not built", (i) => ({ ...i, action: "Began" }), "at action"],
    ["an actor that is not an agent", (i) => ({ ...i, actor: { id: ACTOR, type: "Document" } }), "at actor"],
    ["an actor whose id is relative", (i) => ({ ...i, actor: { id: "person-1", type: "Person" } }), "at actor.id"],
    ["an actor of an unknown type", (i) => ({ ...i, actor: { id: ACTOR, type: "Robot" } }), "at actor"],
    [
      "an object with a property that is not built",
      (i) => ({ ...i, object: { id: ASSESSMENT, type: "Assessment", dateToSubmit: "x" } }),
      "at object",
    ],
    [
      "a generated entity whose time is not in the form",
      (i) => ({ ...i, generated: { id: ASSESSMENT, type: "Attempt", startedAtTime: "2023-11-14" } }),
      "at generated.startedAtTime",
    ],
    [
      "a generated entity with a score that is not finite",
      (i) => ({ ...i, generated: { id: ASSESSMENT, type: "Score", scoreGiven: Number.NaN } }),
      "generated.scoreGiven is the number NaN",
    ],
    [
      "a name as a number",
      (i) => ({ ...i, object: { id: ASSESSMENT, type: "Assessment", name: 5 } }),
      "at object.name",
    ],
    ["a time that is not in the form", (i) => ({ ...i, eventTime: "2023-11-14 22:13:20" }), "at eventTime"],
    ["a time with an offset", (i) => ({ ...i, eventTime: "2023-11-14T22:13:20.000+00:00" }), "at eventTime"],
    ["a time that is not a date", (i) => ({ ...i, eventTime: "2023-02-30T10:00:00.000Z" }), "at eventTime"],
    ["a time as epoch milliseconds", (i) => ({ ...i, eventTime: EVENT_TIME }), "at eventTime"],
    ["an application that is not an IRI", (i) => ({ ...i, edApp: "exam" }), "at edApp"],
    ["a property that is not built", (i) => ({ ...i, nickname: 1 }), "unexpected property"],
    ["no actor", (i) => without(i, "actor"), "missing the property"],
    ["no object", (i) => without(i, "object"), "missing the property"],
    ["no time", (i) => without(i, "eventTime"), "missing the property"],
  ];

  it.each(changes)("rejects %s, and names where", (_name, change, where) => {
    const input = change(JSON.parse(JSON.stringify(startedInput())));
    expect(() => buildEvent(input as never)).toThrow(DataError);
    expect(() => buildEvent(input as never)).toThrow(where);
  });

  it("rejects an input that is not an object", () => {
    for (const bad of [fromJson("null"), fromJson("[]"), "event", 5, undefined]) {
      expect(() => buildEvent(bad as never), String(bad)).toThrow(DataError);
    }
    expect(() => buildEvent(fromJson("[]"))).toThrow(
      "The event is invalid: expected an event of any class, found an array.",
    );
  });

  it("builds an event that is valid JSON-LD input for any valid time, identifier and score", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_TIME }), fc.string(), SCORES, (at, session, score) => {
        const time = formatDateTime(at, "The time");
        const event: CaliperEvent = buildEvent({
          ...startedInput(),
          id: mintUrn(["event", session, at]),
          eventTime: time,
          type: "GradeEvent",
          profile: "GradingProfile",
          action: "Graded",
          object: { id: urnOf("attempt", SESSION), type: "Attempt" },
          generated: { id: "https://exam.example/scores/1", type: "Score", scoreGiven: score, dateCreated: time },
        });
        expect(JSON.parse(JSON.stringify(event))).toStrictEqual(event);
        expect(event.eventTime).toBe(time);
      }),
      { numRuns: 80, seed: 20_261_101 },
    );
  });

  it("only ever throws a DataError for any JSON value, and for any change to a valid input", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        try {
          buildEvent(value as never);
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      { numRuns: 200, seed: 20_261_101 },
    );
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(startedInput())), fc.jsonValue(), (key, value) => {
        try {
          buildEvent({ ...startedInput(), [key]: value } as never);
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      { numRuns: 200, seed: 20_261_101 },
    );
  });
});

describe("the checks of identifiers, times and IRIs", () => {
  it("only ever throw a DataError for any JSON value", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        for (const run of [
          () => mintUrn(value as never),
          () => formatDateTime(value, "The time"),
          () => checkIri(value, "The IRI"),
        ]) {
          try {
            run();
          } catch (error) {
            expect(error).toBeInstanceOf(DataError);
          }
        }
      }),
      { numRuns: 200, seed: 20_261_101 },
    );
  });
});
