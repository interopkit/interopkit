import { type CFDocument, readPackage, validatePackage } from "@interopkit/competency-frameworks";
import { frameworkTree } from "@interopkit/competency-frameworks/graph";
import { queryEntities } from "@interopkit/competency-frameworks/provider";
import { expect, test } from "vitest";
import { framework } from "./bank.js";
import { BENCH_OPTIONS, BUDGETS, expectWithin, ITEMS, READ_RATIO } from "./budgets.js";

test("reads, validates and walks a framework of 10,000 items", async ({ annotate, bench }) => {
  const parsed = JSON.parse(JSON.stringify(framework(ITEMS)));
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).length;
  await annotate(
    `The framework has ${ITEMS} items, ${parsed.CFAssociations.length} associations and ${bytes} bytes of JSON.`,
  );
  expect(validatePackage(parsed)).toStrictEqual([]);

  const text = JSON.stringify(parsed);
  const reference = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const read = await bench("readPackage", () => readPackage(parsed)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "readPackage", read, BUDGETS.readPackage);
  const ratio = read.latency.min / reference.latency.min;
  await annotate(
    `JSON.parse of the same framework: fastest ${reference.latency.min.toFixed(2)} ms; readPackage is ${ratio.toFixed(2)} times that, budget ${READ_RATIO}`,
  );
  expect(ratio, "The fastest sample of readPackage as a multiple of the fastest sample of JSON.parse").toBeLessThan(
    READ_RATIO,
  );

  const validate = await bench("validatePackage", () => validatePackage(parsed)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "validatePackage", validate, BUDGETS.validatePackage);

  const pkg = readPackage(parsed);
  expect(frameworkTree(pkg)).toHaveLength(10);
  const tree = await bench("frameworkTree", () => frameworkTree(pkg)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "frameworkTree", tree, BUDGETS.frameworkTree);
});

test("filters and sorts 10,000 documents", async ({ annotate, bench }) => {
  const documents: CFDocument[] = Array.from({ length: ITEMS }, (_, index) => {
    const identifier = `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
    const title = `Framework ${(index * 7919) % ITEMS}`;
    return {
      identifier,
      uri: `https://case.example.org/ims/case/v1p1/CFDocuments/${identifier}`,
      CFPackageURI: { title, identifier, uri: `https://case.example.org/ims/case/v1p1/CFPackages/${identifier}` },
      creator: index % 3 === 0 ? "Ministry of Education" : "District",
      title,
      lastChangeDateTime: "2024-06-13T18:46:03+00:00",
    };
  });
  const query = {
    filter: { field: "creator", predicate: "=", value: "Ministry of Education" },
    sort: "title",
  } as const;
  expect(queryEntities(documents, query)).toHaveLength(Math.ceil(ITEMS / 3));
  const result = await bench("queryEntities", () => queryEntities(documents, query)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "queryEntities", result, BUDGETS.queryDocuments);
});
