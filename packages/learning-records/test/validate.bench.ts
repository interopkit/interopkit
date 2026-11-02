import { readStatementJson, validateStatement, validateStatements } from "@interopkit/learning-records";
import learningLocker from "@learninglocker/xapi-validation";
import { expect, test } from "vitest";
import { BENCH_OPTIONS, BUDGETS, expectRatio, expectWithin, RATIOS, STATEMENTS } from "./budgets.js";

/** The validator of Learning Locker: the package is CommonJS, so Node gives its `exports` and a bundler gives the function. */
const imported = learningLocker as unknown as
  | ((data: unknown) => readonly unknown[])
  | { readonly default: (data: unknown) => readonly unknown[] };
const validateWithLearningLocker = typeof imported === "function" ? imported : imported.default;

/** A Statement that xAPI 1.0.3 and 2.0 both take: an actor, a verb with its display, an Activity with a definition, a result, a context. */
function statement(n: number): Record<string, unknown> {
  const id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  return {
    id,
    actor: { objectType: "Agent", name: `Learner ${n}`, mbox: `mailto:learner${n}@example.org` },
    verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: { "en-US": "completed" } },
    object: {
      objectType: "Activity",
      id: `https://example.org/activities/course-${n % 50}`,
      definition: {
        name: { "en-US": `Course ${n % 50}` },
        description: { "en-US": "A course of the catalog." },
        type: "http://adlnet.gov/expapi/activities/course",
      },
    },
    result: { score: { scaled: 0.8, raw: 80, min: 0, max: 100 }, success: true, completion: true, duration: "PT1H30M" },
    context: {
      registration: `00000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`,
      contextActivities: { parent: [{ id: "https://example.org/programs/stats" }] },
      language: "en-US",
    },
    timestamp: "2024-06-13T18:46:03.250Z",
  };
}

test("checks a batch of 1,000 Statements as fast as the validator of Learning Locker, and reads its text near JSON.parse", async ({
  annotate,
  bench,
}) => {
  const batch = Array.from({ length: STATEMENTS }, (_, index) => statement(index + 1));
  const text = JSON.stringify(batch);
  await annotate(`The batch has ${STATEMENTS} Statements and ${new TextEncoder().encode(text).length} bytes of JSON.`);
  expect(batch.flatMap((entry) => validateWithLearningLocker(entry))).toStrictEqual([]);
  expect(validateStatements(batch)).toStrictEqual([]);

  const reference = await bench("Learning Locker", () => {
    for (const entry of batch) validateWithLearningLocker(entry);
  }).run(BENCH_OPTIONS);
  const ours = await bench("validateStatement", () => {
    for (const entry of batch) validateStatement(entry);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "validateStatement",
    ours,
    { ...reference, name: "the validator of Learning Locker" },
    RATIOS.validateAgainstLearningLocker,
  );
  await expectWithin(annotate, "validateStatement", ours, BUDGETS.validateStatement);

  const parse = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const read = await bench("readStatementJson", () => readStatementJson(text)).run(BENCH_OPTIONS);
  await expectRatio(annotate, "readStatementJson", read, { ...parse, name: "JSON.parse" }, RATIOS.readJsonAgainstParse);
  await expectWithin(annotate, "readStatementJson", read, BUDGETS.readStatementJson);
});
