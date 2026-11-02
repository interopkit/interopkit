import { DataError } from "@interopkit/core";
import learningLocker from "@learninglocker/xapi-validation";
import { describe, expect, it } from "vitest";
import type { Json, XapiRule } from "../../../scripts/xapi-rules.js";
import { ACCEPTANCES_V1, ADVISORIES_V1, REFUSALS_V1 } from "../../../scripts/xapi-v1-rules.js";
import { type RuleRole, readStatement, validateStatement } from "../src/index.js";
import { summary } from "./fixture.js";
import { providerStatementV1 } from "./full-statement.js";

const ROLES: readonly RuleRole[] = ["lrs", "provider"];

/** The Statement of a provider of 1.0.3 as JSON, which the fixtures of the rules change. */
function base(): Json {
  return JSON.parse(JSON.stringify(providerStatementV1()));
}

/** Runs a table of rules: the readers of each role find exactly what the entry says, and refuse exactly when it names an error. */
function describeRules(title: string, rules: readonly XapiRule[]): void {
  describe(title, () => {
    for (const role of ROLES) {
      it.each(rules.map((rule) => [`${rule.source}: ${rule.text}`, rule] as const))(
        `finds what 1.0.3 asks of ${role === "lrs" ? "an LRS" : "a Learning Record Provider"}: %s`,
        (_name, rule) => {
          const statement = rule.fixture(base());
          const expected = rule[role];
          const options = { role, version: "1.0.3" } as const;
          expect(summary(validateStatement(statement, options))).toStrictEqual(expected);
          if (expected.some(({ severity }) => severity === "error")) {
            expect(() => readStatement(statement, options)).toThrow(DataError);
          } else {
            expect(() => readStatement(statement, options)).not.toThrow();
          }
        },
      );
    }
  });
}

describeRules("the rules of 1.0.3 that a Statement breaks", REFUSALS_V1);
describeRules("the rules of 1.0.3 with warnings, and those that the roles judge differently", ADVISORIES_V1);

describe("what an LRS of 1.0.3 shall not reject", () => {
  it.each(ACCEPTANCES_V1.map((rule) => [`${rule.source}: ${rule.text}`, rule] as const))(
    "accepts the Statement: %s",
    (_name, rule) => {
      const statement = rule.fixture(base());
      expect(validateStatement(statement, { version: "1.0.3" })).toStrictEqual([]);
      expect(() => readStatement(statement, { version: "1.0.3" })).not.toThrow();
    },
  );
});

describe("the Statement of the fixtures", () => {
  it("breaks no rule of 1.0.3 for either role", () => {
    for (const role of ROLES) expect(validateStatement(base(), { role, version: "1.0.3" })).toStrictEqual([]);
  });
});

/** The validator of Learning Locker: the package is CommonJS, so Node gives its `exports` and a bundler gives the function. */
const imported = learningLocker as unknown as
  | ((data: unknown) => readonly unknown[])
  | { readonly default: (data: unknown) => readonly unknown[] };
const validateWithLearningLocker = typeof imported === "function" ? imported : imported.default;

/** What an implementation does with a Statement. */
type Verdict = "accepts" | "refuses";

/** What the validator of Learning Locker says of a Statement. */
function learningLockerSays(statement: Json): Verdict {
  return validateWithLearningLocker(statement).length === 0 ? "accepts" : "refuses";
}

/** What the reader of an LRS of 1.0.3 says of a Statement. */
function readerSays(statement: Json): Verdict {
  try {
    readStatement(statement, { version: "1.0.3" });
    return "accepts";
  } catch {
    return "refuses";
  }
}

/** A place where the two differ: what each says. */
interface Difference {
  readonly ours: Verdict;
  readonly theirs: Verdict;
}

const WE_REFUSE: Difference = { ours: "refuses", theirs: "accepts" };
const WE_ACCEPT: Difference = { ours: "accepts", theirs: "refuses" };

/**
 * Where the validator of Learning Locker 4.0.0 and the reader of an LRS of 1.0.3 differ on the fixtures of the rules. Each is
 * recorded in `docs/learning-records/spec-gaps.md` with the text of the standard. The test fails when another difference appears
 * and when one of these goes, so that the list is the whole of it.
 */
const DIFFERENCES: Readonly<Record<string, Difference>> = {
  "Data 2.4.11: The length of the data in octets is not negative.": WE_REFUSE,
  "Data 2.4.11: The sha2 is a SHA-2 hash.": WE_REFUSE,
  "Data 2.4.2.2: An Anonymous Group must not contain Group Objects in the member identifiers.": WE_REFUSE,
  "Data 2.4.4.1 and Data 2.2: An LRS may return 400 if the remaining properties are not valid for the Interaction Activity. Additional properties should not be added.":
    WE_ACCEPT,
  "Data 2.4.4.1 and Data 2.2: No component lists are supported for fill-in.": WE_ACCEPT,
  "Data 2.4.5.1: The lowest possible score is less than max.": WE_REFUSE,
  "Data 2.4.6.2: Every value in the contextActivities Object must be either a single Activity Object or an array of Activity Objects.":
    WE_ACCEPT,
  "Data 2.4.6.2: The LRS must return every value in the contextActivities Object as an array. The Learning Record Provider should ensure that every value is an array.":
    WE_ACCEPT,
  "Data 2.4.6.2: The same for the context of a SubStatement.": WE_ACCEPT,
  "Data 2.4.6: The team of a context is a Group.": WE_REFUSE,
  "Data 4.4: It is recommended that variant 2 in RFC 4122 is used: id.": WE_ACCEPT,
  "Data 4.4: Variant 2: registration.": WE_ACCEPT,
  "Data 4.4: Variant 2: the Object that is a Statement Reference.": WE_ACCEPT,
  "Data 4.4: Variant 2: the Statement of a context.": WE_ACCEPT,
  "Data 4.5: A Timestamp in the basic format of ISO 8601.": WE_ACCEPT,
  "Data 4.5: A Timestamp is a combined date and time: a date alone.": WE_REFUSE,
  "Data 4.5: A Timestamp should be expressed in the format of RFC 3339, which the provider rules hold as a requirement: the basic format.":
    WE_ACCEPT,
  "Data 4.5: A date that does not exist.": WE_REFUSE,
  "Data 4.6: A Duration with a T has a time component.": WE_REFUSE,
};

describe("the validator of Learning Locker as the oracle of the rules of 1.0.3", () => {
  it("has the verdicts of the reader of an LRS on every fixture, except where Learning Locker answers otherwise", () => {
    const found: Record<string, Difference> = {};
    for (const rule of [...REFUSALS_V1, ...ADVISORIES_V1, ...ACCEPTANCES_V1]) {
      const statement = rule.fixture(base());
      const [theirs, ours] = [learningLockerSays(statement), readerSays(statement)];
      if (theirs !== ours) found[`${rule.source}: ${rule.text}`] = { ours, theirs };
    }
    expect(found).toStrictEqual(DIFFERENCES);
  });
});
