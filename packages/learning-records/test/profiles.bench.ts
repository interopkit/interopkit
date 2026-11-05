import { readStatement } from "@interopkit/learning-records";
import { createProfileValidator, validateProfile } from "@interopkit/learning-records/profiles";
import { expect, test } from "vitest";
import { soundProfile } from "../../../scripts/xapi-profile-rules.js";
import { BENCH_OPTIONS, expectRatio, RATIOS, STATEMENTS } from "./budgets.js";

const SPORTS = "http://example.org/profiles/sports";

/** The verbs of the profile that the benchmark reads: as many as the largest profile that ADL publishes has concepts, twice. */
const VERBS = 900;

/** The text of the profile of the examples with as many more verbs, each narrower than the next. */
function largeProfile(): string {
  const profile = soundProfile();
  const verb = (index: number) => `${SPORTS}/verbs/v${index}`;
  const verbs = Array.from({ length: VERBS }, (_, index) => ({
    id: verb(index),
    type: "Verb",
    inScheme: `${SPORTS}/v2`,
    prefLabel: { en: `verb ${index}` },
    definition: { en: "A verb of the benchmark." },
    ...(index === 0 ? {} : { narrower: [verb(index - 1)] }),
  }));
  return JSON.stringify({ ...profile, concepts: [...(profile.concepts as unknown[]), ...verbs] });
}

/**
 * The Patterns of the widest alternates, and the concepts that a profile takes over from another that it revises: far more than
 * any published profile has, so that a check whose work grows with their square shows above its budget.
 */
const WIDE = 40_000;

/** The tokens of JSON that the texts of the widest profiles may have: more than the million of the default. */
const WIDE_TOKENS = 3_000_000;

/** The bytes that the texts of the widest profiles may have: more than the 1,300,000 of the default. */
const WIDE_BYTES = 20_000_000;

/**
 * The texts of two profiles: one whose Pattern names each of its other Patterns in alternates, and which defines again every
 * concept of the other, whose version it revises.
 */
function wideProfiles(): { readonly text: string; readonly other: string } {
  const profile = soundProfile() as Record<string, any>;
  const other = "https://example.org/profiles/revised";
  const verb = (base: string, index: number) => ({
    id: `${other}/verbs/v${index}`,
    type: "Verb",
    inScheme: base,
    prefLabel: { en: `verb ${index}` },
    definition: { en: "A verb that a revision takes over." },
  });
  const patterns = Array.from({ length: WIDE }, (_, index) => ({
    id: `${SPORTS}/patterns/wide-${index}`,
    type: "Pattern",
    oneOrMore: `${SPORTS}/templates/start`,
  }));
  const wide = { id: `${SPORTS}/patterns/wide`, type: "Pattern", alternates: patterns.map(({ id }) => id) };
  const [first, ...later] = profile.versions;
  const revising = {
    ...profile,
    versions: [{ ...first, wasRevisionOf: [...(first.wasRevisionOf ?? []), `${other}/v1`] }, ...later],
    concepts: [...profile.concepts, ...Array.from({ length: WIDE }, (_, index) => verb(first.id, index))],
    patterns: [...profile.patterns, wide, ...patterns],
  };
  const revised = {
    ...profile,
    id: other,
    versions: [{ id: `${other}/v1`, generatedAtTime: "2019-01-01T00:00:00Z" }],
    concepts: Array.from({ length: WIDE }, (_, index) => verb(`${other}/v1`, index)),
    templates: undefined,
    patterns: undefined,
  };
  return { text: JSON.stringify(revising), other: JSON.stringify(revised) };
}

/** A relay race of the profile of the examples, of a registration: a start, handoffs and the placing. */
function relay(): readonly Record<string, unknown>[] {
  const verbs = [
    "http://adlnet.gov/expapi/verbs/attempted",
    "http://adlnet.gov/expapi/verbs/progressed",
    `${SPORTS}/verbs/placed`,
  ];
  return Array.from({ length: STATEMENTS }, (_, index) => {
    const kind = index === 0 ? 0 : index === STATEMENTS - 1 ? 2 : 1;
    return {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      actor: { mbox: "mailto:runner@example.org" },
      verb: { id: verbs[kind] },
      object: { id: "https://example.org/events/relay-2024", definition: { type: `${SPORTS}/activitytypes/event` } },
      ...(kind === 2 ? { result: { extensions: { [`${SPORTS}/extensions/place`]: { rank: 1 } } } } : {}),
      context: {
        registration: "ec231277-b27b-4c15-8291-d29225b2b8f7",
        contextActivities: {
          grouping: [{ id: `${SPORTS}/activities/100mdash`, definition: { type: `${SPORTS}/activitytypes/event` } }],
          category: [{ id: `${SPORTS}/v2` }],
        },
      },
      timestamp: new Date(Date.UTC(2024, 5, 13) + index * 1000).toISOString(),
    };
  });
}

test("reads and judges a profile of 900 more verbs at a small multiple of JSON.parse of its text", async ({
  annotate,
  bench,
}) => {
  const text = largeProfile();
  await annotate(`The profile has ${VERBS + 7} concepts and ${new TextEncoder().encode(text).length} bytes of JSON.`);
  expect(validateProfile(text)).toStrictEqual([]);
  const parse = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const ours = await bench("validateProfile", () => validateProfile(text)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "validateProfile",
    ours,
    { ...parse, name: "JSON.parse" },
    RATIOS.validateProfileAgainstParse,
  );
});

test("reads and judges a profile whose alternates name 40,000 Patterns and that revises 40,000 concepts, at a small multiple of JSON.parse", async ({
  annotate,
  bench,
}) => {
  const { text, other } = wideProfiles();
  // Each text has more tokens and bytes than the default limits, which a host raises for profiles that it trusts.
  const options = { profiles: [other], maxTokens: WIDE_TOKENS, maxBytes: WIDE_BYTES };
  expect(validateProfile(text, options)).toStrictEqual([]);
  const parse = await bench("JSON.parse", () => [JSON.parse(text), JSON.parse(other)]).run(BENCH_OPTIONS);
  const ours = await bench("validateProfile", () => validateProfile(text, options)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "validateProfile of wide profiles",
    ours,
    { ...parse, name: "JSON.parse" },
    RATIOS.wideProfileAgainstParse,
  );
});

test("judges a relay of 1,000 Statements against the Statement Templates, and against the Patterns, at a small multiple of reading them", async ({
  annotate,
  bench,
}) => {
  const statements = relay();
  const validator = createProfileValidator(soundProfile());
  expect(validator.validateStatements(statements).registrations[0]?.outcome).toBe("success");
  const read = await bench("readStatement", () => {
    for (const statement of statements) readStatement(statement);
  }).run(BENCH_OPTIONS);
  const templates = await bench("validateStatement", () => {
    for (const statement of statements) validator.validateStatement(statement);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "validateStatement",
    templates,
    { ...read, name: "readStatement" },
    RATIOS.templatesAgainstRead,
  );
  const patterns = await bench("validateStatements", () => validator.validateStatements(statements)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "validateStatements",
    patterns,
    { ...read, name: "readStatement" },
    RATIOS.patternsAgainstRead,
  );
});
