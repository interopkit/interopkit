import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildEvent,
  CALIPER_1_1_CONTEXT,
  CALIPER_CONTEXT,
  type CaliperVersion,
  readEvent,
  validateEvent,
} from "@interopkit/learning-analytics";
import { readEnvelope } from "@interopkit/learning-analytics/endpoint";
import { expect, test } from "vitest";
import { readSchemaSet, schemaSetValidator } from "../../../scripts/schema-oracle.js";
import { BENCH_OPTIONS, EVENTS, expectRatio, SLOW_REFERENCE_OPTIONS } from "./budgets.js";

/** The `caliper-spec` repository at the pinned commit, which `pnpm corpus` downloads. */
const CALIPER_SPEC = resolve(import.meta.dirname, "../../../.cache/corpus/caliper-spec");

/** The fixtures of the events that `caliper-spec` shows for a version, parsed. */
function fixtureEvents(version: CaliperVersion): Record<string, unknown>[] {
  const directory = join(CALIPER_SPEC, "fixtures", version === "1.2" ? "v1p2" : "v1p1");
  return readdirSync(directory)
    .filter((name) => name.startsWith("caliperEvent") && name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")));
}

/** The identifier of the event at an index: a UUID URN that no other event of the batch has. */
const idAt = (index: number): string => `urn:uuid:3a648e68-f00d-4c08-aa59-${index.toString(16).padStart(12, "0")}`;

/** The draft 4 schemas of a version in `caliper-spec`, as a function that tells whether an event is valid by the schema of its type. */
function schemaCheck(version: CaliperVersion): (event: Record<string, unknown>) => boolean {
  const set = readSchemaSet(join(CALIPER_SPEC, "json_schema", version === "1.2" ? "schema_1_2" : "schema_1_1"));
  const validators = new Map<string, (value: unknown) => boolean>();
  return (event) => {
    const type = String(event.type);
    let validator = validators.get(type);
    if (validator === undefined) {
      validator = schemaSetValidator(set, type, "4");
      validators.set(type, validator);
    }
    return validator(event);
  };
}

/** A batch of events that the schemas of the version and the readers all take, one fixture after another with its own identifier. */
function batchOf(
  version: CaliperVersion,
  accepts: (event: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const fixtures = fixtureEvents(version).filter((event) => {
    try {
      readEvent(event, { version });
      return accepts(event);
    } catch {
      return false;
    }
  });
  expect(fixtures.length).toBeGreaterThan(20);
  return Array.from({ length: EVENTS }, (_, index) => ({ ...fixtures[index % fixtures.length], id: idAt(index) }));
}

/** The envelope that a sensor of a version sends with a batch of events. */
const envelopeOf = (version: CaliperVersion, data: readonly unknown[]): Record<string, unknown> => ({
  sensor: "https://exam.example/sensors/1",
  sendTime: "2023-11-14T22:13:20.000Z",
  dataVersion: version === "1.2" ? CALIPER_CONTEXT : CALIPER_1_1_CONTEXT,
  data,
});

test("reads an envelope of 1,000 events of Caliper 1.2 faster than the schemas check them, and judges its events as fast", async ({
  annotate,
  bench,
}) => {
  const accepts = schemaCheck("1.2");
  const batch = batchOf("1.2", accepts);
  const envelope = envelopeOf("1.2", batch);
  const text = JSON.stringify(envelope);
  await annotate(`The envelope has ${EVENTS} events and ${new TextEncoder().encode(text).length} bytes of JSON.`);
  expect(readEnvelope(envelope, "tool-7").findings.filter(({ severity }) => severity === "error")).toStrictEqual([]);
  expect(batch.every(accepts)).toBe(true);

  const schemas = await bench("draft 4 schemas", () => {
    for (const event of batch) accepts(event);
  }).run(BENCH_OPTIONS);
  const parse = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const read = await bench("readEnvelope", () => readEnvelope(envelope, "tool-7")).run(BENCH_OPTIONS);
  await expectRatio(annotate, "readEnvelopeAgainstParse", read, { ...parse, name: "JSON.parse" });
  await expectRatio(annotate, "readEnvelopeAgainstSchemas", read, { ...schemas, name: "the draft 4 schemas" });
  const validate = await bench("validateEvent", () => {
    for (const event of batch) validateEvent(event);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "validateEventAgainstSchemas", validate, { ...schemas, name: "the draft 4 schemas" });
});

test("reads an envelope of 1,000 events of Caliper 1.1 faster than schema_1_1 checks them", async ({
  annotate,
  bench,
}) => {
  const accepts = schemaCheck("1.1");
  const batch = batchOf("1.1", accepts);
  const envelope = envelopeOf("1.1", batch);
  const text = JSON.stringify(envelope);
  await annotate(`The envelope has ${EVENTS} events and ${new TextEncoder().encode(text).length} bytes of JSON.`);
  expect(readEnvelope(envelope, "tool-7").findings).toStrictEqual([]);

  const schemas = await bench("schema_1_1", () => {
    for (const event of batch) accepts(event);
  }).run(SLOW_REFERENCE_OPTIONS);
  const parse = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const read = await bench("readEnvelope", () => readEnvelope(envelope, "tool-7")).run(BENCH_OPTIONS);
  await expectRatio(annotate, "readEnvelope11AgainstParse", read, { ...parse, name: "JSON.parse" });
  await expectRatio(annotate, "readEnvelope11AgainstSchemas", read, { ...schemas, name: "schema_1_1" });
});

test("builds 1,000 events and reports the time, whose budget waits for the first sample of the runners of CI", async ({
  annotate,
  bench,
}) => {
  const [fixture] = fixtureEvents("1.2").filter((event) => event.type === "AssessmentEvent");
  const { "@context": _context, ...input } = fixture ?? {};
  const build = () => buildEvent(input as never);
  expect(build()["@context"]).toBe(CALIPER_CONTEXT);
  const built = await bench("buildEvent", () => {
    for (let index = 0; index < EVENTS; index += 1) build();
  }).run(BENCH_OPTIONS);
  await annotate(
    `buildEvent of ${EVENTS} events: fastest ${built.latency.min.toFixed(2)} ms, median ${built.latency.p50.toFixed(2)} ms`,
  );
});
