import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import {
  ACCEPTANCES,
  ADVISORIES,
  type ProfileRule,
  REFUSALS,
  soundProfile,
} from "../../../scripts/xapi-profile-rules.js";
import { readProfile, validateProfile } from "../src/profiles/index.js";
import { summary } from "./fixture.js";

/** Runs a table of rules: the validator finds exactly what the entry says, and the reader refuses exactly when it names an error. */
function describeRules(title: string, rules: readonly ProfileRule[]): void {
  describe(title, () => {
    it.each(rules.map((rule) => [`${rule.source}: ${rule.text}`, rule] as const))(
      "finds what the specification asks: %s",
      (_name, rule) => {
        const profile = rule.fixture(soundProfile());
        const options = rule.profiles === undefined ? undefined : { profiles: rule.profiles };
        expect(summary(validateProfile(profile, options))).toStrictEqual(rule.findings);
        if (rule.findings.some(({ severity }) => severity === "error")) {
          expect(() => readProfile(profile, options)).toThrow(DataError);
        } else {
          expect(() => readProfile(profile, options)).not.toThrow();
        }
      },
    );
  });
}

describe("the profile of the examples of the specification", () => {
  it("is sound", () => {
    expect(validateProfile(soundProfile())).toStrictEqual([]);
  });
});

describeRules("the rules that a profile breaks", REFUSALS);
describeRules("the recommendations, and what a validator notes", ADVISORIES);
describeRules("what a profile may do", ACCEPTANCES);
