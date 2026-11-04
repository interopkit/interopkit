import { DataError } from "@interopkit/core";
import { createFindingSink, describeRefusal, type FindingSink, type Issue } from "@interopkit/core/checks";
import type { CourseStructure } from "../model/index.js";
import { inspectCourseStructure } from "./inspect.js";
import { type CourseReadOptions, type CourseReadSettings, readCourseReadOptions } from "./options.js";

/**
 * Makes the list of findings of a call that stops at a limit. A reader keeps the errors alone, because it does not report
 * warnings, and a warning does not count toward the limit.
 */
function courseIssueSink(maxFindings: number, errorsOnly: boolean): FindingSink<Issue> {
  return createFindingSink(
    maxFindings,
    (finding) => ({ ...finding, severity: "error" }),
    errorsOnly ? ({ severity }) => severity === "error" : undefined,
  );
}

/**
 * Reads a course structure with settings that were read already, and throws on its first error.
 *
 * @throws `DataError` as `readCourseStructure` does.
 */
export function readStructureWith(xml: unknown, settings: CourseReadSettings): CourseStructure {
  const sink = courseIssueSink(settings.maxFindings, true);
  const structure = inspectCourseStructure(xml, settings, sink);
  const errors = sink.list();
  if (structure === undefined || errors.length > 0) {
    throw new DataError(describeRefusal("The course structure", errors, "validateCourseStructure"));
  }
  return structure;
}

/**
 * Reads a course structure, the `cmi5.xml` of a course package, into the model, and throws on its first error.
 *
 * @remarks
 * The reader enforces every constraint of `CourseStructure.xsd` and the rules of cmi5 that the schema leaves out: every id,
 * `idref` and `activityType` a fully qualified IRI (3.0); ids unique among the blocks, the objectives and the assignable units
 * (13.1.2 to 13.1.4); an objective reference that names a declared objective; a mastery score with at most 4 decimal places;
 * `launchParameters` and `entitlementKey` as text; and the URL of an assignable unit in the characters of RFC 1738, with a
 * scheme that `launchSchemes` allows followed by `://`, relative only in a package and then below its root, and with none of
 * the parameters of the launch URL in its query (8.1, 13.1.4, 14.1, 14.2). Values are trimmed of the white space of XML
 * (13.1), except `moveOn` and `launchMethod`, which the schema compares as written. A DOCTYPE refuses the structure, and an
 * element or attribute of another namespace is kept or dropped where the schema allows one: an extension of the structure,
 * the course, a block or an assignable unit is kept as written, and any other is dropped. Bytes are UTF-8, or UTF-16 with a
 * byte order mark; a declaration of another encoding is refused.
 *
 * @param xml - The structure, as text or bytes.
 * @param options - The limits, whether the structure is in a ZIP package, and the schemes of a launch.
 * @returns The model, a copy that shares nothing with the input.
 * @throws `DataError` that names the path of the first error and counts the others, when the structure is not conforming;
 * that says which, when it is not a string or bytes, is not valid in its encoding, declares another, or passes a limit; and
 * that names the option, when an option is not valid.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#course_structure_data_model | cmi5, 13.0 Course Structure Data Requirements}
 */
export function readCourseStructure(xml: string | Uint8Array, options?: CourseReadOptions): CourseStructure {
  return readStructureWith(xml, readCourseReadOptions(options));
}

/**
 * Judges a course structure by the rules that `readCourseStructure` applies, and lists every finding as data.
 *
 * @param xml - The structure, as text or bytes.
 * @param options - The limits, the most findings, whether the structure is in a ZIP package, and the schemes of a launch.
 * @returns The findings in the order of the document, at most `maxFindings` and a last one that says the list stopped; empty
 * for a conforming structure. The reading ends at a fault of well-formedness, a DOCTYPE or a root other than
 * `courseStructure`, whose finding is then the last.
 * @throws `DataError` when the structure is not a string or bytes, is not valid in its encoding, declares another, or passes
 * a limit, and when an option is not valid.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#course_structure_data_model | cmi5, 13.0 Course Structure Data Requirements}
 */
export function validateCourseStructure(xml: string | Uint8Array, options?: CourseReadOptions): readonly Issue[] {
  const settings = readCourseReadOptions(options);
  const sink = courseIssueSink(settings.maxFindings, false);
  inspectCourseStructure(xml, settings, sink);
  return sink.list();
}
