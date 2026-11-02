import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutate, mutations } from "../../../scripts/json-mutation.js";
import {
  buildStatement,
  readStatement,
  type Statement,
  toStatementVersion,
  validateStatement,
  voidingStatement,
} from "../src/index.js";
import { copyOf, sharesNothing } from "./fixture.js";
import { fullStatement, minimalStatement, providerStatementV1, subStatementStatement, uuid } from "./full-statement.js";
import { RUNS, STRINGS } from "./fuzz.js";

const PROCTOR = { objectType: "contextAgent", agent: { mbox: "mailto:proctor@example.org" } } as const;
const STUDY_GROUP = {
  objectType: "contextGroup",
  group: { objectType: "Group", mbox: "mailto:group@example.org" },
} as const;

/** A SubStatement with what 1.0.3 does not have. */
function withSubStatement(context: Statement["context"], timestamp: string): Statement {
  const { object, ...statement } = subStatementStatement();
  if (object.objectType !== "SubStatement") throw new Error("The fixture has a SubStatement.");
  return { ...statement, object: { ...object, context, timestamp } };
}

describe("toStatementVersion", () => {
  it("removes contextAgents and contextGroups, and writes the version 1.0.0 over the version 2.0.0", () => {
    const { context, ...rest } = fullStatement();
    const { contextAgents: _agents, contextGroups: _groups, ...kept } = context ?? {};
    expect(toStatementVersion(fullStatement(), "1.0.3")).toStrictEqual({ ...rest, context: kept, version: "1.0.0" });
  });

  it("removes them from the context of a SubStatement too, and keeps the rest of it", () => {
    const statement = withSubStatement({ language: "en", contextAgents: [PROCTOR] }, "2024-06-13T18:00:00.000Z");
    expect(toStatementVersion(statement, "1.0.3").object).toMatchObject({
      objectType: "SubStatement",
      context: { language: "en" },
      timestamp: "2024-06-13T18:00:00.000Z",
    });
    expect(JSON.stringify(toStatementVersion(statement, "1.0.3"))).not.toContain("contextAgents");
  });

  it("leaves out a context that held only Agents and Groups, of a Statement and of a SubStatement", () => {
    const statement = withSubStatement({ contextGroups: [STUDY_GROUP] }, "2024-06-13T18:00:00.000Z");
    const form = toStatementVersion({ ...statement, context: { contextAgents: [PROCTOR] } }, "1.0.3");
    expect(form).not.toHaveProperty("context");
    expect(form).not.toHaveProperty("object.context");
    expect(validateStatement(form, { version: "1.0.3" })).toStrictEqual([]);
  });

  it("comes back unchanged for a Statement already in the form, and shares nothing with it", () => {
    for (const statement of [providerStatementV1(), minimalStatement(), { ...minimalStatement(), version: "1.0.3" }]) {
      const given = copyOf(statement);
      const form = toStatementVersion(given, "1.0.3");
      expect(form).toStrictEqual(statement);
      expect(sharesNothing(form, given)).toBe(true);
      expect(given).toStrictEqual(statement);
    }
  });

  it("is idempotent", () => {
    const once = toStatementVersion(fullStatement(), "1.0.3");
    expect(toStatementVersion(once, "1.0.3")).toStrictEqual(once);
  });

  it.each(["1.0", "1.0.0", "1.0.3", "1.0.9"])("keeps the version %s", (version) => {
    expect(toStatementVersion({ ...minimalStatement(), version }, "1.0.3").version).toBe(version);
  });

  it("leaves out the version of a Statement that has none", () => {
    expect(toStatementVersion(minimalStatement(), "1.0.3")).not.toHaveProperty("version");
  });

  it.each([
    ["2024-06-13T18:46:03.250Z", "2024-06-13T18:46:03.250Z"],
    ["2024-06-13T20:46:03.250+02:00", "2024-06-13T20:46:03.250+02:00"],
    ["2024-06-13t18:46:03.250z", "2024-06-13T18:46:03.250Z"],
    ["2024-06-13T18:46:03.250-00:00", "2024-06-13T18:46:03.250Z"],
  ])("writes the time %s as %s, in a timestamp, a stored and a SubStatement", (time, written) => {
    const form = toStatementVersion(
      { ...withSubStatement({ language: "en" }, time), timestamp: time, stored: time },
      "1.0.3",
    );
    expect(form).toMatchObject({ timestamp: written, stored: written, object: { timestamp: written } });
  });

  it("keeps a time of ISO 8601 that RFC 3339 does not take", () => {
    const form = toStatementVersion({ ...minimalStatement(), timestamp: "20240613T184603+0200" }, "1.0.3");
    expect(form.timestamp).toBe("20240613T184603+0200");
  });

  it("takes a Statement whose version is another, and gives what the rules of 1.0.3 take", () => {
    const statement = { ...fullStatement(), version: "2.0.1" };
    const form = toStatementVersion(statement, "1.0.3");
    expect(form.version).toBe("1.0.0");
    expect(validateStatement(form, { version: "1.0.3" }).filter(({ severity }) => severity === "error")).toStrictEqual(
      [],
    );
  });

  it("gives a Statement that the rules of 1.0.3 take, whatever Statement of 2.0 it reads", () => {
    const statements = fc
      .constantFrom(
        fullStatement(),
        subStatementStatement(),
        withSubStatement({ contextAgents: [PROCTOR] }, "2024-06-13t18:00:00z"),
      )
      .map((statement) => JSON.parse(JSON.stringify(statement)));
    fc.assert(
      fc.property(statements, mutations, (statement, mutation) => {
        const changed = mutate(statement, mutation, STRINGS);
        let read: Statement;
        try {
          read = readStatement(changed);
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
          return;
        }
        expect(() => readStatement(toStatementVersion(read, "1.0.3"), { version: "1.0.3" })).not.toThrow();
      }),
      RUNS,
    );
  });

  it.each(["2.0.0", "1.0.0", 5, null])("refuses the version %j, which it does not write", (version) => {
    expect(() => toStatementVersion(minimalStatement(), JSON.parse(JSON.stringify(version)))).toThrow(
      new DataError(
        `The version must be "1.0.3", the version whose form is returned, found ${typeof version === "string" ? JSON.stringify(version) : version === null ? "null" : "5"}.`,
      ),
    );
  });

  it("refuses a value that is no Statement of either version, with the sentence of the rules of 2.0", () => {
    for (const value of ['{"actor":1}', "null", "[]", '"statement"', "{}"]) {
      expect(() => toStatementVersion(JSON.parse(value), "1.0.3")).toThrow(DataError);
    }
    expect(() => toStatementVersion({ ...minimalStatement(), timestamp: "yesterday" }, "1.0.3")).toThrow(
      "expected a date and time as RFC 3339",
    );
  });
});

