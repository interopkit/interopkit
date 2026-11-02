import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ENTITY_RULES, RULES, SOUND_EVENT } from "../../../scripts/caliper-rules.js";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import { buildEvent, type EventInput, validateEntity, validateEvent } from "../src/index.js";
import { fromJson } from "./fixture.js";

/** What a finding says besides its sentence, which is what the table of rules compares. */
const shortOf = (findings: readonly { path: string; rule: string; severity: string }[]) =>
  findings.map(({ path, rule, severity }) => ({ path, rule, severity }));

/** The input of `buildEvent`: an event without its `@context`, which the builder writes. */
function inputOf(event: Record<string, unknown>): EventInput {
  const { "@context": _context, ...input } = event;
  return fromJson<EventInput>(JSON.stringify(input));
}

describe("validateEvent: the rules of the profiles", () => {
  it("finds nothing in an event that follows every rule", () => {
    expect(validateEvent(SOUND_EVENT)).toStrictEqual([]);
  });

  it.each(RULES.map((rule) => [rule.text, rule] as const))("finds what the sentence says: %s", (_, rule) => {
    expect(shortOf(validateEvent(rule.fixture(SOUND_EVENT)))).toStrictEqual(rule.findings);
  });

  it("says in a sentence what is wrong and what is expected, after the path", () => {
    const [finding] = validateEvent(
      RULES.find(({ findings }) => findings[0]?.rule === "profile-actor")?.fixture(SOUND_EVENT),
    );
    expect(finding).toStrictEqual({
      path: "actor",
      rule: "profile-actor",
      severity: "error",
      message: "expected Person to LoggedIn, found an entity of type SoftwareApplication.",
    });
  });

  it("does not change the event it is given", () => {
    const event = deepFreeze(fromJson<Record<string, unknown>>(JSON.stringify(SOUND_EVENT)));
    expect(() => validateEvent(event)).not.toThrow();
    expect(event).toStrictEqual(SOUND_EVENT);
  });

  it("judges an entity that is given as its IRI by nothing but its place", () => {
    const event = { ...SOUND_EVENT, actor: "https://example.edu/users/554433", object: "https://example.edu/assess/1" };
    expect(validateEvent({ ...event, generated: "https://example.edu/attempts/1" })).toStrictEqual([]);
  });

  it("does not judge the target of a media event, or the object of a timeout, that is given as an IRI", () => {
    const media = RULES.find(({ findings }) => findings[0]?.rule === "media-location-time")?.fixture(SOUND_EVENT) ?? {};
    expect(validateEvent({ ...media, target: "https://example.edu/videos/1/location" })).toStrictEqual([]);
    const timeout = RULES.find(({ text }) => text.startsWith("If a Session is expressed"))?.fixture(SOUND_EVENT) ?? {};
    expect(shortOf(validateEvent({ ...timeout, object: "https://example.edu/sessions/1" }))).toStrictEqual([]);
  });

  it("judges an event of no profile against the profiles that have its type", () => {
    const { profile: _profile, ...event } = SOUND_EVENT;
    expect(shortOf(validateEvent(event))).toStrictEqual([
      { path: "profile", rule: "profile-missing", severity: "warning" },
    ]);
  });
});

describe("validateEvent: the shape", () => {
  it("lists what the reader refuses, with the path and the rule, and leaves the rules of the profile alone", () => {
    const findings = validateEvent({ ...SOUND_EVENT, actor: { id: "person-1", type: "Person" }, nickname: 1 });
    expect(shortOf(findings)).toStrictEqual([
      { path: "actor.id", rule: "invalid-format", severity: "error" },
      { path: "nickname", rule: "unknown-property", severity: "error" },
    ]);
  });

  it.each([
    ["null", "null"],
    ["a string", '"event"'],
    ["an array", "[]"],
    ["a number", "7"],
  ])("lists %s as one error", (_, text) => {
    const findings = validateEvent(fromJson(text));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "", severity: "error" });
    expect(findings[0]?.message).toContain("expected");
  });

  it("lists a value that is not JSON as one error that says where", () => {
    const findings = validateEvent({ ...SOUND_EVENT, extensions: { at: new Date(0) } });
    expect(findings).toStrictEqual([
      {
        path: "",
        rule: "invalid-value",
        severity: "error",
        message: "extensions.at is an object that is not plain, which JSON cannot hold.",
      },
    ]);
  });

  it("lists a value that nests deeper than 64 levels as one error, without reading it", () => {
    let nested: unknown = {};
    for (let level = 0; level < 100; level += 1) nested = { next: nested };
    const findings = validateEvent({ ...SOUND_EVENT, extensions: nested });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: "invalid-value", severity: "error" });
    expect(findings[0]?.message).toContain("nests more than");
  });
});

describe("validateEvent: a value that nests too deep", () => {
  it("lists one error for a chain that would exhaust the stack of the schemas, and reads none of it", () => {
    let chain: Record<string, unknown> = { id: "https://a.example/0", type: "Document" };
    for (let depth = 1; depth < 100_000; depth += 1) {
      chain = { id: `https://a.example/${depth}`, type: "Document", isPartOf: chain };
    }
    const findings = validateEvent({ ...SOUND_EVENT, object: chain });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "", rule: "invalid-value", severity: "error" });
    expect(findings[0]?.message).toMatch(/^object(\.isPartOf)+ nests more than 64 levels/u);
  });
});

