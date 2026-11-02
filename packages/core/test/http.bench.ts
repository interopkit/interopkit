import { type HttpRequest, readForm, readJson } from "@interopkit/core/http";
import { expect, test } from "vitest";
import { alternate, expectRatioWithin } from "./budgets.js";

/** The bytes of the bodies of the benchmark: the default limit of `readJson`. */
const BODY_BYTES = 1_048_576;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A request with a body. */
const requestOf = (body: string, type: string): HttpRequest => ({
  method: "POST",
  url: "https://provider.example/endpoint",
  headers: { "content-type": type },
  body: encoder.encode(body),
});

/** A JSON body near the limit: records of a learner with a name, a score and a time, as a batch of results holds them. */
function jsonBody(): string {
  const record = (index: number) =>
    JSON.stringify({
      id: `urn:uuid:${index}`,
      name: `Learner ${index}`,
      score: index % 100,
      at: "2026-11-01T00:00:00Z",
    });
  const records: string[] = [];
  let size = 2;
  for (let index = 0; size + 120 < BODY_BYTES; index += 1) {
    const next = record(index);
    records.push(next);
    size += next.length + 1;
  }
  return `[${records.join(",")}]`;
}

test("reads a JSON body of 1 MiB near TextDecoder and JSON.parse, and a form near URLSearchParams", async ({
  annotate,
  bench,
}) => {
  const json = requestOf(jsonBody(), "application/json");
  expect(readJson(json)).toStrictEqual(JSON.parse(decoder.decode(json.body)));
  const reading = await alternate(bench, "readJson", () => readJson(json), {
    name: "TextDecoder and JSON.parse",
    run: () => JSON.parse(decoder.decode(json.body)),
  });
  await expectRatioWithin(annotate, "readJson", "TextDecoder and JSON.parse", reading);

  const pairs = Array.from({ length: 2000 }, (_, index) => `field${index}=value+${index}%21`).join("&");
  const form = requestOf(pairs, "application/x-www-form-urlencoded");
  expect(readForm(form).get("field7")).toBe("value 7!");
  const forms = await alternate(bench, "readForm", () => readForm(form), {
    name: "URLSearchParams",
    run: () => new Map(new URLSearchParams(decoder.decode(form.body))),
  });
  await expectRatioWithin(annotate, "readForm", "URLSearchParams", forms);
});
