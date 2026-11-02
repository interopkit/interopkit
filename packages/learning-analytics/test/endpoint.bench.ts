import { type CaliperEndpointOptions, handleCaliperRequest } from "@interopkit/learning-analytics/endpoint";
import { expect, test } from "vitest";
import { batchOf, envelopeOf, schemaCheck } from "./bench-corpus.js";
import { BENCH_OPTIONS, EVENTS, expectRatio } from "./budgets.js";

test("receives an envelope of 1,000 events of Caliper 1.2 faster than the schemas check them", async ({
  annotate,
  bench,
}) => {
  const accepts = schemaCheck("1.2");
  const batch = batchOf("1.2", "Event", accepts);
  const text = JSON.stringify(envelopeOf("1.2", batch));
  const body = new TextEncoder().encode(text);
  const request = {
    method: "POST",
    url: "https://lrs.example/caliper",
    headers: { "content-type": "application/json", authorization: "Bearer token-123" },
    body,
  };
  let received = 0;
  const options: CaliperEndpointOptions = {
    // The envelope has 1.4 MiB, above the 1 MiB that an endpoint takes unless its host says more.
    maxPayloadBytes: 2_097_152,
    authorize: async () => ({ principal: "tool-7" }),
    accept: async (envelope) => {
      received = envelope.data.length;
    },
  };
  expect((await handleCaliperRequest(request, options)).status).toBe(200);
  expect(received).toBe(EVENTS);

  const schemas = await bench("draft 4 schemas", () => {
    for (const event of batch) accepts(event);
  }).run(BENCH_OPTIONS);
  const parse = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const handled = await bench("handleCaliperRequest", async () => {
    await handleCaliperRequest(request, options);
  }).run(BENCH_OPTIONS);
  await expectRatio(annotate, "handleRequestAgainstParse", handled, { ...parse, name: "JSON.parse" });
  await expectRatio(annotate, "handleRequestAgainstSchemas", handled, { ...schemas, name: "the draft 4 schemas" });
});
