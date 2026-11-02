import { readPackage } from "@interopkit/competency-frameworks";
import { createCaseClient } from "@interopkit/competency-frameworks/client";
import { type FrameworkStore, handleCaseRequest } from "@interopkit/competency-frameworks/provider";
import type { HttpRequest } from "@interopkit/core/http";
import { expect, test } from "vitest";
import { framework } from "./bank.js";
import { BENCH_OPTIONS, expectRatio, ITEMS, RATIOS } from "./budgets.js";

const ORIGIN = "https://case.example.org";

/** A request of a consumer for a path of the provider. */
const requestOf = (path: string): HttpRequest => ({
  method: "GET",
  url: `${ORIGIN}${path}`,
  headers: { accept: "application/json" },
  body: new Uint8Array(),
});

test("serves a framework of 10,000 items in both versions, and a client reads it, within a few times of its JSON", async ({
  annotate,
  bench,
}) => {
  const pkg = readPackage(JSON.parse(JSON.stringify(framework(ITEMS))));
  const key = pkg.CFDocument.identifier;
  const missing = async () => undefined;
  const store: FrameworkStore = {
    documents: async () => ({ documents: [], total: 0 }),
    document: missing,
    package: async (asked) => (asked === key ? pkg : undefined),
    item: missing,
    itemAssociations: missing,
    association: missing,
    associationGrouping: missing,
    concept: missing,
    subject: missing,
    license: missing,
    itemType: missing,
    rubric: missing,
  };
  const options = {
    store,
    versions: ["1.1", "1.0"] as const,
    discovery: { openapi: "3.0.0", info: { title: "CASE", version: "1.1" }, paths: {} },
  };
  const served = await handleCaseRequest(requestOf(`/ims/case/v1p1/CFPackages/${key}`), options);
  expect(served.status).toBe(200);
  expect((await handleCaseRequest(requestOf(`/ims/case/v1p0/CFPackages/${key}`), options)).status).toBe(200);
  const text = typeof served.body === "string" ? served.body : new TextDecoder().decode(served.body);
  await annotate(`The answer has ${new TextEncoder().encode(text).length} bytes.`);

  const stringify = await bench("JSON.stringify", () => JSON.stringify(pkg)).run(BENCH_OPTIONS);
  const named = { ...stringify, name: "JSON.stringify of the framework" };
  for (const [version, budget] of [
    ["v1p1", RATIOS.serve11AgainstStringify],
    ["v1p0", RATIOS.serve10AgainstStringify],
  ] as const) {
    const answered = await bench(`handleCaseRequest ${version}`, async () => {
      await handleCaseRequest(requestOf(`/ims/case/${version}/CFPackages/${key}`), options);
    }).run(BENCH_OPTIONS);
    await expectRatio(annotate, `handleCaseRequest ${version}`, answered, named, budget);
  }

  const client = createCaseClient({
    baseUrl: ORIGIN,
    fetch: async () => new Response(text, { status: 200, headers: { "content-type": "application/json" } }),
    maxBytes: 16_777_216,
  });
  expect((await client.package(key))?.CFItems).toHaveLength(ITEMS);
  const parse = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const fetched = await bench("client.package", async () => {
    await client.package(key);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "client.package",
    fetched,
    { ...parse, name: "JSON.parse of the answer" },
    RATIOS.clientAgainstParse,
  );
});
