import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import { CALIPER_CONTEXT, LIBRARY_PROFILE_CONTEXT, readEntity } from "../src/index.js";
import { fromJson } from "./fixture.js";

/** A minimal entity describe: the properties that every entity has to have. */
const PERSON = { "@context": CALIPER_CONTEXT, id: "https://example.edu/users/554433", type: "Person" };

/** Reads a value and returns the sentence of the error, or `undefined` when the value reads. */
function refusal(value: unknown): string | undefined {
  try {
    readEntity(value);
    return undefined;
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    return error.message;
  }
}

describe("readEntity", () => {
  it("reads an entity with the context of Caliper and returns a copy that shares nothing with the input", () => {
    const input = deepFreeze({ ...PERSON, extensions: { nested: { list: [1, 2] } } });
    const entity = readEntity(input);
    expect(entity).toStrictEqual(input);
    expect(entity).not.toBe(input);
    expect(Reflect.get(entity, "extensions")).not.toBe(input.extensions);
  });

  it("puts the context first and keeps the properties it reads, in the order of the class", () => {
    const entity = readEntity({ type: "Person", id: PERSON.id, name: "Ada", "@context": CALIPER_CONTEXT });
    expect(Object.keys(entity)[0]).toBe("@context");
  });

  it("reads a list of contexts that ends with the context of Caliper, with an address or the terms of the sender before it", () => {
    const local = { query: "http://schema.org/query" };
    for (const context of [
      [CALIPER_CONTEXT],
      ["https://schema.org/docs/jsonldcontext.json", CALIPER_CONTEXT],
      [local, CALIPER_CONTEXT],
    ]) {
      expect(readEntity({ ...PERSON, "@context": context })["@context"]).toStrictEqual(context);
    }
  });

  it("reads the context of the Library Use Profile as the context of Caliper", () => {
    const entity = readEntity({
      "@context": LIBRARY_PROFILE_CONTEXT,
      id: "https://example.edu/library",
      type: "Library",
    });
    expect(entity.type).toBe("Library");
  });

  it.each([
    ["no context", undefined],
    ["an unknown context", "http://purl.imsglobal.org/ctx/caliper/v1p1"],
    [
      "a list that does not end with the context of Caliper",
      [CALIPER_CONTEXT, "https://schema.org/docs/jsonldcontext.json"],
    ],
    ["an empty list", []],
    ["a number", 7],
    ["null", null],
  ])("refuses %s as the context of the document", (_, context) => {
    const { "@context": _dropped, ...rest } = PERSON;
    expect(refusal(context === undefined ? rest : { ...PERSON, "@context": context })).toMatch(
      /^The entity is invalid/u,
    );
  });

  it("accepts a context of the sender's own inside an entity, where the specification lets a sender add one", () => {
    const entity = readEntity({
      ...PERSON,
      otherIdentifiers: [{ type: "SystemIdentifier", identifier: "a", identifierType: "Other" }],
    });
    expect(entity).toHaveProperty("otherIdentifiers");
    const nested = readEntity({
      "@context": CALIPER_CONTEXT,
      id: "https://example.edu/sections/1",
      type: "CourseSection",
      members: [{ "@context": { query: "http://schema.org/query" }, id: PERSON.id, type: "Person" }],
    });
    expect(nested).toHaveProperty("members");
  });

  it("reads an entity named by its IRI where the specification allows one, and by an object", () => {
    const base = { "@context": CALIPER_CONTEXT, id: "urn:uuid:3a648e68-f00d-4c08-aa59-8738e1884f2c", type: "Attempt" };
    expect(readEntity({ ...base, assignee: PERSON.id }).type).toBe("Attempt");
    expect(readEntity({ ...base, assignee: { id: PERSON.id, type: "Person" } }).type).toBe("Attempt");
  });

  it("reads a blank node identifier as the id of an entity, and an anonymous entity by its type IRI", () => {
    expect(Reflect.get(readEntity({ ...PERSON, id: "_:b0" }), "id")).toBe("_:b0");
    expect(Reflect.get(readEntity({ ...PERSON, id: "http://purl.imsglobal.org/caliper/Person" }), "id")).toBe(
      "http://purl.imsglobal.org/caliper/Person",
    );
  });

  it.each([
    ["a relative IRI", "users/554433"],
    ["white space", "https://example.edu/a b"],
    ["an empty string", ""],
    ["a blank node without a name", "_:"],
  ])("refuses %s as an id", (_, id) => {
    expect(refusal({ ...PERSON, id })).toBe(
      `The entity is invalid at id: expected an absolute IRI or a blank node identifier, found ${JSON.stringify(id)}.`,
    );
  });

  it("refuses an entity of a class that the property does not take, and says which classes it takes", () => {
    const base = { "@context": CALIPER_CONTEXT, id: "https://example.edu/attempts/1", type: "Attempt" };
    expect(refusal({ ...base, assignee: { id: "https://example.edu/o/1", type: "Document" } })).toBe(
      "The entity is invalid at assignee: expected an entity of type Person, or its IRI, found an entity of type Document.",
    );
    expect(refusal({ ...base, assignee: { id: "https://example.edu/o/1" } })).toBe(
      "The entity is invalid at assignee: expected an entity of type Person, or its IRI, found an object without a type.",
    );
    expect(refusal({ ...base, assignee: 7 })).toBe(
      "The entity is invalid at assignee: expected an entity of type Person, or its IRI, found 7.",
    );
  });

  it("takes a subtype where the specification names its supertype", () => {
    const base = { "@context": CALIPER_CONTEXT, id: "https://example.edu/scores/1", type: "Score" };
    for (const type of ["Person", "SoftwareApplication", "Organization", "CourseSection", "Group", "Agent"]) {
      expect(readEntity({ ...base, scoredBy: { id: "https://example.edu/who", type } }).type).toBe("Score");
    }
  });

  it("refuses a property that the class does not have, which belongs in extensions", () => {
    expect(refusal({ ...PERSON, nickname: "Ada" })).toBe('The entity is invalid: unexpected property "nickname".');
    expect(Reflect.get(readEntity({ ...PERSON, extensions: { nickname: "Ada" } }), "extensions")).toStrictEqual({
      nickname: "Ada",
    });
  });

  it("refuses a type that is not a class of Caliper, and a type of an event", () => {
    expect(refusal({ ...PERSON, type: "Robot" })).toBe(
      "The entity is invalid: expected an entity of any class, found an entity of type Robot.",
    );
    expect(refusal({ ...PERSON, type: "AssessmentEvent" })).toMatch(/expected an entity of any class/u);
  });

  it("refuses a type that is another class than the properties read", () => {
    expect(refusal({ "@context": CALIPER_CONTEXT, id: PERSON.id, type: ["Person"] })).toMatch(
      /^The entity is invalid/u,
    );
  });

  it("requires the properties that the tables mark as required, in the classes that have them", () => {
    const at = (type: string, rest: object) => ({
      "@context": CALIPER_CONTEXT,
      id: "https://example.edu/x",
      type,
      ...rest,
    });
    expect(refusal(at("AggregateMeasure", { metric: "UnitsCompleted" }))).toBe(
      'The entity is invalid: missing the property "metricValue".',
    );
    expect(refusal(at("AggregateMeasure", { metricValue: 1 }))).toBe(
      'The entity is invalid: missing the property "metric".',
    );
    expect(refusal(at("Questionnaire", {}))).toBe('The entity is invalid: missing the property "items".');
    expect(refusal({ "@context": CALIPER_CONTEXT, type: "TextPositionSelector", start: 1 })).toBe(
      'The entity is invalid: missing the property "end".',
    );
    expect(refusal({ "@context": CALIPER_CONTEXT, type: "SystemIdentifier", identifier: "a" })).toBe(
      'The entity is invalid: missing the property "identifierType".',
    );
  });

  it("reads the two entities that have no id without one", () => {
    expect(readEntity({ "@context": CALIPER_CONTEXT, type: "TextPositionSelector", start: 0, end: 5 }).type).toBe(
      "TextPositionSelector",
    );
    const identifier = {
      "@context": CALIPER_CONTEXT,
      type: "SystemIdentifier",
      identifier: "a",
      identifierType: "EmailAddress",
    };
    expect(readEntity(identifier)).toStrictEqual(identifier);
  });

  it.each([
    ["a time with an offset", { dateCreated: "2016-11-15T10:15:00.000+02:00" }],
    ["a time without milliseconds", { dateCreated: "2016-11-15T10:15:00Z" }],
    ["a date that does not exist", { dateCreated: "2016-02-30T10:15:00.000Z" }],
    ["a leap second", { dateCreated: "2016-12-31T23:59:60.000Z" }],
    ["a number for a time", { dateCreated: 1_479_204_900_000 }],
    ["a number for a name", { name: 7 }],
    ["a list for a description", { description: ["a"] }],
  ])("refuses %s", (_, rest) => {
    expect(refusal({ ...PERSON, ...rest })).toMatch(/^The entity is invalid at (dateCreated|name|description): /u);
  });

  it("reads a duration of ISO 8601 and refuses what is not one", () => {
    const at = (duration: unknown) => ({
      "@context": CALIPER_CONTEXT,
      id: "https://example.edu/a/1",
      type: "Attempt",
      duration,
    });
    for (const good of ["PT10M30S", "P1D", "P1Y2M3DT4H5M6S", "P2W", "PT0.5S"])
      expect(readEntity(at(good)).type).toBe("Attempt");
    for (const bad of ["P", "PT", "10 minutes", "18m", "PT-5S", "P1DT", 600]) {
      expect(refusal(at(bad)), String(bad)).toMatch(/^The entity is invalid at duration: /u);
    }
  });

  it("reads a count as an integer from 0 to 4,294,967,295", () => {
    const at = (count: unknown) => ({
      "@context": CALIPER_CONTEXT,
      id: "https://example.edu/a/1",
      type: "Attempt",
      count,
    });
    for (const good of [0, 1, 4_294_967_295]) expect(readEntity(at(good)).type).toBe("Attempt");
    for (const bad of [-1, 1.5, 4_294_967_296, Number.NaN, "1", null])
      expect(refusal(at(bad)), String(bad)).toMatch(/count/u);
  });

  it("reads a decimal as any finite number", () => {
    const at = (maxScore: unknown) => ({
      "@context": CALIPER_CONTEXT,
      id: "https://example.edu/s/1",
      type: "Score",
      maxScore,
    });
    for (const good of [0, -1.5, 25, 1e300]) expect(readEntity(at(good)).type).toBe("Score");
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, "25"])
      expect(refusal(at(bad)), String(bad)).toMatch(/maxScore/u);
  });

  it("refuses a term outside the vocabulary of its property", () => {
    const membership = { "@context": CALIPER_CONTEXT, id: "https://example.edu/m/1", type: "Membership" };
    expect(
      readEntity({ ...membership, roles: ["Learner", "Instructor#TeachingAssistant"], status: "Active" }).type,
    ).toBe("Membership");
    expect(refusal({ ...membership, roles: ["Learner", "Not A Known Role"] })).toBe(
      'The entity is invalid at roles[1]: expected a role of Caliper, found "Not A Known Role".',
    );
    expect(refusal({ ...membership, status: "Retired" })).toBe(
      'The entity is invalid at status: expected a status of Caliper, found "Retired".',
    );
    expect(
      refusal({ "@context": CALIPER_CONTEXT, id: "https://example.edu/l/1", type: "LtiLink", messageType: "Unknown" }),
    ).toMatch(/expected an LTI message type of Caliper/u);
  });

  it("reads a list that the model keeps in order, and refuses a member of the wrong kind", () => {
    const at = (rest: object) => ({
      "@context": CALIPER_CONTEXT,
      id: "https://example.edu/c/1",
      type: "Assessment",
      ...rest,
    });
    const item = { id: "https://example.edu/i/1", type: "AssessmentItem" };
    expect(readEntity(at({ items: [item, "https://example.edu/i/2"] }))).toHaveProperty("items");
    expect(refusal(at({ items: [{ id: "https://example.edu/i/1", type: "Person" }] }))).toMatch(
      /at items\[0\]: expected an entity of type AssessmentItem/u,
    );
    expect(refusal(at({ items: item }))).toMatch(/at items: expected an array/u);
  });

  it("refuses a value that is not JSON, and copies nothing from the prototype", () => {
    expect(refusal({ ...PERSON, extensions: { at: new Date(0) } })).toBe(
      "The entity is invalid: extensions.at is an object that is not plain, which JSON cannot hold.",
    );
    expect(refusal({ ...PERSON, extensions: { fn: () => 1 } })).toBe(
      "The entity is invalid: extensions.fn is a function, which JSON cannot hold.",
    );
    expect(refusal({ ...PERSON, extensions: { n: Number.NaN } })).toBe(
      "The entity is invalid: extensions.n is the number NaN, which JSON cannot write.",
    );
    for (const name of ["__proto__", "constructor", "prototype"]) {
      const polluted = fromJson<Record<string, unknown>>(
        `{"@context":"${CALIPER_CONTEXT}","id":"${PERSON.id}","type":"Person","extensions":{"a":{"${name}":{"admin":true}}}}`,
      );
      expect(refusal(polluted)).toBe(
        `The entity is invalid: extensions.a.${name} is refused, since __proto__, constructor and prototype are names of the prototype chain, which a reader would drop or misread.`,
      );
    }
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it.each([null, undefined, "Person", 7, true, [], [PERSON], () => PERSON])(
    "refuses %j, which is not an entity",
    (value) => {
      expect(refusal(value)).toMatch(/^The entity is invalid/u);
    },
  );

  it("reads input as JSON passes it, whatever the JSON holds", () => {
    expect(refusal(fromJson('{"@context":null}'))).toMatch(/^The entity is invalid/u);
    expect(
      refusal(fromJson('{"@context":"http://purl.imsglobal.org/ctx/caliper/v1p2","id":5,"type":"Person"}')),
    ).toMatch(/at id/u);
    expect(
      refusal(
        fromJson('{"@context":"http://purl.imsglobal.org/ctx/caliper/v1p2","id":"https://a.example/1","type":{"a":1}}'),
      ),
    ).toMatch(/^The entity is invalid/u);
  });

  it("refuses a value that nests too deep, where the schemas would exhaust the stack", () => {
    let value: Record<string, unknown> = { id: "https://a.example/0", type: "Document" };
    for (let depth = 1; depth < 100_000; depth += 1)
      value = { id: `https://a.example/${depth}`, type: "Document", isPartOf: value };
    expect(refusal({ ...PERSON, ...value })).toMatch(
      /^The entity is invalid: isPartOf(\.isPartOf)+ nests more than 64 levels/u,
    );
  });

  it("gives a DataError and nothing else for any value of JSON", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(refusal(value)).toBeTypeOf("string");
      }),
      { seed: 20_241_102, numRuns: 300 },
    );
  });

  it("gives a DataError and nothing else for an entity with one property of any value", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("id", "type", "name", "assignee", "extensions", "otherIdentifiers", "dateCreated", "@context"),
        fc.anything(),
        (key, value) => {
          const result = refusal({ ...PERSON, [key]: value });
          if (result !== undefined) expect(result).toMatch(/^The entity is invalid/u);
        },
      ),
      { seed: 20_241_102, numRuns: 300 },
    );
  });
});
