import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createXsdOracle } from "../../../scripts/xsd-oracle.js";
import {
  CMI5_ACTIVITY_TYPES,
  CMI5_CATEGORIES,
  CMI5_EXTENSIONS,
  CMI5_VERBS,
  COURSE_STRUCTURE_NAMESPACE,
  LAUNCH_DATA_STATE_ID,
  LAUNCH_METHODS,
  LAUNCH_MODES,
  LEARNER_PREFERENCES_PROFILE_ID,
  MOVE_ON_VALUES,
  readCourseStructure,
  validateCourseStructure,
  writeCourseStructure,
} from "../src/index.js";
import { cmi5Spec, courseStructureXsd } from "./cmi5-corpus.js";

const oracle = createXsdOracle(courseStructureXsd());
afterAll(() => oracle.close());

const example = (name: string) => readFileSync(join(cmi5Spec(), "v1/examples", name), "utf8");

describe("the examples of the specification", () => {
  it.each(["simple-cmi5.xml", "complex-cmi5.xml", "extended-cmi5.xml"])(
    "reads %s, which libxml2 finds valid, and writes it as a structure that reads back the same",
    (name) => {
      const xml = example(name);
      expect(oracle.verdict(xml)).toStrictEqual({ valid: true });
      expect(validateCourseStructure(xml)).toStrictEqual([]);
      const read = readCourseStructure(xml);
      const written = writeCourseStructure(read);
      expect(oracle.verdict(written)).toStrictEqual({ valid: true });
      expect(readCourseStructure(written)).toStrictEqual(read);
    },
  );

  it("keeps the vendor extension of the extended example as written, each element with its namespaces", () => {
    const read = readCourseStructure(example("extended-cmi5.xml"));
    expect(read.children[0]?.extensions.map(({ name }) => name)).toStrictEqual(Array(5).fill("keyword"));
    expect(read.extensions).toHaveLength(1);
    expect(read.extensions[0]?.xml).toMatch(
      /^<kw:keywords xmlns:kw="http:\/\/www\.adlnet\.gov\/cmi5\/KeywordExtension\.xsd" xmlns="https:\/\/w3id\.org\/xapi\/profiles\/cmi5\/v1\/CourseStructure\.xsd">/u,
    );
  });

  it("reads the complex example into its objectives and its blocks in blocks", () => {
    const read = readCourseStructure(example("complex-cmi5.xml"));
    expect(read.objectives.length).toBeGreaterThan(0);
    expect(
      read.children.some(
        (member) => member.kind === "block" && member.children.some((child) => child.kind === "block"),
      ),
    ).toBe(true);
  });
});

describe("the vocabularies", () => {
  const text = readFileSync(join(cmi5Spec(), "cmi5_spec.md"), "utf8");
  const xsd = courseStructureXsd();

  it("name each IRI and id as the specification writes it", () => {
    for (const iri of [
      ...Object.values(CMI5_VERBS),
      ...Object.values(CMI5_CATEGORIES),
      ...Object.values(CMI5_EXTENSIONS),
      ...Object.values(CMI5_ACTIVITY_TYPES),
      LAUNCH_DATA_STATE_ID,
      LEARNER_PREFERENCES_PROFILE_ID,
    ]) {
      expect(text).toContain(iri);
    }
    expect(xsd).toContain(`targetNamespace="${COURSE_STRUCTURE_NAMESPACE}"`);
  });

  it("hold the values that the schema enumerates for moveOn and launchMethod, and the launch modes of the specification", () => {
    const enumeration = (attribute: string) => {
      const start = xsd.indexOf(`<xs:attribute name="${attribute}"`);
      const end = xsd.indexOf("</xs:attribute>", start);
      return [...xsd.slice(start, end).matchAll(/<xs:enumeration value="([^"]+)"\/>/gu)]
        .map(([, value]) => value)
        .sort();
    };
    expect([...MOVE_ON_VALUES].sort()).toStrictEqual(enumeration("moveOn"));
    expect([...LAUNCH_METHODS].sort()).toStrictEqual(enumeration("launchMethod"));
    for (const mode of LAUNCH_MODES) expect(text).toContain(`"${mode}"`);
  });
});
