// cspell:ignore Ehtml
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DataError, LimitError } from "@interopkit/core";
import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { describe, expect, it } from "vitest";
import { type CourseStructure, readCourseStructure } from "../src/index.js";
import { readCoursePackage, writeCoursePackage } from "../src/package/index.js";
import { au, structure, withUrl } from "./course-xml.js";

/** An archive that `validation/cmi5_archives.py` wrote with Python's zipfile, inflated when it is gzipped. */
function archive(name: string): Uint8Array<ArrayBuffer> {
  const bytes = readFileSync(new URL(`./fixtures/archives/${name}`, import.meta.url));
  return Uint8Array.from(name.endsWith(".gz") ? gunzipSync(bytes) : bytes);
}

/** Writes an archive with zip.js, for inputs that only the limits of the reader judge. */
async function zipOf(
  entries: readonly (readonly [string, Uint8Array | undefined, { comment?: string }?])[],
): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers: false });
  for (const [name, data, options] of entries) {
    await writer.add(name, data === undefined ? undefined : new Uint8ArrayReader(data), options ?? {});
  }
  return writer.close();
}

const encode = (text: string) => new TextEncoder().encode(text);
const PACKAGED = readCourseStructure(withUrl("index.html?lesson=1"), { packaged: true });

describe("reading a ZIP package", () => {
  it("reads the structure of a package that Python wrote, with its files in the order of the archive", async () => {
    for (const source of [archive("package.zip"), new Blob([archive("package.zip")])]) {
      const read = await readCoursePackage(source);
      expect(read.source).toBe("zip");
      expect(read.paths).toStrictEqual(["cmi5.xml", "index.html", "media/clip.bin"]);
      expect(read.structure.course.id).toBe("https://example.org/courses/fixture");
      expect(read.structure.children[0]).toMatchObject({ url: "index.html?lesson=1", moveOn: "Completed" });
    }
  });

  it("reads ZIP64 and an assignable unit with a fully qualified URL", async () => {
    expect((await readCoursePackage(archive("zip64.zip"))).paths).toStrictEqual(["cmi5.xml", "index.html"]);
    expect((await readCoursePackage(archive("absolute-url.zip"))).structure.children[0]).toMatchObject({
      url: "https://example.org/au/1/index.html",
    });
  });

  it.each([
    ["dotdot.zip", "The ZIP package is not a valid ZIP archive: Unsafe filename."],
    ["absolute.zip", "The ZIP package is not a valid ZIP archive: Unsafe filename."],
    ["backslash.zip", "The ZIP package is not a valid ZIP archive: Unsafe filename."],
    ["drive.zip", "The ZIP package is not a valid ZIP archive: Unsafe filename."],
    ["inner.zip", "The ZIP package is not a valid ZIP archive: Unsafe filename."],
    ["symlink.zip", 'The ZIP package holds "link" as a symbolic link, which a package may not hold.'],
    ["encrypted.zip", 'The ZIP package holds "cmi5.xml" encrypted, which a package may not hold.'],
    ["lying-size.zip", "The ZIP package is not a valid ZIP archive: Invalid uncompressed size."],
    ["lying-bomb.zip", "The ZIP package is not a valid ZIP archive: Invalid uncompressed size."],
    ["bad-checksum.zip", "The ZIP package is not a valid ZIP archive: Invalid CRC32."],
    ["truncated.zip", "The ZIP package is not a valid ZIP archive: End of central directory not found."],
    [
      "duplicate.zip",
      'The ZIP package holds "cmi5.xml" and "cmi5.xml", two names that an extractor writes as one file.',
    ],
    [
      "folded.zip",
      'The ZIP package holds "index.html" and "INDEX.HTML", two names that an extractor writes as one file.',
    ],
    [
      "dot-segment.zip",
      'The ZIP package holds "cmi5.xml" and "./cmi5.xml", two names that an extractor writes as one file.',
    ],
    [
      "empty-segment.zip",
      'The ZIP package holds "media/clip.bin" and "media//clip.bin", two names that an extractor writes as one file.',
    ],
    [
      "trailing-dot.zip",
      'The ZIP package holds "cmi5.xml" and "cmi5.xml. ", two names that an extractor writes as one file.',
    ],
    [
      "appended.zip",
      'The ZIP package is ambiguous: zip.js reports "appended data", and another reader could find other files in it.',
    ],
    [
      "prepended.zip",
      "The course package is neither a ZIP archive nor the XML of a course structure: cmi5 takes those three formats alone.",
    ],
    ["no-structure.zip", "The ZIP package has no cmi5.xml at its root, where a package keeps its course structure."],
    [
      "nested-structure.zip",
      "The ZIP package has no cmi5.xml at its root, where a package keeps its course structure.",
    ],
    [
      "structure-directory.zip",
      "The ZIP package has no cmi5.xml at its root, where a package keeps its course structure.",
    ],
    [
      "missing-file.zip",
      'The course package has no file "index.html", which the URL of the assignable unit at children[0] names.',
    ],
    [
      "bomb.zip",
      "The cmi5.xml of the ZIP package has 17826436 bytes, above the limit of 16777216 bytes of the option maxBytes.",
    ],
    ["invalid-structure.zip", "The course structure is invalid at children[0]: has an unexpected element <link> here."],
  ])("refuses %s", async (name, sentence) => {
    const refusal = readCoursePackage(archive(name));
    await expect(refusal).rejects.toBeInstanceOf(DataError);
    await expect(refusal).rejects.toThrow(sentence);
  });

  it("finds the file that a relative URL names by its decoded path, without its query and fragment", async () => {
    const xml = withUrl("media/a%20b/../intro%2Ehtml?x=1#start");
    const zip = await zipOf([
      ["cmi5.xml", encode(xml)],
      ["media/intro.html", encode("<p>")],
    ]);
    expect((await readCoursePackage(zip)).structure.children[0]).toMatchObject({
      url: "media/a%20b/../intro%2Ehtml?x=1#start",
    });
  });

  it("refuses a package above maxEntries, a central directory above maxDirectoryBytes, and a cmi5.xml above maxBytes", async () => {
    const zip = archive("package.zip");
    await expect(readCoursePackage(zip, { maxEntries: 4 })).resolves.toMatchObject({ source: "zip" });
    await expect(readCoursePackage(zip, { maxEntries: 3 })).rejects.toThrow(
      new LimitError("The ZIP package has more than 3 entries, the limit of the option maxEntries.", "maxEntries", 3),
    );
    await expect(readCoursePackage(zip, { maxDirectoryBytes: 100 })).rejects.toThrow(
      /^The ZIP package has a central directory of \d+ bytes or more, above the limit of 100 bytes of the option maxDirectoryBytes\.$/u,
    );
    await expect(readCoursePackage(zip, { maxDirectoryBytes: 100 })).rejects.toMatchObject({
      name: "LimitError",
      limit: "maxDirectoryBytes",
      maximum: 100,
    });
    await expect(readCoursePackage(zip, { maxBytes: 100 })).rejects.toThrow(
      /^The cmi5\.xml of the ZIP package has \d+ bytes, above the limit of 100 bytes of the option maxBytes\.$/u,
    );
    await expect(readCoursePackage(zip, { maxBytes: 100 })).rejects.toMatchObject({ limit: "maxBytes", maximum: 100 });
  });

  it("finds the files that the assignable units of blocks name", async () => {
    const xml = structure(
      `<block id="https://example.org/b"><title><langstring>T</langstring></title><description><langstring>D</langstring></description>${au(undefined, "<url>a.html</url>")}</block>`,
    );
    await expect(
      readCoursePackage(
        await zipOf([
          ["cmi5.xml", encode(xml)],
          ["a.html", encode("x")],
        ]),
      ),
    ).resolves.toMatchObject({
      paths: ["cmi5.xml", "a.html"],
    });
    await expect(readCoursePackage(await zipOf([["cmi5.xml", encode(xml)]]))).rejects.toThrow(
      'The course package has no file "a.html", which the URL of the assignable unit at children[0].children[0] names.',
    );
  });

  it("passes the options of the structure to its reader, and the launch schemes", async () => {
    const zip = await zipOf([["cmi5.xml", encode(withUrl("myapp://course/1"))]]);
    await expect(readCoursePackage(zip)).rejects.toThrow("at children[0].url");
    await expect(readCoursePackage(zip, { launchSchemes: ["myapp"] })).resolves.toMatchObject({ paths: ["cmi5.xml"] });
    await expect(readCoursePackage(zip, { maxDepth: 2 })).rejects.toThrow("the limit of the option maxDepth");
  });
});

