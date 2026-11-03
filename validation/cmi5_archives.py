"""Writes the ZIP fixtures of course-launch: course packages that a reader must take and archives that it must refuse.

Python's zipfile writes every archive, an implementation that shares no code with zip.js. The hostile ones are written as
zipfile writes them and then changed byte by byte where the APPNOTE puts each field: a name that leaves the archive, a symbolic
link, the flag of encryption, sizes and a CRC-32 that lie, two entries of one name, data before and after the archive, and a
count of entries that wraps past 65,535 without the records of ZIP64. The two archives of tens of thousands of entries are
written gzipped, which keeps them small in the repository; the tests inflate them.

Run it from the repository: python3 validation/cmi5_archives.py
"""

# cspell:ignore HHII
import gzip
import io
import struct
import warnings
import zipfile
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "course-launch" / "test" / "fixtures" / "archives"

NAMESPACE = "https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd"


def structure(url):
    """A course structure of one assignable unit that names its launch point by the URL given."""
    return f"""<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="{NAMESPACE}">
  <course id="https://example.org/courses/fixture">
    <title><langstring lang="en">A fixture</langstring></title>
    <description><langstring lang="en">A course package that the tests read.</langstring></description>
  </course>
  <au id="https://example.org/courses/fixture/au/1" moveOn="Completed">
    <title><langstring lang="en">The unit</langstring></title>
    <description><langstring lang="en">The one assignable unit.</langstring></description>
    <url>{url}</url>
  </au>
</courseStructure>
""".encode()


STRUCTURE = structure("index.html?lesson=1")
PAGE = b"<!doctype html><title>The unit</title>"


def info(name, compression=zipfile.ZIP_DEFLATED, external=None):
    """An entry of a fixed time, so that the archives are the same on every run."""
    entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    entry.compress_type = compression
    if external is not None:
        entry.external_attr = external
    return entry


