import { buildEntity, buildEvent, type CaliperEvent, sendCaliper } from "@interopkit/learning-analytics";
import { expect, test } from "vitest";
import { batchOf, schemaCheck } from "./bench-corpus.js";
import { BENCH_OPTIONS, EVENTS, expectRatio } from "./budgets.js";

/** A document without its `@context`: the input of a builder, which adds it. */
function inputOf(document: Record<string, unknown>): Record<string, unknown> {
  const { "@context": _context, ...input } = document;
  return input;
}

/** Tells whether a builder takes an input. */
function builds(build: () => unknown): boolean {
  try {
    build();
    return true;
  } catch {
    return false;
  }
}

test("builds 1,000 events and 1,000 entity describes of Caliper 1.2 faster than the schemas check them", async ({
  annotate,
  bench,
}) => {
  const accepts = schemaCheck("1.2");
  const events = batchOf("1.2", "Event", accepts)
    .map(inputOf)
    .filter((input) => builds(() => buildEvent(input as never)));
  const entities = batchOf("1.2", "Entity", accepts)
    .map(inputOf)
    .filter((input) => builds(() => buildEntity(input as never)));
  await annotate(`The batches have ${events.length} events and ${entities.length} entities that the builders take.`);
  expect(events.length).toBeGreaterThan(EVENTS / 2);
  const built = events.map((input) => buildEvent(input as never));
  expect(built.every(accepts)).toBe(true);

  const eventSchemas = await bench("draft 4 schemas of the events", () => {
    for (const event of built) accepts(event);
  }).run(BENCH_OPTIONS);
  const buildEvents = await bench("buildEvent", () => {
    for (const input of events) buildEvent(input as never);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "buildEventAgainstSchemas", buildEvents, {
    ...eventSchemas,
    name: "the draft 4 schemas",
  });

  const describes = entities.map((input) => buildEntity(input as never));
  const entitySchemas = await bench("draft 4 schemas of the entities", () => {
    for (const entity of describes) accepts(entity);
  }).run(BENCH_OPTIONS);
  const buildEntities = await bench("buildEntity", () => {
    for (const input of entities) buildEntity(input as never);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "buildEntityAgainstSchemas", buildEntities, {
    ...entitySchemas,
    name: "the draft 4 schemas",
  });
});

test("sends an envelope of 1,000 events within a few times of its JSON", async ({ annotate, bench }) => {
  const accepts = schemaCheck("1.2");
  const data: CaliperEvent[] = batchOf("1.2", "Event", accepts)
    .map(inputOf)
    .filter((input) => builds(() => buildEvent(input as never)))
    .map((input) => buildEvent(input as never));
  const answered = new Response(null, { status: 200 });
  const options = {
    endpoint: "https://lrs.example/caliper",
    token: "token-123",
    sensor: "https://exam.example/sensors/1",
    sendTime: 1_700_000_000_000,
    maxPayloadBytes: 10_485_760,
    fetch: async () => answered.clone(),
  };
  await sendCaliper(data, options);
  const json = await bench("JSON.stringify", () =>
    JSON.stringify({ sensor: options.sensor, sendTime: "2023-11-14T22:13:20.000Z", dataVersion: "v", data }),
  ).run(BENCH_OPTIONS);
  const sent = await bench("sendCaliper", async () => {
    await sendCaliper(data, options);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "sendCaliperAgainstStringify", sent, { ...json, name: "JSON.stringify of the envelope" });
});
