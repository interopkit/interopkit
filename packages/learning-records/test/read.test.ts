import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import { readStatement, validateStatement, validateStatements } from "../src/index.js";
import { copyOf, sharesNothing, summary } from "./fixture.js";
import { fullStatement, minimalStatement, providerStatement, subStatementStatement, uuid } from "./full-statement.js";

describe("readStatement", () => {
  it.each([
    ["the full Statement", fullStatement],
    ["the smallest Statement", minimalStatement],
    ["a Statement with a SubStatement", subStatementStatement],
  ])("reads %s as itself in both roles, and shares nothing with the input", (_name, make) => {
    for (const role of ["lrs", "provider"] as const) {
      const input = make();
      const statement = readStatement(input, { role });
      expect(statement).toStrictEqual(input);
      expect(sharesNothing(statement, input)).toBe(true);
    }
  });

  it("reads a Statement that is frozen, and changes nothing in it", () => {
    const input = deepFreeze(fullStatement());
    expect(readStatement(input)).toStrictEqual(fullStatement());
    expect(input).toStrictEqual(fullStatement());
  });

  it("returns a single Activity of the context as a list of one, and a list as it is", () => {
    const input = copyOf(fullStatement()) as unknown as { context: { contextActivities: Record<string, unknown> } };
    const parent = { id: "https://example.org/activities/quiz-1" };
    const grouping = [{ id: "https://example.org/activities/course-1" }];
    input.context.contextActivities = { parent, grouping };
    const read = readStatement(input);
    expect(read.context?.contextActivities).toStrictEqual({ parent: [parent], grouping });
    expect(read.context?.contextActivities?.parent?.[0]).not.toBe(parent);
  });

  it("returns a single Activity of the context of a SubStatement as a list of one", () => {
    const input = copyOf(subStatementStatement()) as unknown as { object: { context: Record<string, unknown> } };
    input.object.context = { contextActivities: { other: { id: "https://example.org/activities/resource-9" } } };
    const read = readStatement(input);
    expect(read.object).toMatchObject({
      context: { contextActivities: { other: [{ id: "https://example.org/activities/resource-9" }] } },
    });
  });

  it("reads a Statement with warnings, and leaves the warnings to the validator", () => {
    const input = copyOf(fullStatement());
    expect(summary(validateStatement(input, { role: "provider" }))).toHaveLength(3);
    expect(readStatement(input, { role: "provider" })).toStrictEqual(input);
  });

  it("refuses a Statement with an error, and names the first error, how many follow, and the validator", () => {
    const input = copyOf(minimalStatement()) as unknown as Record<string, unknown>;
    delete input.verb;
    input.extra = 1;
    input.timestamp = "yesterday";
    expect(() => readStatement(input)).toThrow(DataError);
    expect(() => readStatement(input)).toThrow(
      'The statement is invalid at verb: missing the property "verb". 2 more errors: validateStatement lists every finding.',
    );
  });

  it("names the error alone when there is one, and says where", () => {
    const input = { ...minimalStatement(), verb: { id: "completed" } };
    expect(() => readStatement(input)).toThrow(
      'The statement is invalid at verb.id: expected a URI with a scheme, such as https://example.org/x, found "completed".',
    );
  });

  it.each([null, undefined, 5, "text", [], [minimalStatement()], true])(
    "refuses %j, which is not a Statement, with a sentence",
    (value) => {
      expect(() => readStatement(value)).toThrow(/^The statement is invalid: expected an object, found /);
    },
  );

  it("refuses a property that is named __proto__, as one that the Statement does not have", () => {
    const input = JSON.parse(`{"__proto__": {"polluted": true}, "actor": {"mbox": "mailto:a@example.org"},
      "verb": {"id": "http://adlnet.gov/expapi/verbs/completed"}, "object": {"id": "https://example.org/a"}}`);
    expect(summary(validateStatement(input))).toStrictEqual([
      { path: "__proto__", rule: "unknown-property", severity: "error" },
    ]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses %s as a key of a language map and of extensions",
    (key) => {
      const map = JSON.parse(`{"${key}": "x"}`);
      const display = validateStatement({ ...minimalStatement(), verb: { id: "https://example.org/v", display: map } });
      expect(summary(display)).toStrictEqual([
        { path: `verb.display.${key}`, rule: "invalid-format", severity: "error" },
      ]);
      const extensions = validateStatement({ ...minimalStatement(), result: { extensions: map } });
      expect(summary(extensions)).toStrictEqual([
        { path: `result.extensions.${key}`, rule: "invalid-format", severity: "error" },
      ]);
    },
  );

  it("keeps a language that is a name of Object.prototype out of the prototype of the result", () => {
    const statement = readStatement({
      ...minimalStatement(),
      verb: { id: "https://example.org/v", display: { en: "x" } },
    });
    expect(Object.getPrototypeOf(statement.verb.display)).toBe(Object.prototype);
  });
});

describe("what is not an object where an object is", () => {
  it.each([
    ["the language map of a Verb", { verb: { id: "https://example.org/v", display: 5 } }, "verb.display"],
    ["the extensions of a Result", { result: { extensions: 5 } }, "result.extensions"],
    ["the extensions of a Result", { result: { extensions: [] } }, "result.extensions"],
  ])("gives one finding for %s that is a %#", (_name, change, path) => {
    const statement = { ...minimalStatement(), ...change };
    expect(validateStatement(statement).map((finding) => finding.path)).toStrictEqual([path]);
  });
});

describe("the voiding of a Statement", () => {
  const voiding = (object: unknown) => ({
    ...minimalStatement(),
    verb: { id: "http://adlnet.gov/expapi/verbs/voided" },
    object,
  });

  it.each([
    [{ id: "https://example.org/a" }, "Activity"],
    [{ objectType: "Agent", mbox: "mailto:a@example.org" }, "Agent"],
    [{ objectType: "Group", mbox: "mailto:g@example.org" }, "Group"],
  ])("names the type of the Object that is not a Statement Reference: %j", (object, type) => {
    expect(validateStatement(voiding(object))).toStrictEqual([
      {
        path: "object",
        rule: "voiding-target",
        message: `expected a Statement Reference to the Statement that the verb voids, found an object of type ${type}.`,
        severity: "error",
      },
    ]);
  });

  it("refuses a SubStatement that voids a Statement the same way", () => {
    const sub = {
      objectType: "SubStatement",
      actor: { mbox: "mailto:a@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/voided" },
      object: { id: "https://example.org/a" },
    };
    expect(validateStatement({ ...minimalStatement(), object: sub }).map(({ path }) => path)).toStrictEqual([
      "object.object",
    ]);
  });
});

describe("an Activity without an interaction", () => {
  it("is read with a definition that has no interaction property", () => {
    const statement = {
      ...minimalStatement(),
      object: { id: "https://example.org/a", definition: { name: { en: "A" } } },
    };
    expect(validateStatement(statement)).toStrictEqual([]);
  });
});

describe("the options", () => {
  it.each([
    [null, "The options object is invalid: expected an object, found null."],
    [[], "The options object is invalid: expected an object, found an array."],
    ["lrs", 'The options object is invalid: expected an object, found "lrs".'],
    [{ role: "judge" }, 'The options object is invalid at role: expected "lrs" or "provider", found "judge".'],
    [{ role: null }, 'The options object is invalid at role: expected "lrs" or "provider", found null.'],
    [{ role: 5 }, 'The options object is invalid at role: expected "lrs" or "provider", found 5.'],
    [{ version: "2.0.0" }, 'The options object is invalid: unexpected property "version".'],
    [{ maxFindings: 0 }, "The options object is invalid at maxFindings: expected a value of at least 1, found 0."],
    [{ maxFindings: "5" }, 'The options object is invalid at maxFindings: expected a number, found "5".'],
  ])("refuses %j, as JavaScript or JSON passes it, in all three functions", (options, sentence) => {
    const given = JSON.parse(JSON.stringify(options));
    expect(() => readStatement(minimalStatement(), given)).toThrow(new DataError(sentence));
    expect(() => validateStatement(minimalStatement(), given)).toThrow(new DataError(sentence));
    expect(() => validateStatements([], given)).toThrow(new DataError(sentence));
  });

  it("takes the rules of an LRS when told no role", () => {
    const statement = { ...minimalStatement(), version: "1.0.0" };
    expect(validateStatement(statement)).toStrictEqual([]);
    expect(validateStatement(statement, {})).toStrictEqual([]);
    expect(validateStatement(statement, { role: "lrs" })).toStrictEqual([]);
    expect(summary(validateStatement(statement, { role: "provider" }))).toContainEqual({
      path: "version",
      rule: "invalid-value",
      severity: "error",
    });
  });
});

describe("validateStatement", () => {
  it("gives no finding for a sound Statement of either role", () => {
    expect(validateStatement(fullStatement())).toStrictEqual([]);
    expect(validateStatement(providerStatement(), { role: "provider" })).toStrictEqual([]);
  });

  it("gives the path, the rule, a sentence and the severity of each finding", () => {
    const statement = {
      ...minimalStatement(),
      actor: { mbox: "mailto:a@example.org", openid: "https://id.example.org/a" },
    };
    expect(validateStatement(statement)).toStrictEqual([
      {
        path: "actor",
        rule: "identifier-count",
        message: "needs exactly one of mbox, mbox_sha1sum, openid and account, found mbox and openid.",
        severity: "error",
      },
    ]);
  });

  it.each([null, undefined, 5, "text", [], true])("gives one finding for %j, which is not a Statement", (value) => {
    expect(validateStatement(value)).toStrictEqual([
      expect.objectContaining({ path: "", rule: "wrong-type", severity: "error" }),
    ]);
  });

  it("gives the findings about the shape alone while the shape is wrong, and the rules between properties after", () => {
    const wrongShape = {
      ...minimalStatement(),
      actor: { mbox: "mailto:a@example.org", openid: "https://id.example.org/a" },
      id: "x",
    };
    expect(summary(validateStatement(wrongShape))).toStrictEqual([
      { path: "id", rule: "invalid-format", severity: "error" },
    ]);
  });

  it("gives every finding in the order of the properties", () => {
    const statement = {
      ...providerStatement(),
      id: uuid(9),
      actor: { mbox: "mailto:a@example.org", openid: "https://id.example.org/a" },
      object: {
        id: "https://example.org/a",
        definition: { interactionType: "true-false", correctResponsesPattern: ["maybe"] },
      },
      result: { score: { scaled: 2 } },
    };
    expect(validateStatement(statement).map(({ path }) => path)).toStrictEqual([
      "actor",
      "object.definition.correctResponsesPattern[0]",
      "result.score.scaled",
    ]);
  });

  it("does not repeat the path in the sentence", () => {
    const statement = {
      ...minimalStatement(),
      actor: { mbox: "mailto:a@example.org", openid: "https://id.example.org/a" },
      result: { score: { raw: 1, min: 2 } },
    };
    for (const finding of validateStatement(statement, { role: "provider" })) {
      expect(finding.path === "" || finding.message.startsWith(finding.path)).toBe(false);
    }
  });
});

describe("validateStatements", () => {
  it("gives no finding for a batch of sound Statements", () => {
    expect(validateStatements([fullStatement(), minimalStatement(), subStatementStatement()])).toStrictEqual([]);
    expect(validateStatements([])).toStrictEqual([]);
  });

  it("gives the findings of each Statement with its index in the path", () => {
    const bad = { ...minimalStatement(), verb: { id: "completed" } };
    expect(summary(validateStatements([minimalStatement(), bad, { ...bad, id: "x" }]))).toStrictEqual([
      { path: "[1].verb.id", rule: "invalid-format", severity: "error" },
      { path: "[2].id", rule: "invalid-format", severity: "error" },
      { path: "[2].verb.id", rule: "invalid-format", severity: "error" },
    ]);
  });

  it("holds each Statement to the rules of the role", () => {
    expect(summary(validateStatements([minimalStatement()], { role: "provider" }))).toStrictEqual([
      { path: "[0].id", rule: "missing-property", severity: "warning" },
    ]);
  });

  it("refuses a batch in which two Statements have the same id, whatever the case of the digits", () => {
    const id = "ABCDEF00-0000-4000-8000-000000000001";
    const batch = [{ ...minimalStatement(), id }, minimalStatement(), { ...minimalStatement(), id: id.toLowerCase() }];
    expect(validateStatements(batch)).toStrictEqual([
      {
        path: "[2].id",
        rule: "duplicate-id",
        message: `expected an id that no earlier Statement of the batch has, found "${id.toLowerCase()}" again from [0].`,
        severity: "error",
      },
    ]);
  });

  it("counts a repeated id once for each Statement after the first", () => {
    const batch = [fullStatement(), fullStatement(), fullStatement()];
    expect(validateStatements(batch).map(({ path }) => path)).toStrictEqual(["[1].id", "[2].id"]);
  });

  it("finds the repeated id of a Statement that has other errors", () => {
    const bad = { ...minimalStatement(), id: uuid(5), extra: 1 };
    expect(summary(validateStatements([bad, bad]))).toStrictEqual([
      { path: "[0].extra", rule: "unknown-property", severity: "error" },
      { path: "[1].extra", rule: "unknown-property", severity: "error" },
      { path: "[1].id", rule: "duplicate-id", severity: "error" },
    ]);
  });

  it.each([null, undefined, {}, "text", 5, minimalStatement()])(
    "gives one finding for %j, which is not an array",
    (value) => {
      const [finding, ...others] = validateStatements(value);
      expect(others).toStrictEqual([]);
      expect(finding).toMatchObject({ path: "", rule: "wrong-type", severity: "error" });
      expect(finding?.message).toMatch(/^expected an array of Statements, found /);
    },
  );

  it("ignores an entry that is not an object when it looks for repeated ids", () => {
    expect(summary(validateStatements([null, "x", 5, [], minimalStatement()]))).toStrictEqual(
      [0, 1, 2, 3].map((index) => ({ path: `[${index}]`, rule: "wrong-type", severity: "error" })),
    );
  });
});

describe("the limit of findings", () => {
  const stopped = {
    path: "",
    rule: "findings-stopped",
    message: "the check stopped after 1000 findings, so there may be more.",
    severity: "error",
  };
  /** A Statement whose context holds the given number of Agents that name no one. */
  const withAgents = (count: number) => ({
    ...minimalStatement(),
    context: { contextAgents: Array.from({ length: count }, () => ({})) },
  });

  it("lists at most 1,000 findings of a Statement and ends the list with one that says it stopped", () => {
    const findings = validateStatement(withAgents(100_000));
    expect(findings).toHaveLength(1001);
    expect(findings.at(-1)).toStrictEqual(stopped);
  });

  it("lists at most 1,000 findings of a list of numbers where an object belongs", () => {
    const statement = { ...minimalStatement(), context: { contextAgents: Array.from({ length: 1_000_000 }, () => 0) } };
    expect(validateStatement(statement)).toHaveLength(1001);
  });

  it("reads no more of the value than it takes to fill the list", () => {
    let reads = 0;
    const agents = new Proxy(
      Array.from({ length: 100_000 }, () => ({})),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/u.test(property)) reads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    expect(validateStatement({ ...minimalStatement(), context: { contextAgents: agents } })).toHaveLength(1001);
    expect(reads).toBeLessThan(1000);
  });

  it("reads no more Statements of a batch than it takes to fill the list", () => {
    let reads = 0;
    const batch = new Proxy(
      Array.from({ length: 100_000 }, () => ({})),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/u.test(property)) reads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    expect(validateStatements(batch)).toHaveLength(1001);
    expect(reads).toBeLessThan(1000);
  });

  it("keeps the findings in the order of the check, whatever the limit", () => {
    const some = validateStatement(withAgents(500), { maxFindings: 5 });
    expect(some).toHaveLength(6);
    expect(validateStatement(withAgents(500), { maxFindings: 9 }).slice(0, 5)).toStrictEqual(some.slice(0, 5));
  });

  it("does not stop a list that has exactly the limit", () => {
    const exact = validateStatement(withAgents(2));
    expect(exact.length).toBeGreaterThan(1);
    expect(validateStatement(withAgents(2), { maxFindings: exact.length })).toStrictEqual(exact);
    expect(validateStatement(withAgents(2), { maxFindings: exact.length - 1 }).at(-1)?.rule).toBe("findings-stopped");
  });

  it("holds the findings of a whole batch to the limit, and stops looking at its Statements", () => {
    const batch = Array.from({ length: 100_000 }, () => ({}));
    const findings = validateStatements(batch);
    expect(findings).toHaveLength(1001);
    expect(findings[0]?.path).toBe("[0].actor");
    expect(findings.at(-1)).toStrictEqual(stopped);
    const same = Array.from({ length: 2000 }, () => ({ ...minimalStatement(), id: uuid(1) }));
    const duplicates = validateStatements(same, { maxFindings: 10 });
    expect(duplicates).toHaveLength(11);
    expect(duplicates[0]?.rule).toBe("duplicate-id");
  });

  it("counts the errors of a reader alone, and makes it refuse when they stopped the check", () => {
    expect(() => readStatement(withAgents(50), { maxFindings: 2 })).toThrow(
      "At least 1 more error: the check stopped at its limit, and validateStatement with a higher maxFindings lists more.",
    );
    expect(() => readStatement(withAgents(50), { maxFindings: 1 })).toThrow("There may be more errors");
    const provider = { ...providerStatement(), version: "1.0.0" };
    expect(readStatement(provider, { role: "lrs", maxFindings: 1 })).toStrictEqual(provider);
  });
});
