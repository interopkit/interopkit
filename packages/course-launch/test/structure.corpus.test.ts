import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Issue } from "@interopkit/core/checks";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { createXsdOracle } from "../../../scripts/xsd-oracle.js";
import { readCourseStructure, validateCourseStructure, writeCourseStructure } from "../src/index.js";
import { catapult, courseStructureXsd } from "./cmi5-corpus.js";
import { COURSE_STRUCTURES, RUNS } from "./course-arbitrary.js";

const oracle = createXsdOracle(courseStructureXsd());
afterAll(() => oracle.close());

/** The packages of the LMS suite of CATAPULT: files of XML, and folders whose cmi5.xml its build zips. */
const SUITE = () => join(catapult(), "lts/pkg/src");

/**
 * The rule of the reader that each package of the LMS suite that the suite rejects breaks, by the requirement it names:
 * every one is a rule of cmi5 that the schema does not hold, except 207, which breaks the schema.
 */
const SUITE_REFUSALS: Readonly<Record<string, readonly [string, boolean]>> = {
  "201-1-iris-course-id.xml": ["iri", true],
  "201-2-iris-block-id.xml": ["iri", true],
  "201-3-iris-au-id.xml": ["iri", true],
  "201-4-iris-objective-id.xml": ["iri", true],
  "202-1-relative-url-no-zip.xml": ["url-relative", true],
  "202-2-relative-url-no-zip.xml": ["url-relative", true],
  "202-3-relative-url-no-zip.xml": ["url-relative", true],
  "202-4-relative-url-no-zip.xml": ["url-relative", true],
  "202-5-relative-url-no-zip.xml": ["url-relative", true],
  "204-query-string-conflict-endpoint.xml": ["url-query", true],
  "205-1-duplicated-block.xml": ["duplicate-id", true],
  "205-2-duplicated-objective.xml": ["duplicate-id", true],
  "205-3-duplicated-au.xml": ["duplicate-id", true],
  "206-1-invalid-au-url.xml": ["url-characters", true],
  "207-1-invalid-courseStructure.xml": ["unexpected-element", false],
};

