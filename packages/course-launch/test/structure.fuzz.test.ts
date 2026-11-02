import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readCourseStructure, validateCourseStructure, writeCourseStructure } from "../src/index.js";
import { COURSE_STRUCTURES, RUNS } from "./course-arbitrary.js";
import { structure } from "./course-xml.js";

/** Runs a reader, and lets only a `DataError` through. */
function returnsOrRefuses(read: () => unknown): void {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
  }
}

describe("writing and reading course structures", () => {
  it("reads what it writes as the same structure, and finds nothing in it", () => {
    fc.assert(
      fc.property(COURSE_STRUCTURES, (course) => {
        const xml = writeCourseStructure(course);
        expect(readCourseStructure(xml, { packaged: true })).toStrictEqual(course);
        expect(validateCourseStructure(new TextEncoder().encode(xml), { packaged: true })).toStrictEqual([]);
      }),
      RUNS,
    );
  });
});

describe("the reader on any input", () => {
  it("gives findings or a DataError, and no other error, for any text and any bytes", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ unit: "binary", maxLength: 200 }), fc.uint8Array({ maxLength: 200 })),
        (input) => {
          returnsOrRefuses(() => validateCourseStructure(input));
          returnsOrRefuses(() => readCourseStructure(input));
        },
      ),
      RUNS,
    );
  });

  it("gives findings or a DataError for a structure with characters cut out of it or put into it", () => {
    const xml = structure();
    fc.assert(
      fc.property(
        fc.nat(xml.length - 1),
        fc.nat(20),
        fc.constantFrom("", "<", ">", "&", '"', "<x/>", "</au>", "<!DOCTYPE a>", "\u0000", "\ud800", "]]>"),
        (at, cut, insert) => {
          const changed = `${xml.slice(0, at)}${insert}${xml.slice(at + cut)}`;
          returnsOrRefuses(() => validateCourseStructure(changed));
          returnsOrRefuses(() => readCourseStructure(changed, { packaged: true }));
        },
      ),
      RUNS,
    );
  });

  it("gives findings with a path, a kebab-case rule, a sentence and a severity", () => {
    fc.assert(
      fc.property(fc.nat(structure().length - 1), (at) => {
        const xml = structure();
        for (const finding of validateCourseStructure(`${xml.slice(0, at)}<x/>${xml.slice(at)}`)) {
          expect(finding.rule).toMatch(/^[a-z]+(?:-[a-z0-9]+)*$/u);
          expect(finding.message).toMatch(/^[^\s].*[.:]/u);
          expect(finding.message.startsWith(finding.path) && finding.path !== "").toBe(false);
          expect(["error", "warning"]).toContain(finding.severity);
        }
      }),
      RUNS,
    );
  });
});