describe("validateEvent: the limit of findings", () => {
  const wrong = (count: number) => ({
    ...SOUND_EVENT,
    object: { id: "https://example.edu/assess/1", type: "Assessment", items: new Array(count).fill(0) },
  });

  it("stops at maxFindings and ends the list with a finding that says so", () => {
    const findings = validateEvent(wrong(5_000), { maxFindings: 3 });
    expect(findings).toHaveLength(4);
    expect(findings.at(-1)).toMatchObject({ path: "", rule: "findings-stopped", severity: "error" });
    expect(findings.slice(0, 3).map(({ path }) => path)).toStrictEqual([
      "object.items[0]",
      "object.items[1]",
      "object.items[2]",
    ]);
  });

  it("lists every finding of a value that is wrong in fewer places than the limit, and no last finding", () => {
    expect(validateEvent(wrong(3), { maxFindings: 3 })).toHaveLength(3);
  });

  it("stops at 1,000 findings unless the caller says otherwise", () => {
    expect(validateEvent(wrong(5_000))).toHaveLength(1_001);
  });
});

describe("validateEntity", () => {
  it.each(ENTITY_RULES.map((rule) => [rule.text, rule] as const))("finds what the sentence says: %s", (_, rule) => {
    expect(shortOf(validateEntity(rule.entity))).toStrictEqual(rule.findings);
  });

  it("lists what the reader of entities refuses, as errors", () => {
    const findings = validateEntity({
      "@context": "http://purl.imsglobal.org/ctx/caliper/v1p2",
      id: "person-1",
      type: "Person",
    });
    expect(shortOf(findings)).toStrictEqual([{ path: "id", rule: "invalid-format", severity: "error" }]);
    expect(shortOf(validateEntity(fromJson('{"id":"https://example.edu/p","type":"Person"}')))).toStrictEqual([
      { path: '["@context"]', rule: "missing-property", severity: "error" },
    ]);
  });

  it("finds nothing in an entity of a class that no profile advises anything of", () => {
    const person = {
      "@context": "http://purl.imsglobal.org/ctx/caliper/v1p2",
      id: "https://example.edu/p",
      type: "Person",
    };
    expect(validateEntity(person)).toStrictEqual([]);
  });

  it("stops at maxFindings", () => {
    const section = {
      "@context": "http://purl.imsglobal.org/ctx/caliper/v1p2",
      id: "https://example.edu/sections/1",
      type: "CourseSection",
      members: new Array(500).fill(0),
    };
    const findings = validateEntity(section, { maxFindings: 2 });
    expect(findings.map(({ rule }) => rule)).toStrictEqual(["invalid-format", "invalid-format", "findings-stopped"]);
  });
});

describe("validateEvent and validateEntity: input of other types", () => {
  it.each([
    ["null options", "null"],
    ["options as an array", "[]"],
    ["options as text", '"1000"'],
    ["a limit as text", '{"maxFindings":"3"}'],
    ["a limit of 0", '{"maxFindings":0}'],
    ["a limit that is no integer", '{"maxFindings":1.5}'],
    ["an option that does not exist", '{"language":"en"}'],
    ["a version that no reader knows", '{"version":"1.0"}'],
    ["a version as a number", '{"version":1.1}'],
  ])("refuses %s with a DataError", (_, text) => {
    const options = fromJson<never>(text);
    expect(() => validateEvent(SOUND_EVENT, options)).toThrow(DataError);
    expect(() => validateEntity(SOUND_EVENT, options)).toThrow(DataError);
  });

  it("says what the option must be", () => {
    expect(() => validateEvent(SOUND_EVENT, fromJson<never>('{"maxFindings":0}'))).toThrow(
      "The validate options is invalid at maxFindings",
    );
  });

  it("never throws for any JSON value, and never lists more than the limit and one finding", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        for (const findings of [validateEvent(value), validateEntity(value)]) {
          expect(findings.length).toBeLessThanOrEqual(1_001);
          for (const finding of findings) expect(["error", "warning"]).toContain(finding.severity);
        }
      }),
      { numRuns: 200, seed: 20_261_102 },
    );
  });

  it("never throws for any value that is not JSON either", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => validateEvent(value)).not.toThrow();
        expect(() => validateEntity(value)).not.toThrow();
      }),
      { numRuns: 200, seed: 20_261_102 },
    );
  });
});

describe("buildEvent: the rules of the profile", () => {
  it("builds an event that follows every rule", () => {
    expect(buildEvent(inputOf(SOUND_EVENT)).type).toBe("AssessmentEvent");
  });

  it.each(RULES.map((rule) => [rule.text, rule] as const))(
    "agrees with validateEvent on the sentence: %s",
    (_, rule) => {
      const input = inputOf(rule.fixture(SOUND_EVENT));
      const errors = rule.findings.filter(({ severity }) => severity === "error");
      const [first] = errors;
      if (first === undefined) {
        expect(buildEvent(input).id).toBe(SOUND_EVENT.id);
      } else {
        expect(() => buildEvent(input)).toThrow(DataError);
        expect(() => buildEvent(input)).toThrow(
          first.path === "" ? /^The event is invalid:/u : new RegExp(`^The event is invalid at ${first.path}:`, "u"),
        );
      }
    },
  );

  it("counts the errors beyond the first, and names the function that lists them", () => {
    const input = inputOf({
      ...SOUND_EVENT,
      type: "MediaEvent",
      profile: "ForumProfile",
      action: "Muted",
      object: { id: "https://example.edu/videos/1", type: "VideoObject" },
      generated: undefined,
      target: { id: "https://example.edu/videos/1/location", type: "MediaLocation" },
    });
    expect(() => buildEvent(input)).toThrow(
      "The event is invalid at profile: expected a profile that has MediaEvent, found ForumProfile; MediaEvent is in MediaProfile. 1 more error: validateEvent lists every finding.",
    );
  });
});