def archive(entries, force_zip64=False):
    """The bytes of an archive of (name, data) entries, or (ZipInfo, data)."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", allowZip64=True) as written:
        for name, data in entries:
            entry = name if isinstance(name, zipfile.ZipInfo) else info(name)
            if force_zip64:
                with written.open(entry, "w", force_zip64=True) as stream:
                    stream.write(data)
            else:
                written.writestr(entry, data)
    return bytearray(buffer.getvalue())


def headers(data):
    """The offsets of the local file headers and of the central directory headers of an archive, in order."""
    local = [index for index in range(len(data)) if data[index : index + 4] == b"PK\x03\x04"]
    central = [index for index in range(len(data)) if data[index : index + 4] == b"PK\x01\x02"]
    return local, central


def patch(data, entry, local_offset, central_offset, fmt, value):
    """Writes a field of the local header and of the central header of an entry: offsets per the APPNOTE, 4.3.7 and 4.3.12."""
    local, central = headers(data)
    struct.pack_into(fmt, data, local[entry] + local_offset, value)
    struct.pack_into(fmt, data, central[entry] + central_offset, value)
    return data


def wrapped(count):
    """An archive of `count` entries whose end of central directory gives the count modulo 65,536, without ZIP64 records."""
    data = archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)] + [(info(f"f/{i}", zipfile.ZIP_STORED), b"") for i in range(count - 2)])
    zip64 = data.rfind(b"PK\x06\x06")
    end = data.rfind(b"PK\x05\x06")
    size, offset = struct.unpack_from("<QQ", data, zip64 + 40)
    tail = bytearray(data[end:])
    struct.pack_into("<HHII", tail, 8, count % 65536, count % 65536, size, offset)
    return data[:zip64] + tail


def write(name, data):
    (OUTPUT / name).write_bytes(bytes(data))


def write_gzipped(name, data):
    with gzip.GzipFile(filename="", mode="wb", fileobj=(OUTPUT / name).open("wb"), mtime=0) as stream:
        stream.write(bytes(data))


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    good = [("cmi5.xml", STRUCTURE), (info("media/", zipfile.ZIP_STORED), b""), ("index.html", PAGE), ("media/clip.bin", bytes(range(256)) * 64)]
    write("package.zip", archive(good))
    write("zip64.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)], force_zip64=True))
    write("absolute-url.zip", archive([("cmi5.xml", structure("https://example.org/au/1/index.html"))]))
    write("no-structure.zip", archive([("index.html", PAGE)]))
    write("nested-structure.zip", archive([("course/cmi5.xml", STRUCTURE), ("course/index.html", PAGE)]))
    write("structure-directory.zip", archive([(info("cmi5.xml/", zipfile.ZIP_STORED), b""), ("index.html", PAGE)]))
    write("missing-file.zip", archive([("cmi5.xml", STRUCTURE), ("other.html", PAGE)]))
    write("invalid-structure.zip", archive([("cmi5.xml", structure("index.html").replace(b"<url>", b"<link>").replace(b"</url>", b"</link>")), ("index.html", PAGE)]))
    for name, path in [("dotdot", "../evil.html"), ("absolute", "/evil.html"), ("backslash", "a\\..\\..\\evil.html"), ("drive", "C:/evil.html"), ("inner", "a/../../evil.html")]:
        write(f"{name}.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE), (path, PAGE)]))
    write("symlink.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE), (info("link", zipfile.ZIP_STORED, 0o120777 << 16), b"/etc/passwd")]))
    # Bit 0 of the general purpose flag, at 6 in a local header and 8 in a central header, says the entry is encrypted.
    encrypted = archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)])
    local, central = headers(encrypted)
    encrypted[local[0] + 6] |= 1
    encrypted[central[0] + 8] |= 1
    write("encrypted.zip", encrypted)
    # The uncompressed size, at 22 in a local header and 24 in a central header, of a cmi5.xml that inflates to more.
    write("lying-size.zip", patch(archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)]), 0, 22, 24, "<I", 64))
    # The CRC-32, at 14 in a local header and 16 in a central header.
    write("bad-checksum.zip", patch(archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)]), 0, 14, 16, "<I", 0x12345678))
    # zipfile warns of the second entry of one name, which is the point of this archive.
    warnings.filterwarnings("ignore", "Duplicate name")
    write("duplicate.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE), ("cmi5.xml", structure("https://example.org/other"))]))
    write("folded.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE), ("INDEX.HTML", PAGE)]))
    # Names that an extractor writes to the file of another: a segment ".", an empty segment, and, on Windows, the dots and
    # spaces that end a segment.
    other = structure("https://example.org/other")
    write("dot-segment.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE), ("./cmi5.xml", other)]))
    write("empty-segment.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE), ("media/clip.bin", PAGE), ("media//clip.bin", PAGE)]))
    write("trailing-dot.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE), ("cmi5.xml. ", other)]))
    write("prepended.zip", b"MZ" + bytes(126) + archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)]))
    write("appended.zip", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)]) + b"appended data")
    whole = archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)])
    write("truncated.zip", whole[: len(whole) - 30])
    # A cmi5.xml of 17 MiB of white space after its root, above the 16 MiB that a course structure may have.
    write("bomb.zip", archive([("cmi5.xml", STRUCTURE + b" " * (17 * 1024 * 1024)), ("index.html", PAGE)]))
    # A cmi5.xml that inflates to 64 MiB and says it has 64 bytes: a reader that trusts the header or inflates it whole fails.
    write("lying-bomb.zip", patch(archive([("cmi5.xml", STRUCTURE + b" " * (64 * 1024 * 1024)), ("index.html", PAGE)]), 0, 22, 24, "<I", 64))
    write_gzipped("zip64-many.zip.gz", archive([("cmi5.xml", STRUCTURE), ("index.html", PAGE)] + [(info(f"f/{i}", zipfile.ZIP_STORED), b"") for i in range(65999)]))
    write_gzipped("wrapped.zip.gz", wrapped(70002))
    print(f"Wrote the archives to {OUTPUT}.")


if __name__ == "__main__":
    main()