describe("the course examples of CATAPULT", () => {
  const examples = readdirSync(join(catapult(), "course_examples"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "packages")
    .map(({ name }) => name);

  it("are six", () => {
    expect(examples).toHaveLength(6);
  });

  it.each(examples)(
    "reads %s, which libxml2 finds valid, and writes it as a structure that reads back the same",
    (name) => {
      const xml = readFileSync(join(catapult(), "course_examples", name, "cmi5.xml"), "utf8");
      expect(oracle.verdict(xml)).toStrictEqual({ valid: true });
      const read = readCourseStructure(xml, { packaged: true });
      expect(readCourseStructure(writeCourseStructure(read), { packaged: true })).toStrictEqual(read);
    },
  );
});

describe("the packages of the LMS suite of CATAPULT", () => {
  const files = readdirSync(SUITE()).filter((name) => name.endsWith(".xml"));
  const folders = readdirSync(SUITE(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && readdirSync(join(SUITE(), entry.name)).includes("cmi5.xml"))
    .map(({ name }) => name);

  it("are the 16 files of XML and the 17 folders with a cmi5.xml of the pinned suite", () => {
    expect(files).toHaveLength(16);
    expect(folders).toHaveLength(17);
  });

  it.each(files.filter((name) => !(name in SUITE_REFUSALS)))("reads %s, which the suite imports", (name) => {
    const xml = readFileSync(join(SUITE(), name), "utf8");
    expect(oracle.verdict(xml)).toStrictEqual({ valid: true });
    expect(validateCourseStructure(xml)).toStrictEqual([]);
  });

  it("reads the 1,001 assignable units of the suite's largest structure", () => {
    expect(readCourseStructure(readFileSync(join(SUITE(), "101-one-thousand-aus.xml"))).children).toHaveLength(1_001);
  });

  it.each(Object.entries(SUITE_REFUSALS))("refuses %s by the rule the suite names", (name, [rule, schemaTakes]) => {
    const xml = readFileSync(join(SUITE(), name), "utf8");
    expect(validateCourseStructure(xml).map((finding) => finding.rule)).toContain(rule);
    expect(oracle.verdict(xml).valid).toBe(schemaTakes);
  });

  it.each(folders)("reads the cmi5.xml of %s, whose units its build puts in the package", (name) => {
    const xml = readFileSync(join(SUITE(), name, "cmi5.xml"), "utf8");
    expect(oracle.verdict(xml)).toStrictEqual({ valid: true });
    expect(validateCourseStructure(xml, { packaged: true })).toStrictEqual([]);
  });
});

/**
 * The rules of cmi5 that the schema does not hold: a structure that breaks one and nothing else is valid by libxml2 and
 * refused by the reader. Each is a row of `docs/course-launch/spec-gaps.md`.
 */
const STRICTER_RULES: ReadonlySet<string> = new Set([
  "doctype",
  "iri",
  "duplicate-id",
  "objective-reference",
  "mastery-score",
  "url-characters",
  "url-scheme",
  "url-relative",
  "url-query",
]);

/**
 * Tells whether a finding is one of a rule of cmi5 that the schema leaves out: those of `STRICTER_RULES`, an objective
 * reference without `idref`, and an element or an attribute in `launchParameters` or `entitlementKey`, which the schema leaves
 * untyped and cmi5 types as text.
 */
function isStricterRule({ rule, path, message }: Issue): boolean {
  if (STRICTER_RULES.has(rule)) return true;
  if (rule === "missing-attribute") return message === "has no attribute idref.";
  if (rule === "unexpected-element" && isAfterExtension(path, message)) return true;
  return /^unexpected-(?:element|attribute)$/u.test(rule) && /\.(?:launchParameters|entitlementKey)$/u.test(path);
}

/**
 * Tells whether a finding is of a `langstring` or an `objective` after an extension in a title, a description or a list of
 * objectives: the sequence of the schema puts the extensions last, and libxml2 takes such an element where a particle that
 * may repeat precedes the wildcard. The reader follows the schema.
 */
function isAfterExtension(path: string, message: string): boolean {
  return (
    (/\.(?:title|description)$/u.test(path) && message === "has an unexpected element <langstring> here.") ||
    (/(?:^|\.)objectives$/u.test(path) && message === "has an unexpected element <objective> here.")
  );
}

/** Changes of one place in a structure that conforms, as text: the reader and libxml2 judge the result. */
const CHANGES: readonly ((xml: string, at: number) => string)[] = [
  // Drops an element, its content with it.
  (xml, at) => {
    const start = xml.indexOf("<", at);
    const match = /^<([A-Za-z:]+)[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/u.exec(xml.slice(start));
    return match === null ? xml : `${xml.slice(0, start)}${xml.slice(start + match[0].length)}`;
  },
  // Repeats an element after itself.
  (xml, at) => {
    const start = xml.indexOf("<", at);
    const match = /^<([A-Za-z:]+)[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/u.exec(xml.slice(start));
    return match === null ? xml : `${xml.slice(0, start)}${match[0]}${xml.slice(start)}`;
  },
  (xml, at) => insertAt(xml, at, '<v:x xmlns:v="urn:v">1</v:x>'),
  (xml, at) => insertAt(xml, at, '<x xmlns="">1</x>'),
  (xml, at) => insertAt(xml, at, "<langstring>t</langstring>"),
  (xml, at) => insertAt(xml, at, "text"),
  (xml, at) => insertAt(xml, at, " "),
  (xml, at) => insertAttribute(xml, at, 'color="red"'),
  (xml, at) => insertAttribute(xml, at, 'xmlns:v="urn:v" v:a="1"'),
  (xml, at) => insertAttribute(xml, at, 'xml:lang="en"'),
  (xml, at) => replaceValue(xml, at, /moveOn="[^"]*"/u, ['moveOn=" Passed"', 'moveOn="passed"', 'moveOn=""']),
  (xml, at) => replaceValue(xml, at, /launchMethod="[^"]*"/u, ['launchMethod="OwnWindow "', 'launchMethod="Window"']),
  (xml, at) =>
    replaceValue(xml, at, /lang="[^"]*"/u, ['lang=" en "', 'lang="en_US"', 'lang="abcdefghi"', 'lang="x-1"']),
  (xml, at) => replaceValue(xml, at, /id="[^"]*"/u, ['id=""', 'id="a b"', 'id=" https://example.org/x "', 'id="x:y"']),
  (xml, at) =>
    replaceValue(xml, at, /<url>[^<]*<\/url>/u, ["<url></url>", "<url> </url>", "<url>a b</url>", "<url>../a</url>"]),
  (xml, at) =>
    insertAttribute(
      xml,
      at,
      ["masteryScore", "1.5", "0.12345", ".5", "1e0", "-0", " 0.5 "].map((value) => `masteryScore="${value}"`)[
        at % 7
      ] ?? "",
    ),
];

/** Puts text before the next tag from a place. */
function insertAt(xml: string, at: number, text: string): string {
  const start = xml.indexOf("<", at);
  return start < 0 ? xml : `${xml.slice(0, start)}${text}${xml.slice(start)}`;
}

/** Puts an attribute into the next start tag from a place. */
function insertAttribute(xml: string, at: number, attribute: string): string {
  const match = /<([A-Za-z][A-Za-z:]*)(?=[\s/>])/u.exec(xml.slice(at));
  if (match === null) return xml;
  const end = at + match.index + match[0].length;
  return `${xml.slice(0, end)} ${attribute}${xml.slice(end)}`;
}

/** Replaces the next match of a pattern from a place with one of the values. */
function replaceValue(xml: string, at: number, pattern: RegExp, values: readonly string[]): string {
  const match = pattern.exec(xml.slice(at));
  if (match === null) return xml;
  const start = at + match.index;
  return `${xml.slice(0, start)}${values[at % values.length]}${xml.slice(start + match[0].length)}`;
}

describe("the reader against libxml2 and the schema", () => {
  it("finds valid what it writes, as libxml2 does", () => {
    fc.assert(
      fc.property(COURSE_STRUCTURES, (course) => {
        expect(oracle.verdict(writeCourseStructure(course))).toStrictEqual({ valid: true });
      }),
      RUNS,
    );
  });

  it("refuses each structure with one change that libxml2 refuses, and refuses more only by a rule of cmi5 that the schema leaves out", () => {
    let disagreements = 0;
    fc.assert(
      fc.property(COURSE_STRUCTURES, fc.nat(CHANGES.length - 1), fc.nat(), (course, change, place) => {
        const written = writeCourseStructure(course);
        const xml = CHANGES[change]?.(written, place % written.length) ?? written;
        const theirs = oracle.verdict(xml);
        const ours = validateCourseStructure(xml, { packaged: true });
        if (!theirs.valid) {
          expect(ours.length, `${theirs.message}\n${xml}`).toBeGreaterThan(0);
          return;
        }
        if (ours.length === 0) return;
        disagreements += 1;
        expect(
          ours.filter((finding) => !isStricterRule(finding)),
          xml,
        ).toStrictEqual([]);
      }),
      { ...RUNS, numRuns: 2_000 },
    );
    expect(disagreements).toBeGreaterThan(0);
  });
});
