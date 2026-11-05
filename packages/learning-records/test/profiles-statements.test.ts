import { DataError, LimitError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { otherProfile, soundProfile } from "../../../scripts/xapi-profile-rules.js";
import { all, type Json, remove, set } from "../../../scripts/xapi-rules.js";
import { createProfileValidator, SUBREGISTRATION_EXTENSION } from "../src/profiles/index.js";
import { summary } from "./fixture.js";

const SPORTS = "http://example.org/profiles/sports";
const V2 = `${SPORTS}/v2`;
const EVENT = `${SPORTS}/activitytypes/event`;
const PLACED = `${SPORTS}/verbs/placed`;
const PLACE = `${SPORTS}/extensions/place`;
const START = `${SPORTS}/templates/start`;
const PLACING = `${SPORTS}/templates/placing`;
const RELAY = `${SPORTS}/patterns/relay`;
const REGISTRATION = "ec231277-b27b-4c15-8291-d29225b2b8f7";
const VERBS = {
  start: "http://adlnet.gov/expapi/verbs/attempted",
  handoff: "http://adlnet.gov/expapi/verbs/progressed",
  placing: PLACED,
} as const;

/** A Statement of a relay race that follows a template of the profile of the examples, at a second of the race. */
function race(kind: keyof typeof VERBS, second: number, registration: string | null = REGISTRATION): Json {
  return {
    id: `00000000-0000-4000-8000-${String(second).padStart(12, "0")}`,
    actor: { mbox: "mailto:runner@example.org" },
    verb: { id: VERBS[kind] },
    object: { id: "https://example.org/events/relay-2024", definition: { type: EVENT } },
    ...(kind === "placing" ? { result: { extensions: { [PLACE]: { rank: 1 } } } } : {}),
    context: {
      ...(registration === null ? {} : { registration }),
      contextActivities: {
        grouping: [{ id: `${SPORTS}/activities/100mdash`, definition: { type: EVENT } }],
        category: [{ id: V2 }],
      },
    },
    timestamp: `2024-06-13T10:00:${String(second).padStart(2, "0")}Z`,
  };
}

/** A Statement of the whole race: a start, handoffs and the placing. */
function wholeRace(registration = REGISTRATION): Json[] {
  return [
    race("start", 1, registration),
    race("handoff", 2, registration),
    race("handoff", 3, registration),
    race("placing", 4, registration),
  ];
}

describe("validating a Statement against the Statement Templates", () => {
  const validator = createProfileValidator(soundProfile());

  it("names the version of the profile that Statements name: the latest", () => {
    expect(validator.version).toBe(V2);
    const reordered = set("versions", [...(soundProfile().versions as Json[])].reverse())(soundProfile());
    expect(createProfileValidator(reordered).version).toBe(V2);
  });

  it("matches a Statement with the Determining Properties of a template that keeps its rules", () => {
    expect(validator.validateStatement(race("placing", 4))).toStrictEqual({
      outcome: "success",
      templates: [PLACING],
      issues: [],
    });
  });

  it("finds the rule of a template whose Determining Properties a Statement has and whose rule it breaks", () => {
    const verdict = validator.validateStatement(remove("result")(race("placing", 4)));
    expect(verdict.outcome).toBe("invalid");
    expect(verdict.templates).toStrictEqual([PLACING]);
    expect(verdict.issues).toStrictEqual([
      {
        path: "",
        rule: "rule-presence",
        message: `at $.result.extensions['${PLACE}']: expected a value, found none, by rules[0] of the Statement Template ${JSON.stringify(PLACING)}.`,
        severity: "error",
      },
    ]);
  });

  it("matches no template when a Determining Property is missing, and does not judge the rules then", () => {
    expect(
      validator.validateStatement(set("verb.id", "https://example.org/verbs/cheered")(race("placing", 4))),
    ).toStrictEqual({
      outcome: "unmatched",
      templates: [],
      issues: [],
    });
    const ungrouped = set("context.contextActivities.grouping", [{ id: "https://example.org/a" }])(
      remove("result")(race("placing", 4)),
    );
    expect(validator.validateStatement(ungrouped).outcome).toBe("unmatched");
    const otherObject = set("object", { objectType: "Agent", mbox: "mailto:coach@example.org" })(race("start", 1));
    expect(validator.validateStatement(otherObject).outcome).toBe("unmatched");
  });

  it("warns of a Statement that follows a template and does not name the version of the profile in category", () => {
    const verdict = validator.validateStatement(remove("context.contextActivities.category")(race("start", 1)));
    expect(verdict.outcome).toBe("success");
    expect(summary(verdict.issues)).toStrictEqual([
      { path: "context.contextActivities.category", rule: "profile-category", severity: "warning" },
    ]);
  });

  it("finds an extension of the profile out of its place", () => {
    const misplaced = set(`context.extensions`, { [PLACE]: { rank: 2 } })(race("placing", 4));
    expect(summary(validator.validateStatement(misplaced).issues)).toStrictEqual([
      { path: `context.extensions.${PLACE}`, rule: "extension-place", severity: "error" },
    ]);
    const inDefinition = set("object.definition.extensions", { [PLACE]: 1, "https://example.org/x": 2 })(
      race("start", 1),
    );
    expect(validator.validateStatement(inDefinition).issues[0]?.message).toBe(
      "expected a ResultExtension in a result, found it in an Activity Definition.",
    );
  });

  it("asks the usage types of the attachments and the activity types of every kind of context Activity", () => {
    const signed = "http://adlnet.gov/expapi/attachments/signature";
    const profile = set("templates.0", {
      ...(soundProfile().templates as Json[])[0],
      attachmentUsageType: [signed],
      contextParentActivityType: [EVENT],
      contextOtherActivityType: [EVENT],
      contextCategoryActivityType: [EVENT],
    })(soundProfile());
    const attachment = {
      usageType: signed,
      display: { en: "signature" },
      contentType: "application/octet-stream",
      length: 1,
      sha2: "a".repeat(64),
    };
    const statement = all(
      set("attachments", [attachment]),
      set("context.contextActivities.parent", [{ id: "https://example.org/a", definition: { type: EVENT } }]),
      set("context.contextActivities.other", [{ id: "https://example.org/b", definition: { type: EVENT } }]),
      set("context.contextActivities.category", [
        { id: V2 },
        { id: "https://example.org/c", definition: { type: EVENT } },
      ]),
    )(race("start", 1));
    const validator = createProfileValidator(profile);
    expect(validator.validateStatement(statement).outcome).toBe("success");
    expect(validator.validateStatement(remove("attachments")(statement)).outcome).toBe("unmatched");
  });

  it("refuses a value that is not a Statement of xAPI", () => {
    expect(() => validator.validateStatement(remove("actor")(race("start", 1)))).toThrow(DataError);
    expect(() => validator.validateStatement(JSON.parse("null"))).toThrow(DataError);
  });
});

/** A profile of one template with the given rules, whose verb is `placed`. */
function ruled(...rules: readonly Json[]): Json {
  return set("templates", [{ ...(soundProfile().templates as Json[])[2], rules }])(
    set("patterns", undefined)(soundProfile()),
  );
}

describe("the rules of a Statement Template", () => {
  const placing = race("placing", 4);
  const outcome = (rules: readonly Json[], statement: Json = placing) =>
    createProfileValidator(ruled(...rules)).validateStatement(statement);

  it("asks a value at an included location, in every place that a selector looks", () => {
    expect(outcome([{ location: "$.timestamp", presence: "included" }]).outcome).toBe("success");
    expect(
      outcome([{ location: `$.result.extensions['${PLACE}']`, selector: "$.rank", presence: "included" }]).outcome,
    ).toBe("success");
    expect(
      outcome([{ location: `$.result.extensions['${PLACE}']`, selector: "$.medal", presence: "included" }]).outcome,
    ).toBe("invalid");
  });

  it("asks no value at an excluded location, where a place without a selected value counts as none", () => {
    expect(outcome([{ location: "$.result.score", presence: "excluded" }]).outcome).toBe("success");
    expect(outcome([{ location: "$.timestamp", presence: "excluded" }]).outcome).toBe("invalid");
    expect(
      outcome([{ location: `$.result.extensions['${PLACE}']`, selector: "$.medal", presence: "excluded" }]).outcome,
    ).toBe("success");
  });

  it("asks the values of a recommended location only when it has one", () => {
    expect(outcome([{ location: "$.result.score.raw", presence: "recommended", any: [1] }]).outcome).toBe("success");
    expect(outcome([{ location: "$.verb.id", presence: "recommended", any: [VERBS.start] }]).outcome).toBe("invalid");
  });

  it("asks one of any, only values of all, and none of none, of an empty list as well", () => {
    expect(outcome([{ location: "$.verb.id", any: [PLACED, VERBS.start] }]).outcome).toBe("success");
    expect(outcome([{ location: "$.result.score.raw", any: [1] }]).outcome).toBe("invalid");
    expect(
      outcome([{ location: "$.context.contextActivities.*[*].id", all: [`${SPORTS}/activities/100mdash`, V2] }])
        .outcome,
    ).toBe("success");
    expect(outcome([{ location: "$.context.contextActivities.*[*].id", all: [V2] }]).outcome).toBe("invalid");
    expect(outcome([{ location: "$.result.score.raw", all: [1] }]).outcome).toBe("success");
    expect(outcome([{ location: "$.verb.id", none: [VERBS.start] }]).outcome).toBe("success");
    expect(outcome([{ location: "$.verb.id", none: [PLACED] }]).outcome).toBe("invalid");
  });

  it("refuses for all a place where the selector finds nothing", () => {
    const rule = { location: "$.context.contextActivities.grouping[*]", selector: "$.definition.name", all: ["x"] };
    expect(summary(outcome([rule]).issues)).toStrictEqual([{ path: "", rule: "rule-all", severity: "error" }]);
  });

  it("compares objects and arrays by their values", () => {
    expect(outcome([{ location: `$.result.extensions['${PLACE}']`, any: [{ rank: 1 }] }]).outcome).toBe("success");
    expect(
      outcome([{ location: `$.result.extensions['${PLACE}']`, any: [{ rank: 2 }, [1], { rank: 1, medal: "gold" }] }])
        .outcome,
    ).toBe("invalid");
    expect(outcome([{ location: "$.context.contextActivities.category", any: [[{ id: V2 }]] }]).outcome).toBe(
      "success",
    );
    expect(
      outcome([{ location: "$.context.contextActivities.category", none: [[{ id: V2 }, { id: V2 }]] }]).outcome,
    ).toBe("success");
  });

  it("lists every rule that a Statement breaks", () => {
    const verdict = outcome([
      { location: "$.result.score", presence: "included" },
      { location: "$.verb.id", none: [PLACED] },
    ]);
    expect(summary(verdict.issues)).toStrictEqual([
      { path: "", rule: "rule-presence", severity: "error" },
      { path: "", rule: "rule-none", severity: "error" },
    ]);
  });
});

describe("the StatementRef templates of a Statement Template", () => {
  const voided = race("start", 1);
  const profile = set("templates", [
    ...(soundProfile().templates as Json[]),
    {
      id: `${SPORTS}/templates/disqualified`,
      type: "StatementTemplate",
      inScheme: V2,
      prefLabel: { en: "Disqualified" },
      definition: { en: "A start that a referee disqualifies." },
      verb: "https://example.org/verbs/disqualified",
      objectStatementRefTemplate: [START],
      contextStatementRefTemplate: [START],
    },
  ])(soundProfile());
  /** The id after another in a chain of references: the last twelve digits counted up by one. */
  const nextId = (id: string) => `${id.slice(0, 24)}${String(Number(id.slice(24)) + 1).padStart(12, "0")}`;
  const referring = (id: string) => ({
    actor: { mbox: "mailto:referee@example.org" },
    verb: { id: "https://example.org/verbs/disqualified" },
    object: { objectType: "StatementRef", id },
    context: { statement: { objectType: "StatementRef", id }, contextActivities: { category: [{ id: V2 }] } },
  });

  it("passes a reference to a Statement that the checking system does not have", () => {
    expect(createProfileValidator(profile).validateStatement(referring(String(voided.id))).outcome).toBe("success");
  });

  it("passes a reference to a Statement that the host's lookup does not have", () => {
    const none = createProfileValidator(profile, { findStatement: () => undefined });
    expect(none.validateStatement(referring(String(voided.id))).outcome).toBe("success");
  });

  it("asks the Statement that the host finds to match one of the templates", () => {
    const found = createProfileValidator(profile, { findStatement: (id) => (id === voided.id ? voided : undefined) });
    expect(found.validateStatement(referring(String(voided.id))).outcome).toBe("success");
    const other = createProfileValidator(profile, { findStatement: () => race("placing", 4) });
    expect(summary(other.validateStatement(referring(String(voided.id))).issues)).toStrictEqual([
      { path: "", rule: "statement-ref", severity: "error" },
      { path: "", rule: "statement-ref", severity: "error" },
    ]);
  });

  it("asks a StatementRef as the object and in the context", () => {
    const validator = createProfileValidator(profile);
    const statement = set("object", { id: "https://example.org/events/relay-2024" })(
      remove("context.statement")(referring(String(voided.id))),
    );
    expect(validator.validateStatement(statement).issues.map(({ message }) => message.slice(0, 40))).toStrictEqual([
      "expected a StatementRef as the object of",
      "expected a StatementRef as context.state",
    ]);
  });

  it("refuses a Statement that the host's lookup returns and that is not one of xAPI", () => {
    const broken = createProfileValidator(profile, { findStatement: () => ({ verb: 1 }) });
    expect(() => broken.validateStatement(referring(String(voided.id)))).toThrow(/findStatement returned/u);
  });

  it("takes a Statement at the end of a chain of more than 64 references as not available, within the call stack", () => {
    const chained = all(
      set("templates.3.objectStatementRefTemplate", [`${SPORTS}/templates/disqualified`]),
      set("templates.3.contextStatementRefTemplate", [`${SPORTS}/templates/disqualified`]),
    )(profile);
    const chain = createProfileValidator(chained, { findStatement: (id) => ({ ...referring(nextId(id)), id }) });
    expect(chain.validateStatement(referring(nextId("00000000-0000-4000-8000-000000000000"))).outcome).toBe("success");
  });

  it("follows references that loop back without end", () => {
    const first = "00000000-0000-4000-8000-00000000000a";
    const second = "00000000-0000-4000-8000-00000000000b";
    const looping = all(
      set("templates.3.objectStatementRefTemplate", [`${SPORTS}/templates/disqualified`]),
      set("templates.3.contextStatementRefTemplate", [`${SPORTS}/templates/disqualified`]),
    )(profile);
    const statements = new Map<string, Json>([
      [first, { ...referring(second), id: first }],
      [second, { ...referring(first), id: second }],
    ]);
    const validator = createProfileValidator(looping, { findStatement: (id) => statements.get(id) });
    expect(validator.validateStatement(statements.get(first)).outcome).toBe("success");
  });
});

describe("validating the Statements of registrations against the Patterns", () => {
  const validator = createProfileValidator(soundProfile());

  it("finds that the Statements of a whole race follow the primary Pattern, in the order of their timestamps", () => {
    const statements = wholeRace().reverse();
    expect(validator.validateStatements(statements)).toStrictEqual({
      issues: [],
      registrations: [
        {
          registration: REGISTRATION,
          statements: [3, 2, 1, 0],
          outcome: "success",
          patterns: [{ pattern: RELAY, outcome: "success", remaining: 0 }],
        },
      ],
    });
  });

  it("finds a race that has not ended a partial match, and says that it follows no primary Pattern", () => {
    const verdict = validator.validateStatements(wholeRace().slice(0, 3));
    expect(verdict.registrations[0]?.patterns).toStrictEqual([{ pattern: RELAY, outcome: "partial", remaining: 0 }]);
    expect(verdict.registrations[0]?.outcome).toBe("failure");
    expect(summary(verdict.issues)).toStrictEqual([{ path: "[0]", rule: "pattern", severity: "error" }]);
  });

  it("finds the Statements of a race out of order a failure", () => {
    const shuffled = [race("handoff", 1), race("start", 2), race("placing", 3)];
    expect(validator.validateStatements(shuffled).registrations[0]?.patterns).toStrictEqual([
      { pattern: RELAY, outcome: "failure", remaining: 3 },
    ]);
  });

  it("judges each registration on its own, and leaves out Statements that do not name the profile", () => {
    const other = "4f2f1b46-4cf0-4b4c-9a2e-3b4f1f6a2c11";
    const statements = [
      ...wholeRace(),
      ...wholeRace(other).slice(0, 2),
      remove("context.contextActivities.category")(race("start", 9)),
    ];
    const verdict = validator.validateStatements(statements);
    expect(verdict.registrations.map(({ registration, outcome }) => [registration, outcome])).toStrictEqual([
      [REGISTRATION, "success"],
      [other, "failure"],
    ]);
  });

  it("asks every Statement that names the profile to match a template, and matches no Pattern when one does not", () => {
    const statements = [...wholeRace(), set("verb.id", "https://example.org/verbs/cheered")(race("handoff", 5))];
    const verdict = validator.validateStatements(statements);
    expect(summary(verdict.issues)).toStrictEqual([{ path: "[4]", rule: "template-unmatched", severity: "error" }]);
    expect(verdict.registrations[0]).toMatchObject({ outcome: "failure", patterns: [] });
    const broken = validator.validateStatements([...wholeRace().slice(0, 3), remove("result")(race("placing", 4))]);
    expect(summary(broken.issues)).toStrictEqual([{ path: "[3]", rule: "rule-presence", severity: "error" }]);
  });

  it("asks a registration of a Statement that follows a primary Pattern", () => {
    const verdict = validator.validateStatements([race("start", 1, null)]);
    expect(summary(verdict.issues)).toStrictEqual([{ path: "[0]", rule: "registration-missing", severity: "error" }]);
    expect(verdict.registrations).toStrictEqual([]);
  });

  it("holds the Statements of a profile without a primary Pattern to its templates alone", () => {
    const templatesOnly = createProfileValidator(set("patterns", undefined)(soundProfile()));
    const verdict = templatesOnly.validateStatements([race("start", 1, null), race("placing", 2)]);
    expect(verdict).toStrictEqual({
      issues: [],
      registrations: [{ registration: REGISTRATION, statements: [1], outcome: "success", patterns: [] }],
    });
  });

  it("tells the occurrences of a Pattern apart by their subregistration", () => {
    const sub = (statement: Json, id: string) =>
      set(`context.extensions`, { [SUBREGISTRATION_EXTENSION]: [{ profile: V2, subregistration: id }] })(statement);
    const first = "6f1e9c3a-2b4d-4e8f-9a1c-0d2e3f4a5b6c";
    const second = "7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
    const statements = [
      ...wholeRace().map((statement) => sub(statement, first)),
      sub(race("start", 5), second.toUpperCase()),
    ];
    const verdict = validator.validateStatements(statements);
    expect(verdict.registrations.map(({ subregistration, outcome }) => [subregistration, outcome])).toStrictEqual([
      [first, "success"],
      [second, "failure"],
    ]);
  });

  it("finds a subregistration without a registration, of the wrong form or for a profile not in category", () => {
    const extension = (value: unknown, registration: string | null = null) =>
      set(`context.extensions`, { [SUBREGISTRATION_EXTENSION]: value })(race("start", 1, registration));
    const statements = [
      extension([{ profile: V2, subregistration: "6f1e9c3a-2b4d-4e8f-9a1c-0d2e3f4a5b6c" }]),
      extension([], REGISTRATION),
      extension({ profile: V2 }, REGISTRATION),
      extension(
        [
          { profile: V2, subregistration: "6f1e9c3a-2b4d-4e8f-1a1c-0d2e3f4a5b6c" },
          "x",
          { profile: "v2", subregistration: "6f1e9c3a-2b4d-4e8f-9a1c-0d2e3f4a5b6c" },
        ],
        REGISTRATION,
      ),
      extension(
        [{ profile: "https://example.org/profiles/other/v1", subregistration: "6f1e9c3a-2b4d-4e8f-9a1c-0d2e3f4a5b6c" }],
        REGISTRATION,
      ),
    ];
    const findings = summary(validator.validateStatements(statements).issues).filter(({ rule }) =>
      rule.startsWith("subregistration"),
    );
    const at = `context.extensions.${SUBREGISTRATION_EXTENSION}`;
    expect(findings).toStrictEqual([
      { path: `[0].${at}`, rule: "subregistration-registration", severity: "error" },
      { path: `[1].${at}`, rule: "subregistration-form", severity: "error" },
      { path: `[2].${at}`, rule: "subregistration-form", severity: "error" },
      { path: `[3].${at}[0]`, rule: "subregistration-form", severity: "error" },
      { path: `[3].${at}[1]`, rule: "subregistration-form", severity: "error" },
      { path: `[3].${at}[2]`, rule: "subregistration-form", severity: "error" },
      { path: `[4].${at}[0]`, rule: "subregistration-profile", severity: "error" },
    ]);
  });

  it("warns of two Statements of a series at one time, which it orders by their place", () => {
    const statements = wholeRace();
    statements[2] = set("timestamp", "2024-06-13T10:00:02.000+00:00")(race("handoff", 3));
    const verdict = validator.validateStatements(statements);
    expect(summary(verdict.issues)).toStrictEqual([{ path: "[2]", rule: "timestamp-repeated", severity: "warning" }]);
    expect(verdict.registrations[0]?.outcome).toBe("success");
  });

  it("orders by the time of a timestamp of RFC 3339 with an unknown offset", () => {
    const statements = [
      race("placing", 4),
      set("timestamp", "2024-06-13T10:00:01-00:00")(race("start", 1)),
      race("handoff", 2),
    ];
    expect(validator.validateStatements(statements).registrations[0]?.outcome).toBe("success");
  });

  it("matches the subregistration of the profile among those of several profiles", () => {
    const other = "https://example.org/profiles/other/v1";
    const both = (statement: Json) =>
      all(
        set("context.contextActivities.category", [{ id: V2 }, { id: other }]),
        set("context.extensions", {
          [SUBREGISTRATION_EXTENSION]: [
            { profile: other, subregistration: "7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d" },
            { profile: V2, subregistration: "6f1e9c3a-2b4d-4e8f-9a1c-0d2e3f4a5b6c" },
          ],
        }),
      )(statement);
    const verdict = validator.validateStatements(wholeRace().map(both));
    expect(verdict.registrations).toMatchObject([
      { subregistration: "6f1e9c3a-2b4d-4e8f-9a1c-0d2e3f4a5b6c", outcome: "success" },
    ]);
  });

  it("puts a Statement without a timestamp where it stands", () => {
    const statements = [
      race("start", 1),
      remove("timestamp")(race("handoff", 2)),
      race("handoff", 3),
      race("placing", 4),
    ];
    expect(validator.validateStatements(statements).registrations[0]?.statements).toStrictEqual([0, 1, 2, 3]);
  });

  it("finds a referenced Statement among those of the list", () => {
    const profile = set("templates.1.objectStatementRefTemplate", [START])(
      remove("templates.1.objectActivityType")(soundProfile()),
    );
    const statements = [
      race("start", 1),
      { ...set("object", { objectType: "StatementRef", id: race("start", 1).id })(race("handoff", 2)) },
    ];
    const verdict = createProfileValidator(profile).validateStatements(statements);
    expect(verdict.issues.filter(({ rule }) => rule === "statement-ref")).toStrictEqual([]);
  });

  it("refuses a list that is not an array of Statements, or longer than maxStatements", () => {
    expect(() => validator.validateStatements(JSON.parse("{}"))).toThrow(DataError);
    expect(() => validator.validateStatements([race("start", 1), { id: 1 }])).toThrow(/at \[1\]/u);
    const short = createProfileValidator(soundProfile(), { maxStatements: 2 });
    expect(() => short.validateStatements(wholeRace())).toThrow(LimitError);
  });

  it("stops at maxFindings", () => {
    const few = createProfileValidator(soundProfile(), { maxFindings: 1 });
    const statements = [race("start", 1, null), race("start", 2, null)];
    expect(few.validateStatements(statements).issues.map(({ rule }) => rule)).toStrictEqual([
      "registration-missing",
      "findings-stopped",
    ]);
  });
});

describe("making a validator", () => {
  it("matches the templates of another profile that a Pattern reuses", () => {
    const timed = "https://example.org/profiles/timing/templates/timed";
    const reusing = set("patterns.1.oneOrMore", timed)(soundProfile());
    const validator = createProfileValidator(reusing, { profiles: [otherProfile()] });
    const stamp = set("verb.id", "https://example.org/profiles/timing/verbs/timed")(race("handoff", 2));
    expect(validator.validateStatement(stamp)).toMatchObject({ outcome: "success", templates: [timed] });
    expect(validator.validateStatements([race("start", 1), stamp, race("placing", 3)]).registrations[0]?.outcome).toBe(
      "success",
    );
  });

  it("refuses a profile whose primary Patterns reach a Pattern of another profile that holds itself, which never ends", () => {
    const timing = "https://example.org/profiles/timing/patterns";
    const looping = set("patterns", [
      { id: `${timing}/a`, type: "Pattern", optional: `${timing}/b` },
      { id: `${timing}/b`, type: "Pattern", optional: `${timing}/a` },
    ])(otherProfile());
    const reusing = set("patterns.1.oneOrMore", `${timing}/a`)(soundProfile());
    // The other profile is read by its shape, so the profile itself is sound; its matching would recurse without end.
    expect(() => createProfileValidator(reusing, { profiles: [looping] })).toThrow(
      new DataError(
        `The Pattern "${timing}/a", which a primary Pattern of the profile reaches, holds itself at some depth, which no Pattern may: fix the profile of the option profiles that defines it.`,
      ),
    );
  });

  it("refuses a profile whose primary Patterns reach a member that no profile given defines", () => {
    const reusing = set("patterns.1.oneOrMore", "https://example.org/profiles/timing/templates/timed")(soundProfile());
    expect(() => createProfileValidator(reusing)).toThrow(/pass the profile that defines it in profiles/u);
  });

  it("refuses a profile that is not valid, and options that are not the options", () => {
    expect(() => createProfileValidator(set("type", "Vocabulary")(soundProfile()))).toThrow(DataError);
    expect(() => createProfileValidator(soundProfile(), JSON.parse('{ "findStatement": "lookup" }'))).toThrow(
      DataError,
    );
    expect(() => createProfileValidator(soundProfile(), JSON.parse('{ "maxStatements": 0 }'))).toThrow(DataError);
    expect(() => createProfileValidator(soundProfile(), JSON.parse("null"))).toThrow(DataError);
  });

  it("refuses primary Patterns that reach more Patterns or members than the limits", () => {
    const chain = Array.from({ length: 1001 }, (_, index) => ({
      id: `${SPORTS}/patterns/chain-${index}`,
      type: "Pattern",
      ...(index === 0 ? { primary: true, prefLabel: { en: "Chain" }, definition: { en: "A long chain." } } : {}),
      optional: index === 1000 ? START : `${SPORTS}/patterns/chain-${index + 1}`,
    }));
    expect(() => createProfileValidator(set("patterns", chain)(soundProfile()))).toThrow(
      expect.objectContaining({ limit: "MAX_MATCHED_PATTERNS", maximum: 1000 }),
    );
    const wide = [
      {
        id: RELAY,
        type: "Pattern",
        primary: true,
        prefLabel: { en: "Wide" },
        definition: { en: "Many." },
        alternates: Array.from({ length: 10_001 }, () => START),
      },
    ];
    expect(() => createProfileValidator(set("patterns", wide)(soundProfile()))).toThrow(
      expect.objectContaining({ limit: "MAX_MATCHED_MEMBERS", maximum: 10_000 }),
    );
  });
});
