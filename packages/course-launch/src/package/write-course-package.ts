import { type CallOptions, DataError } from "@interopkit/core";
import { abortSignalSchema, describe, parseWith, strictRecord } from "@interopkit/core/checks";
import { BlobReader, BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import * as v from "valibot";
import type { AssignableUnit, Block, CourseStructure } from "../model/index.js";
import { type CourseWriteOptions, writeCourseStructure } from "../structure/index.js";
import { courseWriteEntries, packageFileOf } from "../structure/internal.js";
import { foldedName, STRUCTURE_FILE } from "./archive.js";
import { DEFAULT_MAX_ENTRIES, readCoursePackage } from "./read-course-package.js";

const optionsSchema = strictRecord({ ...courseWriteEntries, signal: v.optional(abortSignalSchema) });

/**
 * The time of every entry: midnight of 1980-01-01, the first that a ZIP archive writes, in the local time that it holds, so
 * that the same course writes the same bytes anywhere and the writer reads no clock.
 */
const ENTRY_TIME = new Date(1980, 0, 1);

/** The characters that a segment of a path may not hold: a backslash, a colon, which names a drive, and control characters. */
function isUnsafeCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return character === "\\" || character === ":" || code < 0x20 || code === 0x7f;
}

/** Tells whether a segment of a path is something other than a name to a file system or an extractor. */
function isUnsafeSegment(segment: string): boolean {
  return segment === "" || segment === "." || segment === ".." || [...segment].some(isUnsafeCharacter);
}

/** Checks the path of a file of a package: segments of names below its root, never `cmi5.xml`, which the writer writes. */
function checkFilePath(path: string, folded: Map<string, string>): void {
  const segments = path.split("/");
  if (path === "" || segments.some(isUnsafeSegment)) {
    throw new DataError(
      `The file ${JSON.stringify(path)} of the package must be a path of names below its root, without ., .., \\, :, control characters or empty segments.`,
    );
  }
  const name = foldedName(path);
  if (name === STRUCTURE_FILE) {
    throw new DataError(
      `The files of the package may not hold ${JSON.stringify(path)}: the writer writes ${STRUCTURE_FILE} from the structure.`,
    );
  }
  const other = folded.get(name);
  if (other !== undefined) {
    throw new DataError(
      `The files ${JSON.stringify(other)} and ${JSON.stringify(path)} of the package are two names that an extractor writes as one file.`,
    );
  }
  folded.set(name, path);
}

/** Checks the files of a package and returns them. */
function readFiles(files: unknown): ReadonlyMap<string, Blob | Uint8Array> {
  if (!(files instanceof Map)) throw new DataError(`The files of the package must be a Map, found ${describe(files)}.`);
  const folded = new Map<string, string>();
  for (const [path, data] of files) {
    if (typeof path !== "string")
      throw new DataError(`The path of a file of the package must be a string, found ${describe(path)}.`);
    checkFilePath(path, folded);
    if (!(data instanceof Uint8Array || data instanceof Blob)) {
      throw new DataError(
        `The file ${JSON.stringify(path)} of the package must be a Blob or a Uint8Array, found ${describe(data)}.`,
      );
    }
  }
  return files;
}

/** Lists the URLs of the assignable units of a structure with their paths. */
function* urlsOf(members: readonly (AssignableUnit | Block)[], path: string): Generator<readonly [string, string]> {
  for (const [index, member] of members.entries()) {
    const at = `${path}[${index}]`;
    if (member.kind === "au") yield [member.url, at];
    else yield* urlsOf(member.children, `${at}.children`);
  }
}

/**
 * Writes a course package: a ZIP archive with the course structure as `cmi5.xml` at its root, and the files of the course.
 *
 * @remarks
 * The structure is written by `writeCourseStructure`, and each assignable unit with a relative URL must name one of the files
 * (14.1). The files keep the order of the map, after `cmi5.xml`; each entry is compressed, carries the time 1980-01-01 so that
 * the same course writes the same bytes, and the archive turns to ZIP64 where its size needs it. More files than the 100,000
 * entries that the reader takes by default are refused before anything is written, and the archive is read again by the rules
 * of `readCoursePackage` with its default limits: what the writer returns, the reader takes.
 *
 * @param structure - The course structure.
 * @param files - The files of the course by their path below the root of the package, such as `media/intro.mp4`.
 * @param options - The schemes that the URL of an assignable unit may have, as the reader takes them, and the signal.
 * @returns The archive.
 * @throws `DataError` as `writeCourseStructure` does, and when a path is not a name below the root or is one file with another
 * to an extractor, a file is not a `Blob` or bytes, or a relative URL names no file.
 * @throws The reason of the signal, when it aborts.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#course_packages_in_zip_format | cmi5, 14.1 Course Packages in ZIP Format}
 */
export async function writeCoursePackage(
  structure: CourseStructure,
  files: ReadonlyMap<string, Blob | Uint8Array>,
  options?: CallOptions & CourseWriteOptions,
): Promise<Blob> {
  const { signal, launchSchemes } = parseWith(
    optionsSchema,
    options === undefined ? {} : options,
    "The options object",
  );
  const schemes = launchSchemes === undefined ? {} : { launchSchemes };
  const xml = writeCourseStructure(structure, schemes);
  const checked = readFiles(files);
  // The reader takes this many entries by default, and the files and cmi5.xml are the entries of the archive.
  if (checked.size + 1 > DEFAULT_MAX_ENTRIES) {
    throw new DataError(
      `The package has ${checked.size} files and cmi5.xml, more than the ${DEFAULT_MAX_ENTRIES} entries that readCoursePackage takes by default.`,
    );
  }
  for (const [url, path] of urlsOf(structure.children, "children")) {
    const file = packageFileOf(url);
    if (file !== undefined && !checked.has(file)) {
      throw new DataError(
        `The files of the package have no ${JSON.stringify(file)}, which the URL of the assignable unit at ${path} names.`,
      );
    }
  }
  signal?.throwIfAborted();
  const writer = new ZipWriter(new BlobWriter("application/zip"), {
    useWebWorkers: false,
    lastModDate: ENTRY_TIME,
    extendedTimestamp: false,
    ...(signal === undefined ? {} : { signal }),
  });
  await writer.add(STRUCTURE_FILE, new Uint8ArrayReader(new TextEncoder().encode(xml)));
  for (const [path, data] of checked) {
    await writer.add(path, data instanceof Uint8Array ? new Uint8ArrayReader(data) : new BlobReader(data));
  }
  const archive = await writer.close();
  await readCoursePackage(archive, { ...schemes, ...(signal === undefined ? {} : { signal }) });
  return archive;
}
