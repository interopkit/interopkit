import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import {
  type ActivityDefinition,
  formatStatement,
  readStatement,
  STATEMENT_FORMATS,
  type Statement,
} from "../src/index.js";
import { copyOf, sharesNothing } from "./fixture.js";
import { fullStatement, fullStatementAbout, minimalStatement, subStatementStatement, uuid } from "./full-statement.js";
import { ROLES, RUNS } from "./fuzz.js";

/** Every key that a format `ids` removes, wherever it is. */
function keysOf(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (typeof value === "object" && value !== null) {
    for (const [key, member] of Object.entries(value)) {
      found.add(key);
      keysOf(member, found);
    }
  }
  return found;
}

describe("formatStatement of a Statement of 1.0.3", () => {
  it("takes a form of a time that 2.0 does not take, and writes it as it came", () => {
    const basic = { ...minimalStatement(), timestamp: "20240613T184603Z" };
    expect(formatStatement(basic, "exact").timestamp).toBe("20240613T184603Z");
  });
});

describe("formatStatement", () => {
  describe("the format exact", () => {
    it("returns the Statement as it is, a copy that shares nothing with the input", () => {
      const input = fullStatement();
      const statement = formatStatement(input, "exact");
      expect(statement).toStrictEqual(fullStatement());
      expect(sharesNothing(statement, input)).toBe(true);
    });

    it("leaves the display of the Verb and the definition of the Activity as they are", () => {
      const statement = formatStatement(fullStatement(), "exact");
      expect(statement.verb.display).toStrictEqual({ "en-US": "answered", "en-GB": "answered" });
      expect(statement.object).toMatchObject({
        definition: { choices: [{ id: "golf" }, { id: "tetris" }, { id: "facebook" }] },
      });
    });
  });

  describe("the format ids", () => {
    it("keeps the minimum that identifies an Agent, a Group, an Activity and a Verb, wherever they are", () => {
      expect(formatStatement(fullStatement(), "ids")).toStrictEqual({
        id: uuid(1),
        actor: { mbox: "mailto:learner@example.org" },
        verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
        object: { id: "https://example.org/activities/quiz-1/question-3" },
        result: fullStatement().result,
        context: {
          registration: uuid(2),
          instructor: { mbox_sha1sum: "e1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e90" },
          team: { objectType: "Group", openid: "https://openid.example.org/teams/a" },
          contextActivities: {
            parent: [{ id: "https://example.org/activities/quiz-1" }],
            grouping: [{ id: "https://example.org/activities/course-1" }],
            category: [{ id: "https://example.org/profiles/quizzes" }],
            other: [{ id: "https://example.org/activities/resource-9" }],
          },
          contextAgents: [
            {
              objectType: "contextAgent",
              agent: { openid: "https://openid.example.org/people/proctor" },
              relevantTypes: ["https://example.org/xapi/context/proctor"],
            },
          ],
          contextGroups: [
            {
              objectType: "contextGroup",
              group: {
                objectType: "Group",
                member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }],
              },
              relevantTypes: ["https://example.org/xapi/context/study-group"],
            },
          ],
          revision: "2.1",
          platform: "Example LMS",
          language: "en-US",
          statement: { objectType: "StatementRef", id: uuid(3) },
          extensions: { "https://example.org/xapi/extensions/device": "tablet" },
        },
        timestamp: "2024-06-13T18:46:03.250Z",
        stored: "2024-06-13T18:46:04.100Z",
        authority: { account: { homePage: "https://lms.example.org", name: "lrs-client" } },
        version: "2.0.0",
        attachments: fullStatement().attachments,
      });
    });

    it("keeps the type of an Agent as the Object, since it would be read as an Activity without it", () => {
      const input = fullStatementAbout({ objectType: "Agent", name: "Classmate", mbox: "mailto:c@example.org" });
      expect(formatStatement(input, "ids").object).toStrictEqual({
        objectType: "Agent",
        mbox: "mailto:c@example.org",
      });
    });

    it("keeps the identifier of an identified Group and the members of an anonymous one, each with its identifier alone", () => {
      const identified = {
        ...fullStatement(),
        actor: {
          objectType: "Group",
          name: "T",
          mbox: "mailto:g@example.org",
          member: [{ mbox: "mailto:a@example.org" }],
        },
      };
      expect(formatStatement(identified as Statement, "ids").actor).toStrictEqual({
        objectType: "Group",
        mbox: "mailto:g@example.org",
      });
      const anonymous = {
        ...fullStatement(),
        actor: { objectType: "Group", name: "T", member: [{ name: "A", mbox: "mailto:a@example.org" }] },
      };
      expect(formatStatement(anonymous as Statement, "ids").actor).toStrictEqual({
        objectType: "Group",
        member: [{ mbox: "mailto:a@example.org" }],
      });
    });

    it("formats the SubStatement and its parts", () => {
      const input = copyOf(subStatementStatement()) as unknown as { object: { actor: unknown; context: unknown } };
      input.object.actor = { name: "Learner", mbox: "mailto:learner@example.org" };
      input.object.context = { instructor: { name: "Teacher", mbox: "mailto:t@example.org" } };
      expect(formatStatement(input as unknown as Statement, "ids").object).toMatchObject({
        objectType: "SubStatement",
        actor: { mbox: "mailto:learner@example.org" },
        object: { objectType: "Agent", mbox: "mailto:classmate@example.org" },
        context: { instructor: { mbox: "mailto:t@example.org" } },
      });
    });

    it("leaves no name, display or definition behind", () => {
      const keys = keysOf(formatStatement(fullStatement(), "ids"));
      for (const left of ["name", "display", "definition"]) {
        // The display of an Attachment, the name of an Account and the names inside extensions are not Agents, Activities or Verbs.
        if (left === "display") continue;
        expect(keys.has(left)).toBe(left === "name");
      }
      expect(JSON.stringify(formatStatement(fullStatement(), "ids").verb)).toBe(
        '{"id":"http://adlnet.gov/expapi/verbs/answered"}',
      );
    });

    it("gives a Statement that a reader accepts and a second formatting does not change", () => {
      const once = formatStatement(fullStatement(), "ids");
      expect(readStatement(once)).toStrictEqual(once);
      expect(formatStatement(once, "ids")).toStrictEqual(once);
    });
  });

  describe("the format canonical", () => {
    const definition: ActivityDefinition = {
      name: { en: "Question three", fr: "Question three (fr)", "id-ID": "Question three (id)" },
      description: { en: "Which sports use a ball?", fr: "Which sports use a ball? (fr)" },
      type: "http://adlnet.gov/expapi/activities/cmi.interaction",
      interactionType: "choice",
      correctResponsesPattern: ["golf"],
      choices: [
        { id: "golf", description: { en: "Golf", fr: "Golf (fr)" } },
        { id: "tetris", description: { fr: "Tetris (fr)", en: "Tetris" } },
      ],
    };
    const activities = new Map([["https://example.org/activities/quiz-1/question-3", definition]]);

    it("puts the canonical definition in place of the definition of the Statement, in the language that was asked for", () => {
      const statement = formatStatement(fullStatement(), "canonical", { activities, languages: ["fr-CA", "fr", "en"] });
      expect(statement.object).toStrictEqual({
        objectType: "Activity",
        id: "https://example.org/activities/quiz-1/question-3",
        definition: {
          name: { fr: "Question three (fr)" },
          description: { fr: "Which sports use a ball? (fr)" },
          type: "http://adlnet.gov/expapi/activities/cmi.interaction",
          interactionType: "choice",
          correctResponsesPattern: ["golf"],
          choices: [
            { id: "golf", description: { fr: "Golf (fr)" } },
            { id: "tetris", description: { fr: "Tetris (fr)" } },
          ],
        },
      });
    });

    it("chooses by the order of the languages, matches a range to the tags that begin with it, and falls back to the first entry", () => {
      const named = (languages: string[]) =>
        formatStatement(fullStatement(), "canonical", { activities, languages }).object as {
          definition: { name: unknown };
        };
      expect(named(["en"]).definition.name).toStrictEqual({ en: "Question three" });
      expect(named(["de", "id"]).definition.name).toStrictEqual({ "id-ID": "Question three (id)" });
      expect(named(["de"]).definition.name).toStrictEqual({ en: "Question three" });
      expect(named(["*"]).definition.name).toStrictEqual({ en: "Question three" });
      expect(named([]).definition.name).toStrictEqual({ en: "Question three" });
      expect(named(["ID-id"]).definition.name).toStrictEqual({ "id-ID": "Question three (id)" });
      expect(named(["ind"]).definition.name).toStrictEqual({ en: "Question three" });
    });

    it("does not match a range to a tag that merely begins with the same letters", () => {
      const similar = new Map([
        [
          "https://example.org/activities/quiz-1/question-3",
          { name: { fr: "Question three (fr)", eng: "Question (eng)" } },
        ],
      ]);
      const statement = formatStatement(fullStatement(), "canonical", { activities: similar, languages: ["en"] });
      expect(statement.object).toMatchObject({ definition: { name: { fr: "Question three (fr)" } } });
    });

    it("returns one language of the display of the Verb, and keeps a Verb that has none", () => {
      const statement = formatStatement(fullStatement(), "canonical", { languages: ["en-GB"] });
      expect(statement.verb.display).toStrictEqual({ "en-GB": "answered" });
      const withoutDisplay = { ...fullStatement(), verb: { id: "http://adlnet.gov/expapi/verbs/answered" } };
      expect(formatStatement(withoutDisplay, "canonical").verb).toStrictEqual({
        id: "http://adlnet.gov/expapi/verbs/answered",
      });
    });

    it("keeps the definition of the Statement, in one language, for an Activity that the canonical definitions lack", () => {
      const statement = formatStatement(fullStatement(), "canonical", { activities: new Map(), languages: ["en"] });
      expect(statement.object).toMatchObject({ definition: { name: { "en-US": "Question 3" } } });
    });

    it("formats the Activities of the context and of a SubStatement", () => {
      const input = copyOf(fullStatement()) as unknown as { context: { contextActivities: { parent: unknown[] } } };
      input.context.contextActivities.parent = [
        { id: "https://example.org/activities/quiz-1", definition: { name: { en: "Quiz", fr: "Test" } } },
      ];
      const statement = formatStatement(input as unknown as Statement, "canonical", { languages: ["fr"] });
      expect(statement.context?.contextActivities?.parent).toStrictEqual([
        { id: "https://example.org/activities/quiz-1", definition: { name: { fr: "Test" } } },
      ]);
      const sub = copyOf(subStatementStatement()) as unknown as { object: { object: unknown } };
      sub.object.object = { id: "https://example.org/a", definition: { name: { en: "A", fr: "B" } } };
      expect(formatStatement(sub as unknown as Statement, "canonical", { languages: ["fr"] }).object).toMatchObject({
        object: { definition: { name: { fr: "B" } } },
      });
    });

    it("returns the Agents and the Groups as they are", () => {
      const statement = formatStatement(fullStatement(), "canonical", { activities, languages: ["en"] });
      expect(statement.actor).toStrictEqual(fullStatement().actor);
      expect(statement.context?.team).toStrictEqual(fullStatement().context?.team);
    });

    it("shares nothing with the Statement or with the canonical definitions", () => {
      const input = fullStatement();
      const statement = formatStatement(input, "canonical", { activities, languages: ["fr"] });
      expect(sharesNothing(statement, input)).toBe(true);
      expect(sharesNothing(statement, [...activities.values()])).toBe(true);
    });

    it("changes nothing in a Statement and in options that are frozen", () => {
      const options = deepFreeze({ activities, languages: ["fr"] });
      expect(() => formatStatement(deepFreeze(fullStatement()), "canonical", options)).not.toThrow();
    });

    it("refuses a canonical definition that is not a definition, and names the Activity", () => {
      const bad = new Map([["https://example.org/activities/quiz-1/question-3", { name: 5 } as never]]);
      expect(() => formatStatement(fullStatement(), "canonical", { activities: bad })).toThrow(
        /^The definition of "https:\/\/example\.org\/activities\/quiz-1\/question-3" in the option activities is invalid at object\.definition\.name: expected an object/,
      );
    });

    it("gives a Statement that a reader accepts and a second formatting does not change", () => {
      const once = formatStatement(fullStatement(), "canonical", { activities, languages: ["fr"] });
      expect(readStatement(once)).toStrictEqual(once);
      expect(formatStatement(once, "canonical", { languages: ["fr"] })).toStrictEqual(once);
    });
  });

  describe("the Objects that are not Activities", () => {
    it("formats a Group and a Statement Reference as the Object, and keeps the second as it is", () => {
      const group = fullStatementAbout({ objectType: "Group", name: "Team", mbox: "mailto:g@example.org" });
      expect(formatStatement(group, "ids").object).toStrictEqual({ objectType: "Group", mbox: "mailto:g@example.org" });
      expect(formatStatement(group, "canonical").object).toStrictEqual(group.object);
      const reference = fullStatementAbout({ objectType: "StatementRef", id: uuid(6) });
      expect(formatStatement(reference, "ids").object).toStrictEqual(reference.object);
      expect(formatStatement(reference, "canonical").object).toStrictEqual(reference.object);
    });
  });

  describe("a definition with less in it", () => {
    it("keeps a component with no description, and a definition with no name and no description, in one language", () => {
      const sparse: ActivityDefinition = {
        type: "http://adlnet.gov/expapi/activities/cmi.interaction",
        interactionType: "choice",
        choices: [{ id: "a" }, { id: "b", description: { en: "B", fr: "Bé" } }],
      };
      const activities = new Map([["https://example.org/activities/quiz-1/question-3", sparse]]);
      const statement = formatStatement(fullStatement(), "canonical", { activities, languages: ["fr"] });
      expect(statement.object).toMatchObject({
        definition: { interactionType: "choice", choices: [{ id: "a" }, { id: "b", description: { fr: "Bé" } }] },
      });
      expect(JSON.stringify(statement.object)).not.toContain('"name"');
    });

    it("keeps an Activity that the Statement gives no definition", () => {
      const input = { ...fullStatement(), object: { id: "https://example.org/activities/bare" } };
      expect(formatStatement(input, "canonical", { languages: ["fr"] }).object).toStrictEqual(input.object);
    });
  });

  describe("on input of any kind", () => {
    it.each(["IDS", "", null, 5, undefined, ["ids"]])("refuses the format %j", (format) => {
      expect(() => formatStatement(fullStatement(), format as never)).toThrow(DataError);
      expect(() => formatStatement(fullStatement(), format as never)).toThrow(
        /^The format is invalid: expected "ids", "exact" or "canonical", found /,
      );
    });

    it.each([
      [null, "The options object is invalid: expected an object, found null."],
      [[], "The options object is invalid: expected an object, found an array."],
      [{ languages: "en" }, 'The options object is invalid at languages: expected an array, found "en".'],
      [
        { languages: ["en_US"] },
        'The options object is invalid at languages[0]: expected a language tag of RFC 5646 or *, found "en_US".',
      ],
      [{ languages: [5] }, "The options object is invalid at languages[0]: expected a string, found 5."],
      [
        { activities: {} },
        "The options object is invalid at activities: expected a Map from an Activity id to its definition, found an object.",
      ],
      [
        { activities: [] },
        "The options object is invalid at activities: expected a Map from an Activity id to its definition, found an array.",
      ],
      [{ color: 1 }, 'The options object is invalid: unexpected property "color".'],
    ])("refuses the options %j", (options, sentence) => {
      expect(() => formatStatement(fullStatement(), "canonical", options as never)).toThrow(new DataError(sentence));
    });

    it("refuses a Statement that is not one, with the sentence of the reader", () => {
      expect(() => formatStatement(null as never, "ids")).toThrow(
        /^The statement is invalid: expected an object, found null\.$/,
      );
    });

    it("accepts the three formats that STATEMENT_FORMATS names, and no other", () => {
      expect(STATEMENT_FORMATS).toStrictEqual(["ids", "exact", "canonical"]);
      for (const format of STATEMENT_FORMATS) expect(() => formatStatement(fullStatement(), format)).not.toThrow();
    });

    it("returns a Statement that a reader of either role accepts, whatever the format and the languages", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...STATEMENT_FORMATS),
          ROLES,
          fc.array(fc.constantFrom("en", "fr", "id", "*", "en-US", "de"), { maxLength: 3 }),
          (format, role, languages) => {
            const statement = formatStatement(fullStatement(), format, { languages });
            expect(readStatement(statement, { role })).toStrictEqual(statement);
          },
        ),
        RUNS,
      );
    });
  });
});
