import { DEFAULT_MAX_FINDINGS, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";

/** The most bytes of a course structure: room for about 40,000 assignable units at 410 bytes each. */
const DEFAULT_MAX_STRUCTURE_BYTES = 16_777_216;

/** The deepest a course structure nests elements: blocks in blocks, and what an extension holds. */
export const DEFAULT_MAX_STRUCTURE_DEPTH = 64;

/** The most elements and attributes of a course structure together, namespace declarations included. */
const DEFAULT_MAX_STRUCTURE_ELEMENTS = 1_000_000;

/** The schemes that an assignable unit may be launched with unless the host names others. */
const DEFAULT_LAUNCH_SCHEMES: readonly string[] = ["https", "http"];

/**
 * Schemes that run code or reach local data in a browser, which no host may allow for the launch of content from a package.
 */
const FORBIDDEN_SCHEMES: ReadonlySet<string> = new Set(["javascript", "data", "vbscript", "file", "blob", "about"]);

/** A scheme as RFC 3986 writes it, in lower case. */
const SCHEME = /^[a-z][a-z0-9+.-]*$/u;

/** The options of `readCourseStructure` and `validateCourseStructure`, and of reading the structure of a package. */
export interface CourseReadOptions {
  /**
   * The most bytes of the structure, counted as UTF-8 for a string; a larger one is refused before it is parsed.
   *
   * @defaultValue 16,777,216
   */
  readonly maxBytes?: number;
  /**
   * The deepest the structure may nest elements.
   *
   * @defaultValue 64
   */
  readonly maxDepth?: number;
  /**
   * The most elements and attributes of the structure together, namespace declarations included.
   *
   * @defaultValue 1,000,000
   */
  readonly maxElements?: number;
  /**
   * The most findings that a validation lists; a reader counts errors alone.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
  /**
   * Whether the structure comes in a ZIP package, so that the URL of an assignable unit may be relative to its root.
   *
   * @defaultValue false
   */
  readonly packaged?: boolean;
  /**
   * The schemes, in lower case, that the fully qualified URL of an assignable unit may have; each is followed by `://`.
   * `javascript`, `data`, `vbscript`, `file`, `blob` and `about` are never allowed.
   *
   * @defaultValue `["https", "http"]`
   */
  readonly launchSchemes?: readonly string[];
}

/** The options of reading a course structure with their defaults. */
export interface CourseReadSettings {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxElements: number;
  readonly maxFindings: number;
  readonly packaged: boolean;
  readonly launchSchemes: ReadonlySet<string>;
}

const launchSchemeSchema = v.pipe(
  v.string(),
  v.regex(SCHEME, (issue) => `expected a scheme in lower case, found ${issue.received}`),
  v.check(
    (scheme) => !FORBIDDEN_SCHEMES.has(scheme),
    (issue) => `expected a scheme that runs no code and reaches no local data, found ${issue.received}`,
  ),
);

/** The entries of the options of reading a course structure, which the options of reading a package extend. */
export const courseReadEntries = {
  maxBytes: v.optional(positiveIntegerSchema),
  maxDepth: v.optional(positiveIntegerSchema),
  maxElements: v.optional(positiveIntegerSchema),
  maxFindings: v.optional(positiveIntegerSchema),
  packaged: v.optional(v.boolean()),
  launchSchemes: v.optional(v.pipe(v.array(launchSchemeSchema), v.nonEmpty())),
};

const optionsSchema = strictRecord(courseReadEntries);

/** The options of `writeCourseStructure`, which a writer of a package and an import of the LMS pass on. */
export interface CourseWriteOptions {
  /**
   * The schemes, in lower case, that the fully qualified URL of an assignable unit may have, as `readCourseStructure` takes
   * them, so that what the writer writes the reader takes with the same option.
   *
   * @defaultValue `["https", "http"]`
   */
  readonly launchSchemes?: readonly string[];
}

/** The entries of the options of writing a course structure, which the options of writing a package extend. */
export const courseWriteEntries = { launchSchemes: courseReadEntries.launchSchemes };

/** Fills in the defaults of options that a schema of `courseReadEntries` read. */
export function courseReadSettings(read: v.InferOutput<typeof optionsSchema>): CourseReadSettings {
  return {
    maxBytes: read.maxBytes ?? DEFAULT_MAX_STRUCTURE_BYTES,
    maxDepth: read.maxDepth ?? DEFAULT_MAX_STRUCTURE_DEPTH,
    maxElements: read.maxElements ?? DEFAULT_MAX_STRUCTURE_ELEMENTS,
    maxFindings: read.maxFindings ?? DEFAULT_MAX_FINDINGS,
    packaged: read.packaged ?? false,
    launchSchemes: new Set(read.launchSchemes ?? DEFAULT_LAUNCH_SCHEMES),
  };
}

/**
 * Checks the options of reading a course structure and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readCourseReadOptions(options: unknown): CourseReadSettings {
  return courseReadSettings(parseWith(optionsSchema, options === undefined ? {} : options, "The options object"));
}
