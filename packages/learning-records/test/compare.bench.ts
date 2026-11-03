import { convertStatementVersion, formatStatement, isSameStatement, readStatement } from "@interopkit/learning-records";
import { expect, test } from "vitest";
import { benchBatch, checkWithLearningLocker } from "./batch.js";
import { BENCH_OPTIONS, expectRatio, RATIOS } from "./budgets.js";

test("compares, converts and formats 1,000 Statements within a few times of checking them", async ({
  annotate,
  bench,
}) => {
  const batch = benchBatch();
  const read = batch.map((entry) => readStatement(entry));
  // The same Statement as an LRS returns it, with the id of the verb in another case of the scheme.
  const again = read.map((statement) => ({
    ...statement,
    verb: { ...statement.verb, id: statement.verb.id.replace("http", "HTTP") },
  }));
  expect(read.every((statement, index) => isSameStatement(statement, again[index] ?? statement))).toBe(true);
  const reference = await bench("Learning Locker", () => checkWithLearningLocker(batch)).run(BENCH_OPTIONS);
  const named = { ...reference, name: "the validator of Learning Locker" };
  const same = await bench("isSameStatement", () => {
    for (const [index, statement] of read.entries()) isSameStatement(statement, again[index] ?? statement);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "isSameStatement", same, named, RATIOS.sameStatementAgainstLearningLocker);
  const converted = await bench("convertStatementVersion", () => {
    for (const statement of read) convertStatementVersion(statement, "1.0.3");
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "convertStatementVersion", converted, named, RATIOS.toVersionAgainstLearningLocker);
  for (const format of ["ids", "canonical"] as const) {
    const formatted = await bench(`formatStatement ${format}`, () => {
      for (const statement of read) formatStatement(statement, format, { languages: ["en-US"] });
    }).run(BENCH_OPTIONS);
    await expectRatio(annotate, `formatStatement ${format}`, formatted, named, RATIOS.formatAgainstLearningLocker);
  }
});