describe("the builders of 1.0.3", () => {
  const event = {
    id: uuid(20),
    actor: { mbox: "mailto:learner@example.org" },
    verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
    object: { id: "https://example.org/activities/course-1" },
    timestamp: "2024-06-13T20:46:03.250+02:00",
  };

  it("writes the version 1.0.0 and the time in UTC", () => {
    expect(buildStatement(event, { version: "1.0.3" })).toStrictEqual({
      ...event,
      timestamp: "2024-06-13T18:46:03.250Z",
      version: "1.0.0",
    });
  });

  it("writes the version 2.0.0 by default and when it is asked for", () => {
    expect(buildStatement(event).version).toBe("2.0.0");
    expect(buildStatement(event, { version: "2.0.0" }).version).toBe("2.0.0");
  });

  it("refuses what 1.0.3 does not have", () => {
    const context = { contextAgents: [PROCTOR] };
    expect(buildStatement({ ...event, context }).context).toStrictEqual(context);
    expect(() => buildStatement({ ...event, context }, { version: "1.0.3" })).toThrow(DataError);
    expect(() => buildStatement({ ...event, context }, { version: "1.0.3" })).toThrow(
      'unexpected property "contextAgents"',
    );
  });

  it("gives a Statement that the provider rules of 1.0.3 accept, with the one warning of its version", () => {
    expect(
      validateStatement(buildStatement(event, { version: "1.0.3" }), { role: "provider", version: "1.0.3" }).map(
        ({ path, rule, severity }) => ({ path, rule, severity }),
      ),
    ).toStrictEqual([{ path: "version", rule: "lrs-managed-property", severity: "warning" }]);
  });

  it("builds the Statement that voids another", () => {
    const statement = voidingStatement(
      uuid(21),
      { id: uuid(22), actor: event.actor, timestamp: event.timestamp },
      { version: "1.0.3" },
    );
    expect(statement.version).toBe("1.0.0");
    expect(statement.object).toStrictEqual({ objectType: "StatementRef", id: uuid(21) });
  });

  it.each([
    ['{"version":"1.0"}', 'The options object is invalid at version: expected "2.0.0" or "1.0.3", found "1.0".'],
    ['{"version":null}', 'The options object is invalid at version: expected "2.0.0" or "1.0.3", found null.'],
    ["null", "The options object is invalid: expected an object, found null."],
    ["[]", "The options object is invalid: expected an object, found an array."],
    ['{"role":"lrs"}', 'The options object is invalid: unexpected property "role".'],
  ])("refuses the options %s, as JSON passes them", (options, sentence) => {
    expect(() => buildStatement(event, JSON.parse(options))).toThrow(new DataError(sentence));
    expect(() =>
      voidingStatement(uuid(21), { id: uuid(22), actor: event.actor, timestamp: event.timestamp }, JSON.parse(options)),
    ).toThrow(new DataError(sentence));
  });
});