describe("reading a course structure as a package", () => {
  it("reads the XML of a structure alone, as bytes or a Blob, with fully qualified URLs", async () => {
    const xml = structure();
    const undeclared = `\n ${xml.slice(xml.indexOf("<courseStructure"))}`;
    for (const source of [
      encode(xml),
      new Blob([xml]),
      encode(undeclared),
      new Uint8Array([0xef, 0xbb, 0xbf, ...encode(xml)]),
    ]) {
      expect(await readCoursePackage(source)).toStrictEqual({
        structure: readCourseStructure(xml),
        source: "xml",
        paths: [],
      });
    }
  });

  it("refuses an XML structure with a relative URL, which only a ZIP package may have", async () => {
    await expect(readCoursePackage(encode(withUrl("index.html")))).rejects.toThrow(
      'The course structure is invalid at children[0].url: "index.html" is relative, and a course structure without a ZIP package names every assignable unit by a fully qualified URL.',
    );
  });

  it("refuses what is neither a ZIP archive nor XML, and an empty package", async () => {
    for (const bytes of [encode("# A Markdown file"), new Uint8Array(), new Uint8Array([0x50, 0x4b, 0x01, 0x02])]) {
      await expect(readCoursePackage(bytes)).rejects.toThrow(
        "The course package is neither a ZIP archive nor the XML of a course structure: cmi5 takes those three formats alone.",
      );
    }
  });

  it("refuses a Blob of XML above maxBytes before it reads it", async () => {
    await expect(readCoursePackage(new Blob([structure()]), { maxBytes: 10 })).rejects.toThrow(
      /^The course package has \d+ bytes, above the limit of 10 bytes of the option maxBytes\.$/u,
    );
  });
});

