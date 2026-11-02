import learningLocker from "@learninglocker/xapi-validation";
import type { StatementInput } from "../src/index.js";
import { STATEMENTS } from "./budgets.js";

/** The validator of Learning Locker: the package is CommonJS, so Node gives its `exports` and a bundler gives the function. */
const imported = learningLocker as unknown as
  | ((data: unknown) => readonly unknown[])
  | { readonly default: (data: unknown) => readonly unknown[] };

/** Checks a Statement with the validator of Learning Locker, and returns its errors. */
export const validateWithLearningLocker = typeof imported === "function" ? imported : imported.default;

/** A Statement that xAPI 1.0.3 and 2.0 both take: an actor, a verb with its display, an Activity with a definition, a result, a context. */
export function benchStatement(n: number): StatementInput {
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

/** The batch of the benchmarks: as many Statements as an LRS takes in one request, each with its own id. */
export function benchBatch(): StatementInput[] {
  return Array.from({ length: STATEMENTS }, (_, index) => benchStatement(index + 1));
}

/** Checks every Statement of a batch with the validator of Learning Locker: the reference of the work on each Statement. */
export function checkWithLearningLocker(batch: readonly unknown[]): void {
  for (const entry of batch) validateWithLearningLocker(entry);
}
