import { createHash } from "node:crypto";
import { buildStatement, deriveStatementId, mboxSha1sum } from "@interopkit/learning-records";
import { expect, test } from "vitest";
import { benchBatch, checkWithLearningLocker } from "./batch.js";
import { BENCH_OPTIONS, expectRatio, RATIOS, STATEMENTS } from "./budgets.js";

/** The namespace of the ids that the benchmark derives. */
const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

test("builds 1,000 Statements as fast as the validator of Learning Locker checks them", async ({ annotate, bench }) => {
  const batch = benchBatch();
  expect(batch.map((entry) => buildStatement(entry).id)).toStrictEqual(batch.map(({ id }) => id));
  const reference = await bench("Learning Locker", () => checkWithLearningLocker(batch)).run(BENCH_OPTIONS);
  const built = await bench("buildStatement", () => {
    for (const entry of batch) buildStatement(entry);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "buildStatement",
    built,
    { ...reference, name: "the validator of Learning Locker" },
    RATIOS.buildAgainstLearningLocker,
  );
});

test("hashes 1,000 mailto IRIs and derives 1,000 ids near the SHA-1 of node:crypto", async ({ annotate, bench }) => {
  const mailboxes = Array.from({ length: STATEMENTS }, (_, index) => `mailto:learner${index}@example.org`);
  const names = mailboxes.map((mailbox) => `${mailbox} completed https://example.org/activities/course-1`);
  expect(mboxSha1sum(mailboxes[0] ?? "")).toBe(
    createHash("sha1")
      .update(mailboxes[0] ?? "")
      .digest("hex"),
  );
  const native = await bench("node:crypto SHA-1", () => {
    for (const mailbox of mailboxes) createHash("sha1").update(mailbox).digest("hex");
  }).run(BENCH_OPTIONS);
  const hashed = await bench("mboxSha1sum", () => {
    for (const mailbox of mailboxes) mboxSha1sum(mailbox);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "mboxSha1sum",
    hashed,
    { ...native, name: "the SHA-1 of node:crypto" },
    RATIOS.mboxSha1sumAgainstNative,
  );
  const derived = await bench("deriveStatementId", () => {
    for (const name of names) deriveStatementId(NAMESPACE, name);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "deriveStatementId",
    derived,
    { ...native, name: "the SHA-1 of node:crypto" },
    RATIOS.deriveIdAgainstNative,
  );
});
