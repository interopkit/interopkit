import { describe, expect, it } from "vitest";
import { SOUND } from "../../../scripts/cmi5-rules.js";
import { AU_VERBS, CMI5_VERBS, classifyStatement, validateSessionStatements } from "../src/index.js";
import { judgeStatement, sessionOrder, sessionStart } from "../src/rules/internal.js";

/** A copy of the sound session of the rules table, as JSON passes it. */
const sound = () => JSON.parse(JSON.stringify(SOUND));

describe("the kind of a statement", () => {
  it("tells a statement that cmi5 defines, one that it allows, and one that it does not allow", () => {
    const [initialized, allowed] = sound().statements;
    expect(classifyStatement(initialized)).toBe("defined");
    expect(classifyStatement(allowed)).toBe("allowed");
    expect(classifyStatement({ ...allowed, context: undefined })).toBe("not-allowed");
    const unknownVerb = { ...initialized, verb: { id: "http://adlnet.gov/expapi/verbs/experienced" } };
    expect(classifyStatement(unknownVerb)).toBe("not-allowed");
    const moveOnAlone = structuredClone(allowed);
    moveOnAlone.context.contextActivities.category = [{ id: "https://w3id.org/xapi/cmi5/context/categories/moveon" }];
    expect(classifyStatement(moveOnAlone)).toBe("not-allowed");
  });
});

describe("the verbs of an assignable unit", () => {
  it("are the five that cmi5 9.3 lists for an assignable unit, and the others are the LMS's", () => {
    expect(AU_VERBS).toStrictEqual(["initialized", "completed", "passed", "failed", "terminated"]);
    expect(Object.keys(CMI5_VERBS).filter((name) => !(AU_VERBS as readonly string[]).includes(name))).toStrictEqual([
      "launched",
      "abandoned",
      "waived",
      "satisfied",
    ]);
  });
});

