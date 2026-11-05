import { DataError, LimitError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { otherProfile, soundProfile } from "../../../scripts/xapi-profile-rules.js";
import { type Json, set } from "../../../scripts/xapi-rules.js";
import { MAX_JSON_PATH_LENGTH, readProfile, validateProfile } from "../src/profiles/index.js";
import { parseJsonPath, selectJsonPath } from "../src/profiles/internal.js";
import { sharesNothing, summary } from "./fixture.js";

/** The ids of the objects that the profile of the examples defines. */
const SPORTS = "http://example.org/profiles/sports";
const PLACED = `${SPORTS}/verbs/placed`;
const EVENT = `${SPORTS}/activitytypes/event`;

/** Changes the sound profile with a list of changes, in order. */
function changed(...steps: readonly ((profile: Json) => Json)[]): Json {
  return steps.reduce((profile, step) => step(profile), soundProfile());
}

describe("reading a profile", () => {
  it("returns a copy that shares nothing with the input, with the properties that are IRIs", () => {
    const input = set("dcterms:license", "https://www.apache.org/licenses/LICENSE-2.0")(soundProfile());
    const profile = readProfile(input);
    expect(profile).toStrictEqual(input);
    expect(sharesNothing(profile, input)).toBe(true);
  });

  it("reads the text of the JSON of a profile", () => {
    expect(readProfile(JSON.stringify(soundProfile()))).toStrictEqual(soundProfile());
  });

  it("refuses a text with more tokens than maxTokens before it parses it", () => {
    const text = JSON.stringify(soundProfile());
    expect(() => readProfile(text, { maxTokens: 100 })).toThrow(LimitError);
    try {
      validateProfile(text, { maxTokens: 100 });
      expect.unreachable();
    } catch (caught) {
      expect(caught).toMatchObject({ limit: "maxTokens", maximum: 100 });
    }
  });

  it("refuses a text of more bytes than maxBytes, 1,300,000 by default, before it parses it, and one string counts in full", () => {
    const text = JSON.stringify(soundProfile());
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(readProfile(text, { maxBytes: bytes })).toStrictEqual(soundProfile());
    expect(() => validateProfile(text, { maxBytes: bytes - 1 })).toThrow(
      expect.objectContaining({ limit: "maxBytes", maximum: bytes - 1 }),
    );
    // A text of a few tokens and many bytes: one string of more than the default, which the tokens let through.
    const long = JSON.stringify({ ...soundProfile(), seeAlso: `https://example.org/${"a".repeat(1_300_000)}` });
    expect(() => readProfile(long)).toThrow(expect.objectContaining({ limit: "maxBytes", maximum: 1_300_000 }));
    expect(() => readProfile(soundProfile(), { profiles: [long] })).toThrow(
      expect.objectContaining({ limit: "maxBytes" }),
    );
    expect(() => readProfile(text, JSON.parse('{ "maxBytes": 0 }'))).toThrow(/maxBytes/u);
  });

  it("refuses a text that nests deeper than 64 levels, and one that is not JSON", () => {
    expect(() => readProfile(`${"[".repeat(65)}${"]".repeat(65)}`)).toThrow(
      expect.objectContaining({ limit: "maxDepth" }),
    );
    expect(() => readProfile("{ id: 1 }")).toThrow(/The profile is not JSON/u);
  });

  it("says where the first error is and how many more there are", () => {
    const input = changed(set("type", "Vocabulary"), set("conformsTo", "not a uri"));
    expect(() => readProfile(input)).toThrow(
      'The profile is invalid at type: expected "Profile", found "Vocabulary". 1 more error: validateProfile lists every finding.',
    );
  });

  it("finds the shape alone of a value whose shape is wrong, and does not throw", () => {
    expect(summary(validateProfile(JSON.parse("[]")))).toStrictEqual([
      { path: "", rule: "wrong-type", severity: "error" },
    ]);
    expect(summary(validateProfile(changed(set("versions", "v1"))))).toStrictEqual([
      { path: "versions", rule: "wrong-type", severity: "error" },
    ]);
  });

  it("stops at maxFindings and says that it stopped", () => {
    const input = set(
      "concepts",
      Array.from({ length: 5 }, (_, index) => ({
        id: `${SPORTS}/verbs/${index}`,
        type: "Verb",
        inScheme: "https://example.org/v9",
        prefLabel: { en: "x" },
        definition: { en: "x" },
      })),
    )(soundProfile());
    const findings = validateProfile(input, { maxFindings: 2 });
    expect(findings.map(({ rule }) => rule)).toStrictEqual(["in-scheme", "in-scheme", "findings-stopped"]);
  });

  it("reads a profile of a vocabulary alone, and one with its metadata alone", () => {
    expect(validateProfile(changed(set("templates", undefined), set("patterns", undefined)))).toStrictEqual([]);
    expect(
      validateProfile(changed(set("concepts", undefined), set("templates", undefined), set("patterns", undefined))),
    ).toStrictEqual([]);
  });

  it("finds a time of a version that is not a Timestamp, and a value of a rule that is not JSON", () => {
    expect(summary(validateProfile(changed(set("versions.1.generatedAtTime", "2010-01-14"))))).toStrictEqual([
      { path: "versions[1].generatedAtTime", rule: "invalid-format", severity: "error" },
    ]);
    const input = changed(set("templates.2.rules.0.any", [Number.POSITIVE_INFINITY]));
    expect(summary(validateProfile(input))).toStrictEqual([
      { path: "templates[2].rules[0].any[0]", rule: "invalid-value", severity: "error" },
    ]);
  });

  it("refuses options that are not what the options are", () => {
    expect(() => readProfile(soundProfile(), JSON.parse("null"))).toThrow(DataError);
    expect(() => validateProfile(soundProfile(), JSON.parse('{ "maxFindings": "10" }'))).toThrow(DataError);
    expect(() => validateProfile(soundProfile(), JSON.parse('{ "profiles": {} }'))).toThrow(DataError);
    expect(() => validateProfile(soundProfile(), JSON.parse('{ "strict": true }'))).toThrow(/strict/u);
    expect(() => validateProfile(soundProfile(), { profiles: [{ id: "x" }] })).toThrow(/The option profiles at \[0\]/u);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses a member named %s, of the profile, of an Activity Definition and of another profile",
    (name) => {
      const member = `"${name}":{"admin":true}`;
      const top: unknown = JSON.parse(JSON.stringify(soundProfile()).replace("{", `{${member},`));
      expect(summary(validateProfile(top))).toStrictEqual([{ path: name, rule: "invalid-value", severity: "error" }]);
      const text = JSON.stringify(soundProfile()).replace('"activityDefinition":{', `"activityDefinition":{${member},`);
      expect(summary(validateProfile(JSON.parse(text)))).toStrictEqual([
        {
          path: expect.stringMatching(new RegExp(`^concepts\\[\\d+\\]\\.activityDefinition\\.${name}$`, "u")),
          rule: "invalid-value",
          severity: "error",
        },
      ]);
      const other: unknown = JSON.parse(JSON.stringify(otherProfile()).replace("{", `{${member},`));
      expect(() => readProfile(soundProfile(), { profiles: [other] })).toThrow(
        `The option profiles at [0] is invalid at ${name}: the property "${name}" is refused`,
      );
      expect(({} as Record<string, unknown>).admin).toBeUndefined();
    },
  );

  it("reads the other profiles from their text too", () => {
    const reusing = set("patterns.1.oneOrMore", "https://example.org/profiles/timing/templates/timed")(soundProfile());
    expect(validateProfile(reusing, { profiles: [JSON.stringify(otherProfile())] })).toStrictEqual([]);
  });
});

describe("the rules between the objects of a profile", () => {
  it("lets a profile define a concept of another that a version of it revises", () => {
    const superseding = changed(
      set("concepts.2.id", "https://example.org/profiles/timing/verbs/timed"),
      set("versions.1.wasRevisionOf", ["https://example.org/profiles/timing/v1"]),
    );
    expect(validateProfile(superseding, { profiles: [otherProfile()] })).toStrictEqual([]);
  });

  it("takes the earliest version as the first, whatever its place in the list", () => {
    const findings = validateProfile(
      changed(
        set("versions", [
          { id: `${SPORTS}/v1`, generatedAtTime: "2010-01-14T12:13:14Z" },
          { id: `${SPORTS}/v2`, generatedAtTime: "2020-02-20T20:20:20Z" },
        ]),
      ),
    );
    expect(summary(findings)).toStrictEqual([{ path: "versions[1]", rule: "revision-missing", severity: "error" }]);
  });

  it("finds a relation to the concept itself, to another type and to another version of the profile", () => {
    const input = changed(
      set("versions.1.wasRevisionOf", undefined),
      set("concepts.0.exactMatch", [PLACED]),
      set("concepts.0.narrower", [EVENT]),
      set("concepts.3.inScheme", `${SPORTS}/v1`),
      set("concepts.3.broader", [`${SPORTS}/activitytypes/event`]),
    );
    expect(summary(validateProfile(input)).filter(({ rule }) => rule === "relation-target")).toStrictEqual([
      { path: "concepts[0].narrower[0]", rule: "relation-target", severity: "error" },
      { path: "concepts[0].exactMatch[0]", rule: "relation-target", severity: "error" },
      { path: "concepts[3].broader[0]", rule: "relation-target", severity: "error" },
    ]);
  });

  it("checks the type of a concept of another profile that a match names, and lets a match name another version", () => {
    const other = changed(set("concepts.0.broadMatch", ["https://example.org/profiles/timing/verbs/timed"]));
    expect(validateProfile(other, { profiles: [otherProfile()] })).toStrictEqual([]);
    const activityType = set("concepts.0.type", "ActivityType")(otherProfile());
    expect(summary(validateProfile(other, { profiles: [activityType] }))).toStrictEqual([
      { path: "concepts[0].broadMatch[0]", rule: "relation-target", severity: "error" },
    ]);
    const versions = changed(set("concepts.3.inScheme", `${SPORTS}/v1`), set("concepts.0.relatedMatch", [EVENT]));
    expect(summary(validateProfile(versions)).filter(({ rule }) => rule === "relation-target")).toStrictEqual([
      { path: "concepts[0].relatedMatch[0]", rule: "relation-target", severity: "error" },
    ]);
  });

  it("finds a broader concept that the profile does not define, and judges a concept without an inline schema", () => {
    const input = changed(
      set("concepts.1.broader", [`${SPORTS}/verbs/unknown`]),
      set("concepts.4.inlineSchema", undefined),
    );
    expect(summary(validateProfile(input))).toStrictEqual([
      { path: "concepts[1].broader[0]", rule: "relation-target", severity: "error" },
    ]);
  });

  it("checks what the recommendations of an extension name", () => {
    const input = changed(set("concepts.4.recommendedVerbs", [EVENT]));
    expect(summary(validateProfile(input))).toStrictEqual([
      { path: "concepts[4].recommendedVerbs[0]", rule: "relation-target", severity: "error" },
    ]);
  });

  it("finds an inline schema that is not an object or a boolean, or that passes the limits of JSON", () => {
    expect(summary(validateProfile(changed(set("concepts.4.inlineSchema", "5"))))).toStrictEqual([
      { path: "concepts[4].inlineSchema", rule: "inline-schema", severity: "error" },
    ]);
    expect(validateProfile(changed(set("concepts.4.inlineSchema", "true")))).toStrictEqual([]);
    const deep = `${"[".repeat(65)}${"]".repeat(65)}`;
    expect(validateProfile(changed(set("concepts.5.inlineSchema", deep)))[0]?.message).toMatch(
      /nests deeper than 64 levels/u,
    );
  });

  it("judges the Activity Definition of an Activity concept as xAPI does, apart from its JSON-LD keywords", () => {
    const input = changed(
      set("concepts.6.activityDefinition.@id", "_:event"),
      set("concepts.6.activityDefinition.extensions", {
        "https://example.org/x/list": [{ "@context": "https://example.org/context", a: 1 }, 2, { b: 2 }],
        "https://example.org/x/number": 3,
      }),
    );
    expect(summary(validateProfile(input))).toStrictEqual([
      {
        path: "concepts[6].activityDefinition.extensions.https://example.org/x/list",
        rule: "extension-context",
        severity: "error",
      },
    ]);
    expect(summary(validateProfile(changed(set("concepts.6.activityDefinition.extensions", "none"))))).toStrictEqual([
      { path: "concepts[6].activityDefinition.extensions", rule: "wrong-type", severity: "error" },
    ]);
  });

  it("checks the type of a concept of another profile that a Determining Property names", () => {
    const input = changed(set("templates.0.verb", "https://example.org/profiles/timing/verbs/timed"));
    expect(validateProfile(input, { profiles: [otherProfile()] })).toStrictEqual([]);
    const contextual = changed(set("templates.2.contextGroupingActivityType", [PLACED]));
    expect(summary(validateProfile(contextual))).toStrictEqual([
      { path: "templates[2].contextGroupingActivityType[0]", rule: "determining-property", severity: "error" },
    ]);
  });

  it("finds a cycle through the Patterns of another profile, and a Pattern that is its own member", () => {
    const loop = {
      ...otherProfile(),
      patterns: [
        {
          id: "https://example.org/profiles/timing/patterns/back",
          type: "Pattern",
          optional: `${SPORTS}/patterns/handoffs`,
        },
      ],
    };
    const through = changed(set("patterns.1.oneOrMore", "https://example.org/profiles/timing/patterns/back"));
    expect(summary(validateProfile(through, { profiles: [loop] }))).toStrictEqual([
      { path: "patterns[1]", rule: "pattern-cycle", severity: "error" },
    ]);
    const self = changed(set("patterns.1.oneOrMore", `${SPORTS}/patterns/handoffs`));
    expect(summary(validateProfile(self))).toStrictEqual([
      { path: "patterns[1]", rule: "pattern-cycle", severity: "error" },
    ]);
  });

  it("finds an optional Pattern of another profile in alternates", () => {
    const optional = {
      ...otherProfile(),
      patterns: [
        {
          id: "https://example.org/profiles/timing/patterns/maybe",
          type: "Pattern",
          optional: "https://example.org/profiles/timing/templates/timed",
        },
      ],
    };
    const input = changed(
      set("patterns", [
        ...(soundProfile().patterns as Json[]),
        {
          id: `${SPORTS}/patterns/either`,
          type: "Pattern",
          alternates: ["https://example.org/profiles/timing/patterns/maybe", `${SPORTS}/templates/start`],
        },
      ]),
    );
    expect(summary(validateProfile(input, { profiles: [optional] }))).toStrictEqual([
      { path: "patterns[2].alternates[0]", rule: "alternates-optional", severity: "error" },
    ]);
  });
});

describe("the JSONPaths of the rules", () => {
  const statement = {
    id: "fd41c918-b88b-4b20-a0a5-a4c32391aaa0",
    verb: { id: "http://adlnet.gov/expapi/verbs/passed", display: { "en-US": "passed" } },
    result: { score: { raw: 9, max: 10 }, extensions: { "https://example.org/x's": [1, 2] } },
    context: {
      contextActivities: {
        grouping: [
          { id: "https://example.org/a", definition: { type: "https://example.org/t1" } },
          { id: "https://example.org/b", definition: { type: "https://example.org/t2" } },
        ],
      },
    },
  };
  const select = (path: string) => selectJsonPath(parseJsonPath(path), statement);

  it("finds members by name in dot or bracket notation, and an array as one value", () => {
    expect(select("$.verb.id")).toStrictEqual(["http://adlnet.gov/expapi/verbs/passed"]);
    expect(select("$.verb.display.en-US")).toStrictEqual(["passed"]);
    expect(select("$['verb'][\"id\"]")).toStrictEqual(["http://adlnet.gov/expapi/verbs/passed"]);
    expect(select("$.result.extensions['https://example.org/x\\'s']")).toStrictEqual([[1, 2]]);
    expect(select("$")).toStrictEqual([statement]);
  });

  it("finds elements by index, every child by *, and unions in brackets", () => {
    expect(select("$.context.contextActivities.grouping[1].id")).toStrictEqual(["https://example.org/b"]);
    expect(select("$.context.contextActivities.grouping[*].definition.type")).toStrictEqual([
      "https://example.org/t1",
      "https://example.org/t2",
    ]);
    expect(select("$.context.contextActivities.grouping.*.id")).toStrictEqual([
      "https://example.org/a",
      "https://example.org/b",
    ]);
    expect(select("$.result.score[ 'raw' , 'max' ]")).toStrictEqual([9, 10]);
    expect(select("$.result['score','score'].raw")).toStrictEqual([9]);
    expect(select("$.result.score.*")).toStrictEqual([9, 10]);
    expect(select("$.context.contextActivities.grouping[0, 5]")).toHaveLength(1);
  });

  it("finds nothing where a name meets an array or an index meets an object", () => {
    expect(select("$.context.contextActivities.grouping['https://example.org/a']")).toStrictEqual([]);
    expect(select("$.result[0]")).toStrictEqual([]);
    expect(select("$.verb.id.length")).toStrictEqual([]);
    expect(select("$.result.missing")).toStrictEqual([]);
  });

  it("finds members at any depth after .., each node once", () => {
    expect(select("$..type")).toStrictEqual(["https://example.org/t1", "https://example.org/t2"]);
    expect(select("$..grouping..['id']")).toStrictEqual(["https://example.org/a", "https://example.org/b"]);
    expect(select("$..*..*..raw")).toStrictEqual([9]);
    expect(select("$..score.*")).toStrictEqual([9, 10]);
  });

  it("joins the values of paths separated by |", () => {
    expect(select("$.verb.id | $.result.score.raw|$.result.score.max")).toStrictEqual([
      "http://adlnet.gov/expapi/verbs/passed",
      9,
      10,
    ]);
  });

  it("keeps each value once, however many members of a union or paths joined by | find it", () => {
    expect(select("$.result.extensions['https://example.org/x\\'s'][*,*,0,1,1]")).toStrictEqual([1, 2]);
    expect(select("$.result.extensions['https://example.org/x\\'s'][1,0,1]")).toStrictEqual([2, 1]);
    expect(select("$.result.score.raw | $['result'].score['raw'] | $..raw")).toStrictEqual([9]);
    // A rule compares values, so the same primitive found in two places is one value.
    expect(selectJsonPath(parseJsonPath("$.a[*] | $.b"), { a: [3, 3, "3"], b: 3 })).toStrictEqual([3, "3"]);
  });

  it("refuses a path of more than MAX_JSON_PATH_LENGTH characters, which a rule's work grows with, and takes one of as many", () => {
    const longest = `$.${"a".repeat(MAX_JSON_PATH_LENGTH - 2)}`;
    expect(longest).toHaveLength(MAX_JSON_PATH_LENGTH);
    expect(parseJsonPath(longest)).toHaveLength(1);
    expect(() => parseJsonPath(`${longest}.`)).toThrow(
      expect.objectContaining({ limit: "MAX_JSON_PATH_LENGTH", maximum: MAX_JSON_PATH_LENGTH }),
    );
    const input = changed(set("templates.2.rules.0.location", `${longest}b`));
    expect(summary(validateProfile(input))).toStrictEqual([
      { path: "templates[2].rules[0].location", rule: "json-path", severity: "error" },
    ]);
  });

  it.each([
    ["", 'needs "$"'],
    ["timestamp", 'needs "$"'],
    ["$.context[?(@.id)]", "filter or a script"],
    ["$.context[(@.length-1)]", "filter or a script"],
    ["$.grouping[-1]", "non-negative integer"],
    ["$.grouping[0:2]", 'needs "]"'],
    ["$.grouping[]", "non-negative integer"],
    ["$.a.", "needs a name or *"],
    ["$.a..", "needs a name or *"],
    ["$['a", 'needs "\'"'],
    ["$['a\\", 'needs "\'"'],
    ["$.a b", 'needs "|"'],
    ["$.a |", 'needs "$"'],
    ["$.a)", "unexpected character"],
  ])("refuses %j, which a rule must not use", (path, problem) => {
    expect(() => parseJsonPath(path)).toThrow(problem);
  });
});
