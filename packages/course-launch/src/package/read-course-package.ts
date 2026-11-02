import { type CallOptions, DataError } from "@interopkit/core";
import { abortSignalSchema, describe, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type { AssignableUnit, Block, CourseStructure } from "../model/index.js";
import type { CourseReadOptions } from "../structure/index.js";
import {
  type CourseReadSettings,
  courseReadEntries,
  courseReadSettings,
  packageFileOf,
  readStructureWith,
} from "../structure/internal.js";
import { readArchive } from "./archive.js";

/** The most entries of a ZIP package, directories included. */
const DEFAULT_MAX_ENTRIES = 100_000;

/** The most bytes of the central directory of a ZIP package: room for the names of the most entries, and much more. */
const DEFAULT_MAX_DIRECTORY_BYTES = 67_108_864;

/** A course package: its course structure, the form it came in, and the files of its archive. */
export interface CoursePackage {
  /** The course structure, from `cmi5.xml` or from the XML itself. */
  readonly structure: CourseStructure;
  /** Whether the package was a ZIP archive, of 32 or 64 bits, or the XML of a course structure alone. */
  readonly source: "zip" | "xml";
  /** The files of the archive in its order, `cmi5.xml` included; none for XML. */
  readonly paths: readonly string[];
}

/** The options of `readCoursePackage`. */
export interface CoursePackageReadOptions extends Omit<CourseReadOptions, "packaged">, CallOptions {
  /**
   * The most entries of a ZIP package, directories included.
   *
   * @defaultValue 100,000
   */
  readonly maxEntries?: number;
  /**
   * The most bytes of the central directory of a ZIP package, which is read in one piece.
   *
   * @defaultValue 67,108,864
   */
  readonly maxDirectoryBytes?: number;
}

const { packaged: _packaged, ...structureEntries } = courseReadEntries;

const optionsSchema = strictRecord({
  ...structureEntries,
  maxEntries: v.optional(positiveIntegerSchema),
  maxDirectoryBytes: v.optional(positiveIntegerSchema),
  signal: v.optional(abortSignalSchema),
});

/** The signatures that a ZIP archive starts with: a local file header, or the end of the central directory of an empty one. */
const ZIP_SIGNATURES: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
];

/** The bytes that a structure in XML may start with: a byte order mark, white space, or `<`. */
const XML_STARTS: ReadonlySet<number> = new Set([0xef, 0xff, 0xfe, 0x20, 0x09, 0x0d, 0x0a, 0x3c]);

/** Reads the first bytes of an archive. */
async function headOf(archive: Blob | Uint8Array): Promise<Uint8Array> {
  return archive instanceof Uint8Array
    ? archive.subarray(0, 4)
    : new Uint8Array(await archive.slice(0, 4).arrayBuffer());
}

/** Reads the bytes of a package that is not a ZIP archive, within the limit of a course structure. */
async function bytesOf(archive: Blob | Uint8Array, maxBytes: number): Promise<Uint8Array> {
  if (archive instanceof Uint8Array) return archive;
  if (archive.size > maxBytes) {
    throw new DataError(
      `The course package has ${archive.size} bytes, above the limit of ${maxBytes} bytes of the option maxBytes.`,
    );
  }
  return new Uint8Array(await archive.arrayBuffer());
}

/** Lists the assignable units of a structure with their paths. */
function* unitsOf(
  members: readonly (AssignableUnit | Block)[],
  path: string,
): Generator<{ readonly unit: AssignableUnit; readonly path: string }> {
  for (const [index, member] of members.entries()) {
    const at = `${path}[${index}]`;
    if (member.kind === "au") yield { unit: member, path: at };
    else yield* unitsOf(member.children, `${at}.children`);
  }
}

/** Refuses an assignable unit whose relative URL names no file of the archive (14.1). */
function checkLaunchFiles(structure: CourseStructure, files: readonly string[]): void {
  const held = new Set(files);
  for (const { unit, path } of unitsOf(structure.children, "children")) {
    const file = packageFileOf(unit.url);
    if (file !== undefined && !held.has(file)) {
      throw new DataError(
        `The course package has no file ${JSON.stringify(file)}, which the URL of the assignable unit at ${path} names.`,
      );
    }
  }
}

/** Reads a ZIP package with settings that were read already. */
async function readZip(
  archive: Blob | Uint8Array,
  settings: CourseReadSettings,
  limits: { readonly maxEntries: number; readonly maxDirectoryBytes: number },
  signal: AbortSignal | undefined,
): Promise<CoursePackage> {
  const contents = await readArchive(archive, { ...limits, maxStructureBytes: settings.maxBytes }, signal);
  const structure = readStructureWith(contents.structure, { ...settings, packaged: true });
  checkLaunchFiles(structure, contents.files);
  return { structure, source: "zip", paths: contents.files };
}

/**
 * Reads a course package: a ZIP archive of 32 or 64 bits with `cmi5.xml` at its root, or the XML of a course structure alone,
 * told apart by their first bytes.
 *
 * @remarks
 * A ZIP package is read in place: its central directory, within `maxEntries` and `maxDirectoryBytes`, and `cmi5.xml`, inflated
 * within `maxBytes`. It is refused when another extractor could read it differently: a name that leaves the archive, a link,
 * an encrypted entry, a header that lies about its size, a checksum that fails, two entries whose names fold to one, and every
 * warning of zip.js but a count of entries that wrapped past 65,535. Its structure may name an assignable unit by a URL
 * relative to its root, which must name one of its files (14.1); an XML structure names each by a fully qualified URL (14.2).
 *
 * @param archive - The package, as a `Blob` or bytes.
 * @param options - The limits of the archive and of the structure, the schemes of a launch, and the signal.
 * @returns The structure, the form of the package and its files.
 * @throws `DataError` that says why, when the package is neither form, is not a valid ZIP archive, passes a limit, holds what
 * a package may not, has no `cmi5.xml` at its root, names a file it does not hold, or has a structure that `readCourseStructure`
 * refuses; and that names the option, when an option is not valid.
 * @throws The reason of the signal, when it aborts.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#course_package | cmi5, 14.0 Course Package}
 */
export async function readCoursePackage(
  archive: Blob | Uint8Array,
  options?: CoursePackageReadOptions,
): Promise<CoursePackage> {
  if (!(archive instanceof Uint8Array || archive instanceof Blob)) {
    throw new DataError(`The course package must be a Blob or a Uint8Array, found ${describe(archive)}.`);
  }
  const { maxEntries, maxDirectoryBytes, signal, ...structureOptions } = parseWith(
    optionsSchema,
    options === undefined ? {} : options,
    "The options object",
  );
  const settings = courseReadSettings(structureOptions);
  signal?.throwIfAborted();
  const head = await headOf(archive);
  if (ZIP_SIGNATURES.some((signature) => signature.every((byte, index) => head[index] === byte))) {
    const limits = {
      maxEntries: maxEntries ?? DEFAULT_MAX_ENTRIES,
      maxDirectoryBytes: maxDirectoryBytes ?? DEFAULT_MAX_DIRECTORY_BYTES,
    };
    return readZip(archive, settings, limits, signal);
  }
  if (!XML_STARTS.has(head[0] ?? 0)) {
    throw new DataError(
      "The course package is neither a ZIP archive nor the XML of a course structure: cmi5 takes those three formats alone.",
    );
  }
  const structure = readStructureWith(await bytesOf(archive, settings.maxBytes), { ...settings, packaged: false });
  signal?.throwIfAborted();
  return { structure, source: "xml", paths: [] };
}
