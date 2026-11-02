import { resolve } from "node:path";
import { readCredential, validateCredential } from "@interopkit/achievement-credentials";
import { expect, test } from "vitest";
import { readSchema, schemaValidator } from "../../../scripts/schema-oracle.js";
import { clrOf } from "./bench-fixtures.js";
import { alternate, expectRatioWithin } from "./budgets.js";

const ROOT = resolve(import.meta.dirname, "../../..");
test("reads a CLR of 20 credentials as fast as the official JSON schema of CLR 2.0 judges it", async ({
  annotate,
  bench,
}) => {
  const value = JSON.parse(JSON.stringify(clrOf(20)));
  const schema = schemaValidator(readSchema(ROOT, "clr_v2p0_clrcredential_schema.json"), "2019-09");
  expect(schema(value)).toBe(true);
  expect(validateCredential(value).filter(({ severity }) => severity === "error")).toStrictEqual([]);
  const reference = { name: "the official schema with @cfworker/json-schema", run: () => schema(value) };
  const reading = await alternate(bench, "readCredential", () => readCredential(value), reference);
  await expectRatioWithin(annotate, "readCredential", "the official schema", reading);
  const validating = await alternate(bench, "validateCredential", () => validateCredential(value), reference);
  await expectRatioWithin(annotate, "validateCredential", "the official schema", validating);
});
