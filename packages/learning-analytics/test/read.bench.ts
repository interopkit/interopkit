import { readEntity, validateEntity, validateEvent } from "@interopkit/learning-analytics";
import { readEnvelope } from "@interopkit/learning-analytics/endpoint";
import { expect, test } from "vitest";
import { batchOf, envelopeOf, schemaCheck } from "./bench-corpus.js";
import { BENCH_OPTIONS, EVENTS, expectRatio, REFERENCE_OPTIONS, SLOW_REFERENCE_OPTIONS } from "./budgets.js";

test("reads an envelope of 1,000 events of Caliper 1.2 faster than the schemas check them, and judges its events as fast", async ({
  annotate,
  bench,
}) => {
  const accepts = schemaCheck("1.2");
  const batch = batchOf("1.2", "Event", accepts);
  const envelope = envelopeOf("1.2", batch);
  const text = JSON.stringify(envelope);
  await annotate(`The envelope has ${EVENTS} events and ${new TextEncoder().encode(text).length} bytes of JSON.`);
  expect(readEnvelope(envelope).findings.filter(({ severity }) => severity === "error")).toStrictEqual([]);
  expect(batch.every(accepts)).toBe(true);

  const schemas = await bench("draft 4 schemas", () => {
    for (const event of batch) accepts(event);
  }).run(REFERENCE_OPTIONS);
  const parse = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const read = await bench("readEnvelope", () => readEnvelope(envelope)).run(BENCH_OPTIONS);
  await expectRatio(annotate, "readEnvelopeAgainstParse", read, { ...parse, name: "JSON.parse" });
  await expectRatio(annotate, "readEnvelopeAgainstSchemas", read, { ...schemas, name: "the draft 4 schemas" });
  const validate = await bench("validateEvent", () => {
    for (const event of batch) validateEvent(event);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "validateEventAgainstSchemas", validate, { ...schemas, name: "the draft 4 schemas" });
});

test("reads and judges 1,000 entity describes of Caliper 1.2 faster than the schemas check them", async ({
  annotate,
  bench,
}) => {
  const accepts = schemaCheck("1.2");
  const batch = batchOf("1.2", "Entity", accepts);
  await annotate(`The batch has ${EVENTS} entity describes of ${new Set(batch.map(({ type }) => type)).size} classes.`);
  expect(
    batch.flatMap((entity) => validateEntity(entity)).filter(({ severity }) => severity === "error"),
  ).toStrictEqual([]);
  const schemas = await bench("draft 4 schemas", () => {
    for (const entity of batch) accepts(entity);
  }).run(BENCH_OPTIONS);
  const read = await bench("readEntity", () => {
    for (const entity of batch) readEntity(entity);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "readEntityAgainstSchemas", read, { ...schemas, name: "the draft 4 schemas" });
  const validate = await bench("validateEntity", () => {
    for (const entity of batch) validateEntity(entity);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "validateEntityAgainstSchemas", validate, { ...schemas, name: "the draft 4 schemas" });
});

test("reads an envelope of 1,000 events of Caliper 1.1 faster than schema_1_1 checks them", async ({
  annotate,
  bench,
}) => {
  const accepts = schemaCheck("1.1");
  const batch = batchOf("1.1", "Event", accepts);
  const envelope = envelopeOf("1.1", batch);
  const text = JSON.stringify(envelope);
  await annotate(`The envelope has ${EVENTS} events and ${new TextEncoder().encode(text).length} bytes of JSON.`);
  expect(readEnvelope(envelope).findings).toStrictEqual([]);

  const schemas = await bench("schema_1_1", () => {
    for (const event of batch) accepts(event);
  }).run(SLOW_REFERENCE_OPTIONS);
  const parse = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const read = await bench("readEnvelope", () => readEnvelope(envelope)).run(BENCH_OPTIONS);
  await expectRatio(annotate, "readEnvelope11AgainstParse", read, { ...parse, name: "JSON.parse" });
  await expectRatio(annotate, "readEnvelope11AgainstSchemas", read, { ...schemas, name: "schema_1_1" });
});
