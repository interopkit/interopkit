import { parseStatementJson, readStatement, validateStatement, validateStatements } from "@interopkit/learning-records";
import { expect, test } from "vitest";
import { benchBatch, checkWithLearningLocker, validateWithLearningLocker } from "./batch.js";
import { BENCH_OPTIONS, BUDGETS, expectRatio, expectWithin, RATIOS, STATEMENTS } from "./budgets.js";

test("checks a batch of 1,000 Statements as fast as the validator of Learning Locker, and reads its text near JSON.parse", async ({
  annotate,
  bench,
}) => {
  const batch = benchBatch();
  const text = JSON.stringify(batch);
  await annotate(`The batch has ${STATEMENTS} Statements and ${new TextEncoder().encode(text).length} bytes of JSON.`);
  expect(batch.flatMap((entry) => validateWithLearningLocker(entry))).toStrictEqual([]);
  expect(validateStatements(batch)).toStrictEqual([]);

  const reference = await bench("Learning Locker", () => checkWithLearningLocker(batch)).run(BENCH_OPTIONS);
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
  const read = await bench("parseStatementJson", () => parseStatementJson(text)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "parseStatementJson",
    read,
    { ...parse, name: "JSON.parse" },
    RATIOS.parseJsonAgainstParse,
  );
  await expectWithin(annotate, "parseStatementJson", read, BUDGETS.parseStatementJson);
});

test("reads a batch of 1,000 Statements, and checks it as a whole, as fast as the validator of Learning Locker checks them", async ({
  annotate,
  bench,
}) => {
  const batch = benchBatch();
  const reference = await bench("Learning Locker", () => checkWithLearningLocker(batch)).run(BENCH_OPTIONS);
  const read = await bench("readStatement", () => {
    for (const entry of batch) readStatement(entry);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "readStatement",
    read,
    { ...reference, name: "the validator of Learning Locker" },
    RATIOS.readAgainstLearningLocker,
  );
  const whole = await bench("validateStatements", () => validateStatements(batch)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "validateStatements",
    whole,
    { ...reference, name: "the validator of Learning Locker" },
    RATIOS.validateBatchAgainstLearningLocker,
  );
});
