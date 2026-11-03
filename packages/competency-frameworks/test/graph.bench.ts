import { type CasePackage, convertCaseVersion, readPackage } from "@interopkit/competency-frameworks";
import { crosswalk, diffPackages, listAssociations } from "@interopkit/competency-frameworks/graph";
import { expect, test } from "vitest";
import { framework } from "./bank.js";
import { BENCH_OPTIONS, expectRatio, ITEMS, RATIOS } from "./budgets.js";

/** The framework that the `exactMatchOf` associations of the bank point to: an item for each of their destinations. */
function matched(pkg: CasePackage): CasePackage {
  const destinations = (pkg.CFAssociations ?? [])
    .filter(({ associationType }) => associationType === "exactMatchOf")
    .map(({ destinationNodeURI }) => destinationNodeURI);
  return {
    CFDocument: {
      identifier: "00000000-0000-4000-8000-0000000f4240",
      uri: "https://standards.example.org/ims/case/v1p1/CFDocuments/00000000-0000-4000-8000-0000000f4240",
      creator: "Standards Board",
      title: "Other",
      lastChangeDateTime: "2024-06-13T18:46:03+00:00",
    },
    CFItems: destinations.map(({ identifier, uri }) => ({
      identifier,
      uri,
      fullStatement: "A standard of another framework.",
      lastChangeDateTime: "2024-06-13T18:46:03+00:00",
    })),
  };
}

/** The framework with every tenth item edited: another statement and a later change. */
function edited(pkg: CasePackage): CasePackage {
  return {
    ...pkg,
    CFItems: (pkg.CFItems ?? []).map((item, index) =>
      index % 10 === 0
        ? { ...item, fullStatement: `${item.fullStatement} Again.`, lastChangeDateTime: "2025-01-01T00:00:00+00:00" }
        : item,
    ),
  };
}

test("converts, compares and crosswalks a framework of 10,000 items within a few times of JSON.parse", async ({
  annotate,
  bench,
}) => {
  const pkg = readPackage(JSON.parse(JSON.stringify(framework(ITEMS))));
  const other = readPackage(matched(pkg));
  const later = edited(pkg);
  const text = JSON.stringify(pkg);
  expect(crosswalk(pkg, other)).toHaveLength(ITEMS / 50);
  expect(diffPackages(pkg, later).changed).toHaveLength(ITEMS / 10);
  expect(convertCaseVersion(pkg, "1.0").dropped).toStrictEqual([]);
  const first = pkg.CFItems?.[0]?.identifier ?? "";
  expect(listAssociations(pkg, first).origin).toHaveLength(2);

  const reference = await bench("JSON.parse", () => JSON.parse(text)).run(BENCH_OPTIONS);
  const named = { ...reference, name: "JSON.parse" };
  const converted = await bench("convertCaseVersion", () => convertCaseVersion(pkg, "1.0")).run(BENCH_OPTIONS);
  await expectRatio(annotate, "convertCaseVersion", converted, named, RATIOS.toCaseVersionAgainstParse);
  const diffed = await bench("diffPackages", () => diffPackages(pkg, later)).run(BENCH_OPTIONS);
  await expectRatio(annotate, "diffPackages", diffed, named, RATIOS.diffPackagesAgainstParse);
  const walked = await bench("crosswalk", () => crosswalk(pkg, other)).run(BENCH_OPTIONS);
  await expectRatio(annotate, "crosswalk", walked, named, RATIOS.crosswalkAgainstParse);
  const associations = await bench("listAssociations", () => listAssociations(pkg, first)).run(BENCH_OPTIONS);
  await expectRatio(annotate, "listAssociations", associations, named, RATIOS.associationsOfAgainstParse);
});
