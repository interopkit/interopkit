import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutate, mutations } from "../../../scripts/json-mutation.js";
import { equivalenceKey } from "../src/compare/internal.js";
import { type Statement, sameStatement } from "../src/index.js";
import { copyOf } from "./fixture.js";
import { fullStatement, minimalStatement, subStatementStatement, uuid } from "./full-statement.js";

/** Changes a copy of the full Statement through a function over JSON. */
function changed(change: (statement: Record<string, any>) => void): Statement {
  const statement = copyOf(fullStatement()) as unknown as Record<string, any>;
  change(statement);
  return statement as unknown as Statement;
}

describe("sameStatement", () => {
  it.each([
    ["the full Statement", fullStatement],
    ["the smallest Statement", minimalStatement],
    ["a Statement with a SubStatement", subStatementStatement],
  ])("holds %s to be the same as a copy of itself", (_name, make) => {
    expect(sameStatement(make(), make())).toBe(true);
  });

  describe("what the standard says is not immutable", () => {
    it.each([
      ["the id", (s: Record<string, any>) => (s.id = uuid(99))],
      ["no id", (s: Record<string, any>) => delete s.id],
      ["the timestamp", (s: Record<string, any>) => (s.timestamp = "2030-01-01T00:00:00.000Z")],
      ["no timestamp", (s: Record<string, any>) => delete s.timestamp],
      ["stored", (s: Record<string, any>) => (s.stored = "2030-01-01T00:00:00.000Z")],
      ["the authority", (s: Record<string, any>) => (s.authority = { mbox: "mailto:other@example.org" })],
      ["the version", (s: Record<string, any>) => (s.version = "1.0.0")],
      ["the Attachments", (s: Record<string, any>) => (s.attachments = [])],
      ["the display of the Verb", (s: Record<string, any>) => (s.verb.display = { fr: "answered (fr)" })],
      ["no display of the Verb", (s: Record<string, any>) => delete s.verb.display],
      ["the definition of the Activity", (s: Record<string, any>) => (s.object.definition = { name: { en: "Other" } })],
      ["no definition of the Activity", (s: Record<string, any>) => delete s.object.definition],
      [
        "the definition of an Activity of the context",
        (s: Record<string, any>) => {
          s.context.contextActivities.parent[0].definition = { name: { en: "Parent" } };
        },
      ],
      ["the type of the Activity written", (s: Record<string, any>) => delete s.object.objectType],
      ["the type of the Agent written", (s: Record<string, any>) => delete s.actor.objectType],
    ])("holds a Statement to be the same with %s changed", (_name, change) => {
      expect(sameStatement(fullStatement(), changed(change))).toBe(true);
    });

    it("holds Groups to be the same when their members are in another order", () => {
      const members = [
        { mbox: "mailto:a@example.org" },
        { openid: "https://id.example.org/b" },
        { mbox: "mailto:c@example.org" },
      ];
      const withMembers = (list: unknown[]) => changed((s) => (s.actor = { objectType: "Group", member: list }));
      expect(sameStatement(withMembers(members), withMembers([...members].reverse()))).toBe(true);
      expect(sameStatement(withMembers(members), withMembers(members.slice(0, 2)))).toBe(false);
    });

    it("holds Statements to be the same when a Group in the context has its members in another order", () => {
      const group = (member: unknown[]) =>
        changed(
          (s) => (s.context.contextGroups = [{ objectType: "contextGroup", group: { objectType: "Group", member } }]),
        );
      const a = { mbox: "mailto:a@example.org" };
      const b = { mbox: "mailto:b@example.org" };
      expect(sameStatement(group([a, b]), group([b, a]))).toBe(true);
    });

    it("holds a duration to be the same to 0.01 second, whatever units write it", () => {
      const duration = (text: string) => changed((s) => (s.result.duration = text));
      expect(sameStatement(duration("PT1H30M15.25S"), duration("PT1H30M15.259S"))).toBe(true);
      expect(sameStatement(duration("PT1H30M15.25S"), duration("PT5415.25S"))).toBe(true);
      expect(sameStatement(duration("PT1H"), duration("PT60M"))).toBe(true);
      expect(sameStatement(duration("PT1H30M15.25S"), duration("PT1H30M15.26S"))).toBe(false);
      expect(sameStatement(duration("P1D"), duration("PT24H"))).toBe(false);
    });

    it("holds a single Activity of the context to be the same as a list of one", () => {
      expect(
        sameStatement(
          fullStatement(),
          changed((s) => (s.context.contextActivities.parent = s.context.contextActivities.parent[0])),
        ),
      ).toBe(true);
    });
  });

  describe("the case of what ignores case", () => {
    /** A Statement that has each kind of value that ignores case, in lower case. */
    const base = changed((s) => {
      s.object.id = "https://user@example.org/activities/quiz-1/question-3";
      s.context.instructor = { account: { homePage: "https://lms.example.org", name: "teacher-1" } };
      s.context.contextAgents[0].agent = { mbox_sha1sum: "e1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e90" };
      s.result.extensions = { "https://example.org/xapi/extensions/attempts": 2 };
    });

    it.each([
      [
        "the scheme and the host of the id of the Verb",
        (s: Record<string, any>) => (s.verb.id = "HTTP://ADLNET.GOV/expapi/verbs/answered"),
      ],
      [
        "the scheme and the host of the id of the Activity, after a user",
        (s: Record<string, any>) => (s.object.id = "HTTPS://user@EXAMPLE.org/activities/quiz-1/question-3"),
      ],
      ["an address", (s: Record<string, any>) => (s.actor.mbox = "mailto:LEARNER@Example.ORG")],
      [
        "the hash of an address",
        (s: Record<string, any>) =>
          (s.context.contextAgents[0].agent.mbox_sha1sum = "E1A3E0B9A25C7A7F6E1B4C7D1E4D9B1F3A5C7E90"),
      ],
      ["a UUID", (s: Record<string, any>) => (s.context.registration = uuid(2).toUpperCase())],
      [
        "the UUID of the Statement of the context",
        (s: Record<string, any>) => (s.context.statement.id = uuid(3).toUpperCase()),
      ],
      ["a language tag", (s: Record<string, any>) => (s.context.language = "EN-us")],
      [
        "the host of the home page of an Account",
        (s: Record<string, any>) => (s.context.instructor.account.homePage = "https://LMS.example.org"),
      ],
      [
        "the host of the key of an extension",
        (s: Record<string, any>) => (s.result.extensions = { "https://EXAMPLE.org/xapi/extensions/attempts": 2 }),
      ],
    ])("holds a Statement to be the same when %s differs in case", (_name, change) => {
      const other = copyOf(base) as unknown as Record<string, any>;
      change(other);
      expect(sameStatement(base, other as unknown as Statement)).toBe(true);
    });

    it.each([
      [
        "the path of an IRI",
        (s: Record<string, any>) => (s.object.id = "https://example.org/Activities/quiz-1/question-3"),
      ],
      ["the query of an IRI", (s: Record<string, any>) => (s.verb.id = "http://adlnet.gov/expapi/verbs/answered?X=1")],
      ["the name of an Account", (s: Record<string, any>) => (s.context.team.member[0].account.name = "Learner-1")],
      ["the name of an Agent", (s: Record<string, any>) => (s.actor.name = "example learner")],
      ["a response", (s: Record<string, any>) => (s.result.response = "Golf[,]Tetris")],
      [
        "a value of an extension",
        (s: Record<string, any>) => (s.context.extensions = { "https://example.org/xapi/extensions/device": "Tablet" }),
      ],
    ])("holds Statements to differ when %s differs in case", (_name, change) => {
      expect(sameStatement(fullStatement(), changed(change))).toBe(false);
    });
  });

  describe("what makes another Statement", () => {
    it.each([
      ["the Actor", (s: Record<string, any>) => (s.actor.mbox = "mailto:other@example.org")],
      ["the kind of Actor", (s: Record<string, any>) => (s.actor = { objectType: "Group", mbox: s.actor.mbox })],
      ["the name of the Actor", (s: Record<string, any>) => (s.actor.name = "Other")],
      ["the Verb", (s: Record<string, any>) => (s.verb.id = "http://adlnet.gov/expapi/verbs/attempted")],
      ["the Activity", (s: Record<string, any>) => (s.object.id = "https://example.org/activities/other")],
      [
        "the kind of Object",
        (s: Record<string, any>) => {
          s.object = { objectType: "Agent", mbox: "mailto:a@example.org" };
          delete s.context.revision;
          delete s.context.platform;
        },
      ],
      [
        "the Statement that is referenced",
        (s: Record<string, any>) => {
          s.object = { objectType: "StatementRef", id: uuid(5) };
          delete s.context.revision;
          delete s.context.platform;
        },
      ],
      ["the score", (s: Record<string, any>) => (s.result.score.scaled = 0.5)],
      ["success", (s: Record<string, any>) => (s.result.success = false)],
      ["completion", (s: Record<string, any>) => delete s.result.completion],
      ["the response", (s: Record<string, any>) => (s.result.response = "golf")],
      [
        "a value of an extension of the result",
        (s: Record<string, any>) => (s.result.extensions = { "https://example.org/xapi/extensions/attempts": 3 }),
      ],
      ["no result", (s: Record<string, any>) => delete s.result],
      ["the registration", (s: Record<string, any>) => (s.context.registration = uuid(77))],
      ["the instructor", (s: Record<string, any>) => (s.context.instructor = { mbox_sha1sum: "0".repeat(40) })],
      ["the team", (s: Record<string, any>) => (s.context.team.name = "Team B")],
      [
        "a parent Activity",
        (s: Record<string, any>) => (s.context.contextActivities.parent = [{ id: "https://example.org/other" }]),
      ],
      [
        "a relevant type",
        (s: Record<string, any>) =>
          (s.context.contextAgents[0].relevantTypes = ["https://example.org/xapi/context/other"]),
      ],
      [
        "the Agent of the context",
        (s: Record<string, any>) => (s.context.contextAgents[0].agent = { mbox: "mailto:p@example.org" }),
      ],
      ["the platform", (s: Record<string, any>) => (s.context.platform = "Other LMS")],
      ["the revision", (s: Record<string, any>) => (s.context.revision = "3")],
      ["the language", (s: Record<string, any>) => (s.context.language = "fr-FR")],
      ["no context", (s: Record<string, any>) => delete s.context],
    ])("holds Statements to differ when %s differs", (_name, change) => {
      expect(sameStatement(fullStatement(), changed(change))).toBe(false);
    });

    it("holds Statements to differ when the SubStatement differs in what makes a Statement", () => {
      const base = subStatementStatement();
      const other = copyOf(base) as unknown as { object: { verb: { id: string }; timestamp: string } };
      other.object.timestamp = "2030-01-01T00:00:00.000Z";
      expect(sameStatement(base, other as unknown as Statement)).toBe(true);
      other.object.verb.id = "http://adlnet.gov/expapi/verbs/attempted";
      expect(sameStatement(base, other as unknown as Statement)).toBe(false);
    });

    it("holds Statements to differ when two members of an anonymous Group differ", () => {
      const group = (mbox: string) => changed((s) => (s.actor = { objectType: "Group", member: [{ mbox }] }));
      expect(sameStatement(group("mailto:a@example.org"), group("mailto:b@example.org"))).toBe(false);
    });

    it("holds an anonymous Group and an identified Group to differ", () => {
      const anonymous = changed((s) => (s.actor = { objectType: "Group", member: [{ mbox: "mailto:a@example.org" }] }));
      const identified = changed((s) => (s.actor = { objectType: "Group", mbox: "mailto:a@example.org" }));
      expect(sameStatement(anonymous, identified)).toBe(false);
    });
  });

  describe("a duration too long to add up", () => {
    const withDuration = (duration: string): Statement => ({ ...minimalStatement(), result: { duration } });

    it("is compared as it is written", () => {
      const seconds = `PT${"1".repeat(1_000_000)}S`;
      expect(sameStatement(withDuration(seconds), withDuration(seconds))).toBe(true);
      expect(sameStatement(withDuration(seconds), withDuration(`PT${"1".repeat(999_999)}2S`))).toBe(false);
    });

    it("is another Statement than the same time in fewer digits", () => {
      expect(sameStatement(withDuration(`PT${"0".repeat(70)}1S`), withDuration("PT1S"))).toBe(false);
      expect(sameStatement(withDuration(`PT${"0".repeat(50)}1S`), withDuration("PT1S"))).toBe(true);
    });
  });

  describe("IRIs with no authority", () => {
    it("holds the case of the scheme to be nothing, and the case of the rest to be something", () => {
      const urn = (id: string) => changed((s) => (s.verb.id = id));
      expect(sameStatement(urn("urn:example:verbs:answered"), urn("URN:example:verbs:answered"))).toBe(true);
      expect(sameStatement(urn("urn:example:verbs:answered"), urn("urn:Example:verbs:answered"))).toBe(false);
    });
  });

  describe("a context with less in it", () => {
    it("holds a context with no Activities, an Agent with no relevant types and a Group with no members to be what they are", () => {
      const light = (change: (s: Record<string, any>) => void) =>
        changed((s) => {
          s.context = { contextAgents: [{ objectType: "contextAgent", agent: { mbox: "mailto:p@example.org" } }] };
          change(s);
        });
      expect(
        sameStatement(
          light(() => undefined),
          light(() => undefined),
        ),
      ).toBe(true);
      expect(
        sameStatement(
          light(() => undefined),
          light((s) => (s.context.contextAgents[0].relevantTypes = ["https://example.org/t"])),
        ),
      ).toBe(false);
      const group = (members?: unknown[]) =>
        changed(
          (s) =>
            (s.actor = { objectType: "Group", mbox: "mailto:g@example.org", ...(members ? { member: members } : {}) }),
        );
      expect(sameStatement(group(), group())).toBe(true);
      expect(sameStatement(group(), group([{ mbox: "mailto:a@example.org" }]))).toBe(false);
    });
  });

  it("writes the duration as it is when it is not one, which a reader never lets through", () => {
    const statement = { ...minimalStatement(), result: { duration: "1:30" } } as Statement;
    expect(equivalenceKey(statement)).toContain('"duration":"1:30"');
  });

  it("refuses a Statement that is not one, with the sentence of the reader", () => {
    expect(() => sameStatement(null as never, minimalStatement())).toThrow(DataError);
    expect(() => sameStatement(minimalStatement(), { ...minimalStatement(), extra: 1 } as never)).toThrow(
      /^The statement is invalid/,
    );
  });

  it("is reflexive, and symmetric for any two Statements that are read", () => {
    fc.assert(
      fc.property(mutations, mutations, (first, second) => {
        const a = mutate(JSON.parse(JSON.stringify(fullStatement())), first) as Statement;
        const b = mutate(JSON.parse(JSON.stringify(fullStatement())), second) as Statement;
        const compare = (x: Statement, y: Statement): boolean | undefined => {
          try {
            return sameStatement(x, y);
          } catch {
            return undefined;
          }
        };
        expect(compare(a, a)).not.toBe(false);
        expect(compare(a, b)).toBe(compare(b, a));
      }),
      { seed: 20_241_102, numRuns: 300 },
    );
  });
});
