import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64url } from "../src/base64url.js";

const RUNS = { seed: 20_261_103, numRuns: 300 };

/** The base64url of bytes without padding, by an independent implementation. */
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

describe("decodeBase64url", () => {
  it("decodes the base64url of any bytes into the same bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(decodeBase64url(encode(bytes))).toStrictEqual(bytes);
      }),
      RUNS,
    );
  });

  it("refuses a spelling of the same bytes with bits that no byte holds", () => {
    // "e30" is the one spelling of "{}"; "e31" and "e32" hold bits after the last byte, and Node.js decodes them as "{}".
    expect(decodeBase64url("e30")).toStrictEqual(new TextEncoder().encode("{}"));
    expect(Buffer.from("e31", "base64url").toString()).toBe("{}");
    for (const text of ["e31", "e32", "QR", "QQF"]) expect(decodeBase64url(text)).toBeUndefined();
  });

  it("refuses padding, the alphabet of plain base64, white space and a length that holds no bytes", () => {
    for (const text of ["e30=", "QQ==", "a+b/", "a b", "e30\n", "A", "AAAAA"])
      expect(decodeBase64url(text)).toBeUndefined();
  });

  it("refuses a character beyond ASCII, whether one code unit or a pair, and one that ASCII holds but the alphabet does not", () => {
    // U+00E9 and U+0100 are beyond the 128 units of the table, and an emoji is two code units.
    for (const text of ["e30\u00e9", "\u0100e30", "e3\u{1f600}", "\u00e9\u00e9\u00e9\u00e9", "e30\u0000", "e30\u007f"])
      expect(decodeBase64url(text)).toBeUndefined();
  });

  it("returns undefined, and throws nothing, for any text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const bytes = decodeBase64url(text);
        if (bytes !== undefined) expect(encode(bytes)).toBe(text);
      }),
      RUNS,
    );
  });
});
