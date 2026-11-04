import { DataError, LimitError } from "@interopkit/core";
import {
  type Entry,
  type FileEntry,
  Reader,
  Uint8ArrayWriter,
  WARNING_WRAPPED_ENTRIES_COUNT,
  ZipReader,
} from "@zip.js/zip.js/lib/zip-core-native.js";

/** The limits of reading a ZIP package. */
export interface ArchiveLimits {
  /** The most entries, directories included. */
  readonly maxEntries: number;
  /** The most bytes that one read of the archive may ask for: only the central directory is read in one piece. */
  readonly maxDirectoryBytes: number;
  /** The most bytes of `cmi5.xml` once inflated. */
  readonly maxStructureBytes: number;
}

/** The file of the course structure in a ZIP package, at its root (14.1). */
export const STRUCTURE_FILE = "cmi5.xml";

/**
 * Reads an archive in Blob or bytes for zip.js, and refuses a read above a limit: zip.js reads the central directory in one
 * read and the data of an entry in chunks, so the limit is that of the central directory, and a read never copies the archive.
 */
class LimitedReader extends Reader<Blob | Uint8Array> {
  readonly #source: Blob | Uint8Array;
  readonly #maxRead: number;

  constructor(source: Blob | Uint8Array, maxRead: number) {
    super(source);
    this.#source = source;
    this.#maxRead = maxRead;
    this.size = source instanceof Uint8Array ? source.byteLength : source.size;
  }

  override async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    if (length > this.#maxRead) {
      throw new LimitError(
        `The ZIP package has a central directory of ${length} bytes or more, above the limit of ${this.#maxRead} bytes of the option maxDirectoryBytes.`,
        "maxDirectoryBytes",
        this.#maxRead,
      );
    }
    const end = Math.min(index + length, this.size);
    const source = this.#source;
    return source instanceof Uint8Array
      ? source.slice(index, end)
      : new Uint8Array(await source.slice(index, end).arrayBuffer());
  }
}

/** What reading a ZIP package gives: its file entries in order, and the bytes of its course structure. */
export interface ArchiveContents {
  readonly files: readonly string[];
  readonly structure: Uint8Array;
}

/** Removes the dots and spaces that end a segment of a path, which Windows drops from a name; a loop and not a pattern. */
function withoutTrailingDots(segment: string): string {
  let end = segment.length;
  while (end > 0 && (segment[end - 1] === "." || segment[end - 1] === " ")) end -= 1;
  return segment.slice(0, end);
}

/**
 * The name of an entry as an extractor writes it to a file system that folds case and composes characters: without the
 * segments `.` and the empty ones that a path resolves away, and without the dots and spaces that end a segment, which Windows
 * drops. Two entries with one folded name are two names of one file.
 */
export function foldedName(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .split("/")
    .map(withoutTrailingDots)
    .filter((segment) => segment !== "")
    .join("/");
}

/** Refuses an entry that an extractor could write outside what was judged: a link, an encrypted entry, or a name it shares. */
function checkEntry(entry: Entry, seen: Map<string, string>): void {
  // zip.js reads a link from the type of the mode of Unix in the external attributes of the entry.
  if (entry.symlink) {
    throw new DataError(
      `The ZIP package holds ${JSON.stringify(entry.filename)} as a symbolic link, which a package may not hold.`,
    );
  }
  if (entry.encrypted) {
    throw new DataError(
      `The ZIP package holds ${JSON.stringify(entry.filename)} encrypted, which a package may not hold.`,
    );
  }
  const folded = foldedName(entry.filename);
  const other = seen.get(folded);
  if (other !== undefined) {
    throw new DataError(
      `The ZIP package holds ${JSON.stringify(other)} and ${JSON.stringify(entry.filename)}, two names that an extractor writes as one file.`,
    );
  }
  seen.set(folded, entry.filename);
}

/** Refuses the warnings of zip.js but a wrapped count of entries: each is an archive that two readers may see differently. */
function checkWarnings(warnings: readonly { readonly reason: string }[] | undefined): void {
  const warning = warnings?.find(({ reason }) => reason !== WARNING_WRAPPED_ENTRIES_COUNT);
  if (warning !== undefined) {
    throw new DataError(
      `The ZIP package is ambiguous: zip.js reports ${JSON.stringify(warning.reason)}, and another reader could find other files in it.`,
    );
  }
}

