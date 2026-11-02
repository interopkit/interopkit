import { type CFDocument, readEntity, readPackage, validatePackage } from "@interopkit/competency-frameworks";
import { frameworkTree } from "@interopkit/competency-frameworks/graph";
import { queryEntities } from "@interopkit/competency-frameworks/provider";
import { expect, test } from "vitest";
import { framework } from "./bank.js";
import { BENCH_OPTIONS, BUDGETS, expectRatio, expectWithin, ITEMS, RATIOS, SLOW_REFERENCE_OPTIONS } from "./budgets.js";
import { officialValidator } from "./official.js";

test("reads, validates and walks a framework of 10,000 items", async ({ annotate, bench }) => {
  const parsed = JSON.parse(JSON.stringify(framework(ITEMS)));
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).length;
  await annotate(
    `The framework has ${ITEMS} items, ${parsed.CFAssociations.length} associations and ${bytes} bytes of JSON.`,
  );
  expect(validatePackage(parsed)).toStrictEqual([]);

  const text = JSON.stringify(parsed);
  const reference = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const named = { ...reference, name: "JSON.parse" };
  const read = await bench("readPackage", () => readPackage(parsed)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "readPackage", read, BUDGETS.readPackage);
  await expectRatio(annotate, "readPackage", read, named, RATIOS.readPackageAgainstParse);

  const validate = await bench("validatePackage", () => validatePackage(parsed)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "validatePackage", validate, BUDGETS.validatePackage);

  const pkg = readPackage(parsed);
  expect(frameworkTree(pkg)).toHaveLength(10);
  const tree = await bench("frameworkTree", () => frameworkTree(pkg)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "frameworkTree", tree, BUDGETS.frameworkTree);
  await expectRatio(annotate, "frameworkTree", tree, named, RATIOS.frameworkTreeAgainstParse);
});

test("reads a framework of 10,000 items, and 10,000 items alone, faster than the official schemas of CASE 1.1 check them", async ({
  annotate,
  bench,
}) => {
  const parsed = JSON.parse(JSON.stringify(framework(ITEMS)));
  const schema = officialValidator("1.1", "package");
  expect(schema(parsed)).toBe(true);
  const official = await bench("the package schema", () => schema(parsed)).run(SLOW_REFERENCE_OPTIONS);
  const read = await bench("readPackage", () => readPackage(parsed)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "readPackage",
    read,
    { ...official, name: "the package schema of CASE 1.1" },
    RATIOS.readPackageAgainstSchema,
  );

  // Each item as a provider answers it alone: with the link to its document.
  const { identifier, uri, title } = parsed.CFDocument;
  const items = parsed.CFItems.map((item: Record<string, unknown>) => ({
    ...item,
    CFDocumentURI: { title, identifier, uri },
  }));
  const itemSchema = officialValidator("1.1", "CFItem");
  expect(items.every(itemSchema)).toBe(true);
  const officialItems = await bench("the item schema", () => {
    for (const item of items) itemSchema(item);
  }).run(SLOW_REFERENCE_OPTIONS);
  const readItems = await bench("readEntity", () => {
    for (const item of items) readEntity("CFItem", item);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "readEntity",
    readItems,
    { ...officialItems, name: "the item schema of CASE 1.1" },
    RATIOS.readEntityAgainstSchema,
  );
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