describe("judging the statements of a session", () => {
  it("lists the errors of xAPI of a statement, and does not judge it further", () => {
    const { statements, facts } = sound();
    statements[1].verb = { id: "experienced" };
    expect(validateSessionStatements(statements, facts).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "[1].verb.id invalid-format",
    ]);
  });

  it("finds a list that is not one, and a hole in a list", () => {
    const { statements, facts } = sound();
    expect(validateSessionStatements(JSON.parse("{}"), facts).map(({ rule }) => rule)).toStrictEqual(["wrong-type"]);
    const holed = [...statements];
    delete holed[1];
    expect(validateSessionStatements(holed, facts).map(({ path }) => path)).toStrictEqual(["[1]"]);
  });

  it("orders statements with the forms of a time in UTC that ISO 8601 writes, and keeps one without a time where it stands", () => {
    const { statements, facts } = sound();
    statements[1].timestamp = "20260115T100200+0000";
    statements[2].timestamp = "2026-01-15T10:03+00";
    expect(validateSessionStatements(statements, facts)).toStrictEqual([]);
    delete statements[1].timestamp;
    expect(validateSessionStatements(statements, facts).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "[1].timestamp timestamp",
    ]);
  });

  it.each(["2026-01-15 10:01:00Z", "2026-01-15T10:01:00+0000"])(
    "orders a statement whose time xAPI does not read, such as %j, as one without a time",
    (timestamp) => {
      const statements = sound().statements.slice(0, 2);
      statements[0].timestamp = "2026-01-15T10:05:00Z";
      statements[1].timestamp = timestamp;
      expect(sessionOrder(statements)).toStrictEqual([0, 1]);
      statements[1].timestamp = "2026-01-15T10:01:00Z";
      expect(sessionOrder(statements)).toStrictEqual([1, 0]);
    },
  );

  it("refuses a statement that cmi5 defines from a Group, or whose object is not the activity of the launch", () => {
    const { statements, facts } = sound();
    statements[2].object = { objectType: "Agent", account: { homePage: "https://lms.example.org", name: "x" } };
    statements[0].actor = { objectType: "Group", account: { homePage: "https://lms.example.org", name: "learner-1" } };
    expect(validateSessionStatements(statements, facts).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "[0].actor actor",
      "[0].actor actor-account",
      "[2].object object",
    ]);
  });

  it("refuses a session id other than the session's, and a template value of another member that a statement changed", () => {
    const { statements, facts } = sound();
    const instructor = { objectType: "Agent", account: { homePage: "https://lms.example.org", name: "teacher-1" } };
    facts.launchData.contextTemplate.instructor = instructor;
    for (const statement of statements)
      statement.context.instructor = { account: instructor.account, objectType: "Agent" };
    statements[1].context.extensions["https://w3id.org/xapi/cmi5/context/extensions/sessionid"] = "session-2";
    statements[2].context.instructor = { ...instructor, name: "Teacher" };
    statements[3].context.instructor = {
      objectType: "Agent",
      account: { homePage: "https://lms.example.org", name: "teacher-2" },
    };
    expect(validateSessionStatements(statements, facts).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "[1].context.extensions session-id",
      "[2].context.instructor context-template",
      "[3].context.instructor context-template",
    ]);
  });

  it("finds each value of the template in a statement without a context, and takes an object without its objectType", () => {
    const { statements, facts } = sound();
    delete statements[1].context;
    delete statements[2].object.objectType;
    expect(validateSessionStatements(statements, facts).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "[1].context.registration registration",
      "[1].context.extensions session-id",
      "[1].context.contextActivities.grouping context-template",
    ]);
  });

  it("compares the values of a template by content: an object is not a list, and a template may hold no activities", () => {
    const { statements, facts } = sound();
    const extension = "https://lms.example.org/xapi/extensions/tenant";
    facts.launchData.contextTemplate = {
      extensions: { ...facts.launchData.contextTemplate.extensions, [extension]: { id: 1 } },
    };
    for (const statement of statements) statement.context.extensions[extension] = { id: 1 };
    statements[1].context.extensions[extension] = [1];
    expect(validateSessionStatements(statements, facts).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "[1].context.extensions context-template",
    ]);
  });

  it("takes a session whose learner read the preferences before initialized", () => {
    const { statements, facts } = sound();
    expect(validateSessionStatements(statements, { ...facts, preferencesRead: true })).toStrictEqual([]);
  });

  it("lists at most maxFindings, and a last finding that says the list stopped", () => {
    const { statements, facts } = sound();
    for (const statement of statements) statement.timestamp = "2026-01-15T17:00:00+07:00";
    const findings = validateSessionStatements(statements, facts, { maxFindings: 2 });
    expect(findings.map(({ rule }) => rule)).toStrictEqual(["timestamp-utc", "timestamp-utc", "findings-stopped"]);
  });

  it("throws a DataError that names facts or options that are not valid", () => {
    const { statements, facts } = sound();
    for (const [session, sentence] of [
      [null, "The session is invalid: expected an object, found null."],
      [{ ...facts, registration: "r" }, 'The session is invalid at registration: expected a UUID, found "r".'],
      [{ ...facts, activityId: "a" }, "The session is invalid at activityId"],
      [{ ...facts, actor: { name: "x" } }, "The session at actor is invalid"],
      [{ ...facts, launchData: { launchMode: "Normal" } }, "The session at launchData is invalid"],
      [{ ...facts, prior: { completed: "yes" } }, "The session is invalid at prior.completed"],
      [{ ...facts, extra: 1 }, 'The session is invalid: unexpected property "extra".'],
    ] as const) {
      expect(() => validateSessionStatements(statements, JSON.parse(JSON.stringify(session)))).toThrow(sentence);
    }
    expect(() => validateSessionStatements(statements, facts, JSON.parse('{ "maxFindings": 0 }'))).toThrow(
      "The options object is invalid at maxFindings",
    );
  });
});

describe("the step that judges one statement against its session", () => {
  it("gives the session after the statement, which a host that refuses the statement does not keep", () => {
    const { statements, facts } = sound();
    const start = sessionStart(facts);
    const first = judgeStatement(statements[0], facts, start);
    expect(first.findings).toStrictEqual([]);
    expect(first.next).toStrictEqual({
      initializedAt: Date.parse("2026-01-15T10:01:00.000Z"),
      terminated: false,
      verbs: ["initialized"],
      completed: false,
      passed: false,
    });
    expect(judgeStatement(statements[2], facts, start).findings.map(({ rule }) => rule)).toStrictEqual([
      "before-initialized",
    ]);
    expect(sessionStart({ ...facts, prior: { completed: true, passed: true } })).toMatchObject({
      completed: true,
      passed: true,
    });
    const earlier = { ...statements[1], timestamp: "2026-01-15T10:00:30.000Z" };
    expect(
      judgeStatement(earlier, facts, first.next).findings.map(({ path, rule }) => `${path} ${rule}`),
    ).toStrictEqual(["timestamp before-initialized"]);
    const withoutTime = { ...statements[0], timestamp: undefined };
    expect(judgeStatement(withoutTime, facts, start).next.initializedAt).toBe(Number.NEGATIVE_INFINITY);
  });
});