/** Turns a failure of zip.js into a refusal of the archive, and lets an abort and a refusal of a limit through. */
function refusalOf(error: unknown, signal: AbortSignal | undefined): unknown {
  if (signal?.aborted === true) return signal.reason;
  if (error instanceof DataError) return error;
  const reason = error instanceof Error ? error.message : String(error);
  return new DataError(`The ZIP package is not a valid ZIP archive: ${reason}.`, { cause: error });
}

/** What reading the entries of an archive keeps: the names of its files and the entry of its course structure. */
interface ArchiveEntries {
  readonly files: string[];
  structure: FileEntry | undefined;
}

/**
 * Goes through the entries of an archive within the limit of their count, checks each, and keeps the names of the files and
 * the entry of `cmi5.xml` alone: zip.js gives each entry several kilobytes, which a list of every entry would keep at once.
 */
async function readEntries(reader: ZipReader<unknown>, limits: ArchiveLimits): Promise<ArchiveEntries> {
  const read: ArchiveEntries = { files: [], structure: undefined };
  const seen = new Map<string, string>();
  for await (const entry of reader.getEntriesGenerator()) {
    if (seen.size >= limits.maxEntries) {
      throw new LimitError(
        `The ZIP package has more than ${limits.maxEntries} entries, the limit of the option maxEntries.`,
        "maxEntries",
        limits.maxEntries,
      );
    }
    checkEntry(entry, seen);
    if (entry.directory) continue;
    read.files.push(entry.filename);
    if (entry.filename === STRUCTURE_FILE) read.structure = entry;
  }
  checkWarnings(reader.warnings);
  return read;
}

/**
 * Inflates the course structure of an archive within the limit of its bytes: the size that its header gives is checked first,
 * and zip.js refuses data that inflates past that size as soon as it does, so a bomb never inflates further.
 */
async function readStructureFile(entry: FileEntry, limits: ArchiveLimits, signal: AbortSignal | undefined) {
  if (entry.uncompressedSize > limits.maxStructureBytes) {
    throw new LimitError(
      `The cmi5.xml of the ZIP package has ${entry.uncompressedSize} bytes, above the limit of ${limits.maxStructureBytes} bytes of the option maxBytes.`,
      "maxBytes",
      limits.maxStructureBytes,
    );
  }
  const bytes = await entry.getData(new Uint8ArrayWriter(), signal === undefined ? {} : { signal });
  checkWarnings(entry.warnings);
  return bytes;
}

/**
 * Reads the entries of a ZIP package and the bytes of its `cmi5.xml`, refusing an archive that another extractor could read
 * differently from this reader.
 *
 * @remarks
 * zip.js refuses a name that leaves the archive (`../`, an absolute path, a drive, a backslash), a header that lies about the
 * size of its data, and a checksum that does not match. The archive is read in place: a `Blob` for its central directory and
 * `cmi5.xml` alone.
 *
 * @throws `DataError` when the archive is not a ZIP archive, passes a limit, is ambiguous, holds a link or an encrypted entry,
 * holds two entries that fold to one name, or has no `cmi5.xml` at its root.
 */
export async function readArchive(
  archive: Blob | Uint8Array,
  limits: ArchiveLimits,
  signal: AbortSignal | undefined,
): Promise<ArchiveContents> {
  const reader = new ZipReader(new LimitedReader(archive, limits.maxDirectoryBytes), {
    useWebWorkers: false,
    checkCrc32: true,
    ...(signal === undefined ? {} : { signal }),
  });
  try {
    const { files, structure } = await readEntries(reader, limits);
    if (structure === undefined) {
      throw new DataError(
        `The ZIP package has no ${STRUCTURE_FILE} at its root, where a package keeps its course structure.`,
      );
    }
    return { files, structure: await readStructureFile(structure, limits, signal) };
  } catch (error) {
    throw refusalOf(error, signal);
  } finally {
    await reader.close();
  }
}
