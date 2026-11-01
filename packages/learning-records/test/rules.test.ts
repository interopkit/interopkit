import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { ACCEPTANCES, ADVISORIES, type Json, REFUSALS, type XapiRule } from "../../../scripts/xapi-rules.js";
import { type RuleRole, readStatement, validateStatement } from "../src/index.js";
import { summary } from "./fixture.js";
import { providerStatement } from "./full-statement.js";

const ROLES: readonly RuleRole[] = ["lrs", "provider"];

/** The Statement of a provider as JSON, which the fixtures of the rules change. */
function base(): Json {
  return JSON.parse(JSON.stringify(providerStatement()));
}

/** Runs a table of rules: the readers of each role find exactly what the entry says, and refuse exactly when it names an error. */
function describeRules(title: string, rules: readonly XapiRule[]): void {
  describe(title, () => {
    for (const role of ROLES) {
      it.each(rules.map((rule) => [`${rule.source}: ${rule.text}`, rule] as const))(
        `finds what the standard asks of ${role === "lrs" ? "an LRS" : "a Learning Record Provider"}: %s`,
        (_name, rule) => {
          const statement = rule.fixture(base());
          const expected = rule[role];
          expect(summary(validateStatement(statement, { role }))).toStrictEqual(expected);
          if (expected.some(({ severity }) => severity === "error")) {
            expect(() => readStatement(statement, { role })).toThrow(DataError);
          } else {
            expect(() => readStatement(statement, { role })).not.toThrow();
          }
        },
      );
    }
  });
}

describeRules("the rules that a Statement breaks", REFUSALS);
describeRules("the rules with warnings, and those that the roles judge differently", ADVISORIES);

describe("what an LRS shall not reject", () => {
  it.each(ACCEPTANCES.map((rule) => [`${rule.source}: ${rule.text}`, rule] as const))(
    "accepts the Statement: %s",
    (_name, rule) => {
      const statement = rule.fixture(base());
      expect(validateStatement(statement)).toStrictEqual([]);
      expect(() => readStatement(statement)).not.toThrow();
    },
  );
});