describe("the arguments of reading a package", () => {
  it("throws a DataError for a package that is neither a Blob nor bytes", async () => {
    for (const value of JSON.parse('[null, "PK", {}, [80, 75, 3, 4]]')) {
      await expect(readCoursePackage(value)).rejects.toThrow(
        /^The course package must be a Blob or a Uint8Array, found /u,
      );
    }
  });

  it("throws a DataError that names an option that is not valid, packaged among them", async () => {
    const zip = archive("package.zip");
    for (const [options, sentence] of [
      [null, "The options object is invalid: expected an object, found null."],
      [{ maxEntries: 0 }, "The options object is invalid at maxEntries"],
      [{ maxDirectoryBytes: "1" }, "The options object is invalid at maxDirectoryBytes"],
      [{ packaged: true }, 'The options object is invalid: unexpected property "packaged".'],
      [{ signal: {} }, "The options object is invalid at signal"],
    ] as const) {
      await expect(readCoursePackage(zip, options as never)).rejects.toThrow(sentence);
    }
  });

  it("rejects with the reason of a signal that aborted before or while it reads", async () => {
    const aborted = AbortSignal.abort(new Error("gave up"));
    await expect(readCoursePackage(archive("package.zip"), { signal: aborted })).rejects.toThrow(new Error("gave up"));
    const controller = new AbortController();
    let reads = 0;
    class AbortingBlob extends Blob {
      override slice(...range: Parameters<Blob["slice"]>): Blob {
        reads += 1;
        if (reads > 1) controller.abort(new Error("gave up while reading"));
        return super.slice(...range);
      }
    }
    await expect(
      readCoursePackage(new AbortingBlob([archive("package.zip")]), { signal: controller.signal }),
    ).rejects.toThrow(new Error("gave up while reading"));
    const late = new AbortController();
    const xml = new Blob([structure()]);
    const reading = readCoursePackage(xml, { signal: late.signal });
    late.abort(new Error("gave up after the read"));
    await expect(reading).rejects.toThrow(new Error("gave up after the read"));
  });
});

