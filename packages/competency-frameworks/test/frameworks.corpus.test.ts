import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { diffPackages, frameworkTree } from "../src/graph/index.js";
import { type CasePackage, readPackage, toCaseVersion, validatePackage } from "../src/index.js";
import { officialValidator } from "./official.js";

const ROOT = resolve(import.meta.dirname, "../../..");

/** A framework that a public provider publishes, as `pnpm schemas` downloads it, and what the provider adds to a package. */
interface PublicFramework {
  /** The title of the document. */
  readonly title: string;
  /** The name in the lock of the downloads: the identifier of the document. */
  readonly file: string;
  readonly provider: string;
  /** Whether the provider puts the address of the document in each item and association, which a package does not have. */
  readonly linksTheDocument: boolean;
  /** The warnings of the package without those addresses, by rule and path with the numbers of the members left out. */
  readonly warnings: readonly string[];
}

const FRAMEWORKS: readonly PublicFramework[] = [
  {
    title: "Norm Webb's Depth of Knowledge Levels",
    file: "c5fb3436-d7cb-11e8-824f-0242ac160002",
    provider: "opensalt.net",
    linksTheDocument: false,
    warnings: [],
  },
  {
    title: "Normalized Data Schema",
    file: "0ef60b38-9109-11e9-9ab3-ef46d22b49d8",
    provider: "opensalt.net",
    linksTheDocument: false,
    warnings: [],
  },
  {
    title: "AP Computer Science Principles",
    file: "4f37094a-cf04-11e7-b9f8-2ff5c05be24b",
    provider: "opensalt.net",
    linksTheDocument: false,
    warnings: [],
  },
  {
    title: "Next Generation Science Standards",
    file: "c608881b-d7cb-11e8-824f-0242ac160002",
    provider: "opensalt.net",
    linksTheDocument: false,
    warnings: [],
  },
  {
    title: "South Carolina Teacher Standards 4.0",
    file: "fb7db201-fcf7-4187-b42b-8272e3d01270",
    provider: "standards.ed.sc.gov",
    linksTheDocument: true,
    warnings: Array.from({ length: 5 }, () => "unresolved-reference CFItems[].licenseURI"),
  },
  {
    title: "South Carolina World Language",
    file: "4f146ce5-efd0-4d73-b920-9aac07fb0db0",
    provider: "standards.ed.sc.gov",
    linksTheDocument: true,
    warnings: [],
  },
];

type Json = Record<string, unknown>;

const download = (file: string): Json => JSON.parse(readFileSync(join(requireSchemas(ROOT), file), "utf8"));

/** Sorts the keys of every object, so that two values are equal when they differ only in the order of their keys. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(Reflect.get(value, key))]),
  );
}

/** Removes the properties by which an item and an association of a provider name their document. */
function asPackage(framework: Json): Json {
  const without = (entities: unknown, name: string): unknown =>
    (entities as Json[]).map(({ [name]: _, ...rest }) => rest);
  const { CFPackageURI: _, ...document } = framework.CFDocument as Json;
  return {
    ...framework,
    CFDocument: document,
    CFItems: without(framework.CFItems, "CFDocumentURI"),
    CFAssociations: without(framework.CFAssociations, "CFDocumentURI"),
  };
}

const countNodes = (nodes: ReturnType<typeof frameworkTree>): number =>
  nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);

describe.each(FRAMEWORKS)("the framework $title of $provider", ({ file, linksTheDocument, warnings }) => {
  const published = download(file);
  const items = (published.CFItems as unknown[]).length;
  const associations = (published.CFAssociations as unknown[]).length;
  const asRead = (): CasePackage => readPackage(asPackage(published), { version: "1.0" });

  it("is judged by the reader as the official schema of CASE 1.0 judges it", () => {
    const errors = validatePackage(published, { version: "1.0" }).filter(({ severity }) => severity === "error");
    expect(officialValidator("1.0", "package")(published)).toBe(errors.length === 0);
    expect(officialValidator("1.0", "package")(asPackage(published))).toBe(true);
    const findings = validatePackage(asPackage(published), { version: "1.0" });
    expect(findings.filter(({ severity }) => severity === "error")).toStrictEqual([]);
    expect(findings.map(({ rule, path }) => `${rule} ${path.replace(/\[\d+\]/gu, "[]")}`)).toStrictEqual(warnings);
  });

  it("reads into the model and is written back as it was published, apart from the order of the keys", () => {
    const framework = asRead();
    const written = toCaseVersion(framework, "1.0");
    expect(written.dropped).toStrictEqual([]);
    expect(sortKeys(written.value)).toStrictEqual(sortKeys(asPackage(published)));
  });

  it("has a tree that holds each item once, and no difference from itself", () => {
    const framework = asRead();
    expect(countNodes(frameworkTree(framework))).toBe(items);
    const diff = diffPackages(framework, framework);
    expect([diff.added, diff.removed, diff.changed, diff.replaced].map((list) => list.length)).toStrictEqual([
      0, 0, 0, 0,
    ]);
  });

  it(
    linksTheDocument
      ? "is refused as published, for the addresses of the document that its items and associations carry"
      : "is accepted as published",
    () => {
      if (!linksTheDocument) {
        expect(validatePackage(published, { version: "1.0" })).toHaveLength(warnings.length);
        expect(readPackage(published, { version: "1.0" }).CFItems).toHaveLength(items);
        return;
      }
      // A finding for each item and association, which are more than the default limit.
      const findings = validatePackage(published, { version: "1.0", maxFindings: 1_000_000 });
      expect(findings.every(({ severity, rule }) => severity === "error" && rule === "unknown-property")).toBe(true);
      expect(findings.map(({ path }) => path.replace(/\[\d+\]/gu, "[]"))).toStrictEqual([
        "CFDocument.CFPackageURI",
        ...Array.from({ length: items }, () => "CFItems[].CFDocumentURI"),
        ...Array.from({ length: associations }, () => "CFAssociations[].CFDocumentURI"),
      ]);
      expect(() => readPackage(published, { version: "1.0" })).toThrow(DataError);
    },
  );
});
