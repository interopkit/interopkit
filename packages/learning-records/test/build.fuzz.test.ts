import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutate, mutations } from "../../../scripts/json-mutation.js";
import {
  buildStatement,
  buildVoidingStatement,
  deriveStatementId,
  formatDuration,
  formatTimestamp,
  isDuration,
  mboxSha1sum,
  parseDuration,
  readStatement,
  type StatementInput,
} from "../src/index.js";
import { providerStatement } from "./full-statement.js";
import { anything, RUNS, returnsOrRefuses, STRINGS } from "./fuzz.js";

/** The input of a builder as JSON, which the mutations of the properties change. */
const INPUTS = fc.constant(null).map(() => {
  const { id, actor, verb, object, result, context, attachments } = providerStatement();
  return JSON.parse(
    JSON.stringify({ id, actor, verb, object, timestamp: "2024-06-13T18:46:03Z", result, context, attachments }),
  );
});

describe("the builders and the data types on any value", () => {
  it("build a Statement or refuse with a DataError, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, anything, (value, other) => {
        returnsOrRefuses(() => buildStatement(value as StatementInput));
        returnsOrRefuses(() => buildVoidingStatement(other as string, value as never));
        returnsOrRefuses(() => deriveStatementId(value as string, other as string));
        returnsOrRefuses(() => mboxSha1sum(value as string));
        returnsOrRefuses(() => formatDuration(value as number));
        returnsOrRefuses(() => formatTimestamp(value as number));
      }),
      RUNS,
    );
  });

  it("build a Statement that a reader reads as itself exactly when the input has no error", () => {
    fc.assert(
      fc.property(INPUTS, mutations, (input, mutation) => {
        const changed = mutate(input, mutation, STRINGS) as StatementInput;
        let built: ReturnType<typeof buildStatement> | undefined;
        returnsOrRefuses(() => {
          built = buildStatement(changed);
        });
        if (built !== undefined) expect(readStatement(built, { role: "provider" })).toStrictEqual(built);
      }),
      RUNS,
    );
  });

  it("read a duration that a duration is written as, for any text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        if (!isDuration(text)) {
          expect(() => parseDuration(text)).toThrow(DataError);
          return;
        }
        for (const number of Object.values(parseDuration(text)))
          expect(Number.isFinite(number) && number >= 0).toBe(true);
      }),
      RUNS,
    );
  });
});