describe("writing a course package", () => {
  const files = new Map<string, Blob | Uint8Array>([
    ["index.html", encode("<!doctype html>")],
    ["media/clip.bin", new Blob([new Uint8Array(1024).fill(7)])],
  ]);

  it("writes cmi5.xml and the files that the reader takes back, the same bytes on every run", async () => {
    const written = await writeCoursePackage(PACKAGED, files);
    const read = await readCoursePackage(written);
    expect(read).toStrictEqual({
      structure: PACKAGED,
      source: "zip",
      paths: ["cmi5.xml", "index.html", "media/clip.bin"],
    });
    const again = await writeCoursePackage(PACKAGED, files);
    expect(new Uint8Array(await again.arrayBuffer())).toStrictEqual(new Uint8Array(await written.arrayBuffer()));
    expect(written.type).toBe("application/zip");
  });

  it("writes with a signal that does not abort", async () => {
    const written = await writeCoursePackage(PACKAGED, files, { signal: new AbortController().signal });
    expect((await readCoursePackage(written)).paths).toHaveLength(3);
  });

  it("writes a package of fully qualified URLs with no file but cmi5.xml", async () => {
    const structureOnly = readCourseStructure(structure());
    expect((await readCoursePackage(await writeCoursePackage(structureOnly, new Map()))).paths).toStrictEqual([
      "cmi5.xml",
    ]);
  });

  it.each([
    ["", "must be a path of names below its root"],
    ["/index.html", "must be a path of names below its root"],
    ["a//b.html", "must be a path of names below its root"],
    ["a/", "must be a path of names below its root"],
    ["../index.html", "must be a path of names below its root"],
    ["a/./b.html", "must be a path of names below its root"],
    ["a\\b.html", "must be a path of names below its root"],
    ["C:/b.html", "must be a path of names below its root"],
    ["a\u0000b.html", "must be a path of names below its root"],
    ["a\u007fb.html", "must be a path of names below its root"],
    ["cmi5.xml", "may not hold"],
    ["CMI5.XML", "may not hold"],
  ])("refuses the file %j", async (path, sentence) => {
    await expect(writeCoursePackage(PACKAGED, new Map([...files, [path, encode("x")]]))).rejects.toThrow(sentence);
  });

  it("writes a package whose unit has a URL of a scheme that the host names, and reads it back with the same schemes", async () => {
    const read = readCourseStructure(withUrl("myapp://course/1"), { launchSchemes: ["myapp"] });
    await expect(writeCoursePackage(read, new Map())).rejects.toThrow("does not start with a scheme");
    const written = await writeCoursePackage(read, new Map(), { launchSchemes: ["myapp"] });
    expect((await readCoursePackage(written, { launchSchemes: ["myapp"] })).structure).toStrictEqual(read);
  });

  it("refuses two files that fold to one name, a file of another type, and files that are not a Map", async () => {
    await expect(writeCoursePackage(PACKAGED, new Map([...files, ["INDEX.html", encode("x")]]))).rejects.toThrow(
      'The files "index.html" and "INDEX.html" of the package are two names that an extractor writes as one file.',
    );
    await expect(writeCoursePackage(PACKAGED, new Map([...files, ["index.html. ", encode("x")]]))).rejects.toThrow(
      'The files "index.html" and "index.html. " of the package are two names that an extractor writes as one file.',
    );
    await expect(writeCoursePackage(PACKAGED, new Map([...files, ["cmi5.xml.", encode("x")]]))).rejects.toThrow(
      "may not hold",
    );
    await expect(writeCoursePackage(PACKAGED, new Map([["index.html", "text"]]) as never)).rejects.toThrow(
      'The file "index.html" of the package must be a Blob or a Uint8Array, found "text".',
    );
    await expect(writeCoursePackage(PACKAGED, new Map([[5, encode("x")]]) as never)).rejects.toThrow(
      "The path of a file of the package must be a string, found 5.",
    );
    await expect(writeCoursePackage(PACKAGED, JSON.parse("{}"))).rejects.toThrow(
      "The files of the package must be a Map, found an object.",
    );
  });

  it("refuses a relative URL that names no file, and a structure that the reader refuses", async () => {
    await expect(writeCoursePackage(PACKAGED, new Map([["other.html", encode("x")]]))).rejects.toThrow(
      'The files of the package have no "index.html", which the URL of the assignable unit at children[0] names.',
    );
    const nested = readCourseStructure(
      structure(
        `<block id="https://example.org/b"><title><langstring>T</langstring></title><description><langstring>D</langstring></description>${au(undefined, "<url>a.html</url>")}</block>`,
      ),
      { packaged: true },
    );
    await expect(writeCoursePackage(nested, new Map())).rejects.toThrow("at children[0].children[0] names");
    await expect(writeCoursePackage({ ...PACKAGED, children: [] }, files)).rejects.toThrow("has no <au> or <block>");
  });

  it("refuses options that are not valid, and rejects with the reason of a signal that aborted", async () => {
    await expect(writeCoursePackage(PACKAGED, files, JSON.parse("null"))).rejects.toThrow(
      "The options object is invalid: expected an object, found null.",
    );
    await expect(
      writeCoursePackage(PACKAGED, files, { signal: AbortSignal.abort(new Error("gave up")) }),
    ).rejects.toThrow(new Error("gave up"));
  });
});

describe("a structure in a package", () => {
  it("keeps what the structure of a package holds when it is written and read again", async () => {
    const original: CourseStructure = (await readCoursePackage(archive("package.zip"))).structure;
    const rewritten = await writeCoursePackage(original, new Map([["index.html", encode("x")]]));
    expect((await readCoursePackage(rewritten)).structure).toStrictEqual(original);
  });
});
