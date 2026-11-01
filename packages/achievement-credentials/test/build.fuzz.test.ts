import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import {
  buildAchievementCredential,
  buildClrCredential,
  buildEndorsementCredential,
  caseAlignment,
  credentialSummary,
  hashIdentifier,
  matchesIdentifier,
  newerCredential,
  readCredential,
  sameCredential,
  validateCredential,
} from "../src/index.js";
import { ACHIEVEMENT, achievementCredential, PROFILE } from "./fixtures.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_105, numRuns: 300 };

/** Values of every kind that JSON or JavaScript can hand over, including those that JSON cannot write. */
const anything = fc.oneof(
  fc.jsonValue(),
  fc.anything({
    withNullPrototype: true,
    withBigInt: true,
    withDate: true,
    withMap: true,
    withSet: true,
    withTypedArray: true,
  }),
);

const INPUTS = {
  achievement: {
    build: buildAchievementCredential,
    input: {
      id: "https://example.edu/credentials/1",
      issuer: PROFILE,
      validFrom: "2024-06-13T10:00:00Z",
      name: "Course badge",
      subject: { id: "did:example:learner" },
      achievement: ACHIEVEMENT,
    },
  },
  endorsement: {
    build: buildEndorsementCredential,
    input: {
      id: "https://example.edu/endorsements/1",
      issuer: PROFILE,
      validFrom: "2024-06-13T10:00:00Z",
      name: "Endorsement",
      endorses: "https://example.edu/achievements/1",
    },
  },
  clr: {
    build: buildClrCredential,
    input: {
      id: "https://example.edu/clrs/1",
      issuer: PROFILE,
      validFrom: "2024-06-13T10:00:00Z",
      name: "Transcript",
      subject: { id: "did:example:learner" },
      credentials: [achievementCredential()],
    },
  },
} as const;

/** Tells whether a function returns, or throws the error of the family, and nothing else. */
function returnsOrRefuses<TResult>(run: () => TResult): TResult | undefined {
  try {
    return run();
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
    return undefined;
  }
}

describe("the builders and the comparisons on any value", () => {
  it("return or refuse with a DataError, and throw no other error, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, anything, (first, second) => {
        for (const { build } of Object.values(INPUTS))
          returnsOrRefuses(() => (build as (input: unknown) => unknown)(first));
        returnsOrRefuses(() => caseAlignment(first as never));
        returnsOrRefuses(() => hashIdentifier(first as never, second as never));
        returnsOrRefuses(() => matchesIdentifier(first as never, second as never));
        returnsOrRefuses(() => sameCredential(first as never, second as never));
        returnsOrRefuses(() => newerCredential(first as never, second as never));
        returnsOrRefuses(() => credentialSummary(first as never));
      }),
      RUNS,
    );
  });

  it.each(Object.entries(INPUTS))(
    "build a valid input with a change into a credential that is read as itself, or refuse it: %s",
    (_name, { build, input }) => {
      fc.assert(
        fc.property(mutations, (change) => {
          const changed = mutate(JSON.parse(JSON.stringify(input)), change, [...BAD_STRINGS, "sha256$abc"]);
          const built = returnsOrRefuses(() => (build as (input: unknown) => unknown)(changed));
          if (built === undefined) return;
          expect(readCredential(built)).toStrictEqual(built);
          expect(validateCredential(built).filter(({ severity }) => severity === "error")).toStrictEqual([]);
        }),
        RUNS,
      );
    },
  );

  it("stop a hostile depth with a DataError, whatever the depth is", () => {
    let deep: Record<string, unknown> = { ...PROFILE };
    for (let level = 0; level < 200_000; level += 1) deep = { ...PROFILE, parentOrg: deep };
    const { build, input } = INPUTS.achievement;
    expect(() => build({ ...input, issuer: deep as never })).toThrow(DataError);
  });
});
