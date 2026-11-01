import { readFileSync } from "node:fs";
import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bakePng, bakeSvg, readPng, readSvg } from "../src/baking/index.js";
import { crc32 } from "../src/baking/internal.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_106, numRuns: 400 };

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/baking/baked-images.json", import.meta.url), "utf8")) as {
  readonly credentials: { readonly badge: Record<string, unknown>; readonly clr: Record<string, unknown> };
  readonly png: { readonly base: string; readonly cases: Record<string, { readonly baked: string }> };
  readonly svg: { readonly base: string; readonly cases: Record<string, { readonly baked: string }> };
};
const BASE = Uint8Array.from(Buffer.from(FIXTURE.png.base, "base64"));
const SIGNATURE = BASE.subarray(0, 8);
const HEADER = BASE.subarray(8, 8 + 25);
const KEYWORDS = ["openbadgecredential", "clrcredential", "Comment", ""];

/** Runs a call and returns what it throws, or undefined when it returns. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** A chunk of the given type and data, with a CRC-32 that is right unless `crc` says another. */
function chunk(type: string, data: Uint8Array, crc?: number): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc ?? crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** An iTXt chunk whose fields the generator picks: a keyword of the kinds, the flags, and any bytes after them. */
const textChunk = fc
  .tuple(fc.constantFrom(...KEYWORDS), fc.uint8Array({ maxLength: 8 }), fc.uint8Array({ maxLength: 60 }), fc.boolean())
  .map(([keyword, flags, text, rightCrc]) => {
    const data = join([new TextEncoder().encode(keyword), Uint8Array.of(0), flags, text]);
    return chunk("iTXt", data, rightCrc ? undefined : 7);
  });

/** A chunk of a PNG that is not ours, of a type that the specification names, with any data. */
const otherChunk = fc
  .tuple(fc.constantFrom("IDAT", "tEXt", "pHYs", "zTXt", "abCD"), fc.uint8Array({ maxLength: 40 }))
  .map(([type, data]) => chunk(type, data));

/** A PNG-shaped file: the signature, IHDR, any chunks, and usually IEND. */
const pngShaped = fc
  .tuple(fc.array(fc.oneof(textChunk, otherChunk), { maxLength: 6 }), fc.boolean())
  .map(([chunks, ended]) => join([SIGNATURE, HEADER, ...chunks, ...(ended ? [chunk("IEND", new Uint8Array(0))] : [])]));

describe("readPng and bakePng on any bytes", () => {
  it("read bytes into a credential, nothing, or a DataError", () => {
    fc.assert(
      fc.property(fc.oneof(fc.uint8Array({ maxLength: 200 }), pngShaped), (image) => {
        const error = thrownBy(() => readPng(image));
        expect(error === undefined || error instanceof DataError).toBe(true);
        const baking = thrownBy(() => bakePng(image, FIXTURE.credentials.badge, { replace: true }));
        expect(baking === undefined || baking instanceof DataError).toBe(true);
      }),
      RUNS,
    );
  });

  it("survive a baked image with bytes changed", () => {
    const baked = Uint8Array.from(Buffer.from(FIXTURE.png.cases["badge-json"]?.baked ?? "", "base64"));
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(baked.length - 1), fc.nat(255)), { minLength: 1, maxLength: 4 }),
        (changes) => {
          const image = Uint8Array.from(baked);
          for (const [at, value] of changes) image[at] = value;
          const error = thrownBy(() => readPng(image));
          expect(error === undefined || error instanceof DataError).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("leave every chunk but the credential as it was", () => {
    fc.assert(
      fc.property(
        pngShaped.filter((image) => thrownBy(() => readPng(image)) === undefined && readPng(image) === undefined),
        (image) => {
          const baked = bakePng(image, FIXTURE.credentials.clr);
          const credential = baked.subarray(33, baked.length - (image.length - 33));
          expect(credential.length).toBeGreaterThan(0);
          expect(join([baked.subarray(0, 33), baked.subarray(33 + credential.length)])).toStrictEqual(image);
          expect(readPng(baked)?.kind).toBe("clr");
        },
      ),
      RUNS,
    );
  });
});

describe("readSvg and bakeSvg on any text", () => {
  const pieces = [
    "<svg",
    ' xmlns="http://www.w3.org/2000/svg"',
    ">",
    "</svg>",
    "<a>",
    "</a>",
    "<a/>",
    "<!--",
    "-->",
    "<![CDATA[",
    "]]>",
    "&amp;",
    "&x;",
    "<?x?>",
    ' x:y="1"',
    ' verify="a.b.c"',
    "é",
    "\u{1f600}",
  ];

  it("read text into a credential, nothing, or a DataError", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 120 }),
          fc.array(fc.constantFrom(...pieces), { maxLength: 14 }).map((parts) => parts.join("")),
        ),
        (svg) => {
          const error = thrownBy(() => readSvg(svg));
          expect(error === undefined || error instanceof DataError).toBe(true);
          const baking = thrownBy(() => bakeSvg(svg, FIXTURE.credentials.badge, { replace: true }));
          expect(baking === undefined || baking instanceof DataError).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("survive a baked image with characters changed", () => {
    const baked = FIXTURE.svg.cases["clr-json"]?.baked ?? "";
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(baked.length - 1), fc.constantFrom("<", ">", "&", '"', "]", "/", "\u0000", "x")), {
          minLength: 1,
          maxLength: 3,
        }),
        (changes) => {
          let svg = baked;
          for (const [at, mark] of changes) svg = svg.slice(0, at) + mark + svg.slice(at + 1);
          const error = thrownBy(() => readSvg(svg));
          expect(error === undefined || error instanceof DataError).toBe(true);
        },
      ),
      RUNS,
    );
  });
});

describe("a credential that is baked and read again", () => {
  const credentials = fc
    .string({ unit: "binary", maxLength: 40 })
    .map((name) => ({ ...FIXTURE.credentials.badge, name }));

  it("is the same in a PNG and in an SVG, whatever its text", () => {
    fc.assert(
      fc.property(credentials, (credential) => {
        expect(readPng(bakePng(BASE, credential))).toStrictEqual({ kind: "badge", credential });
        expect(readSvg(bakeSvg(FIXTURE.svg.base, credential))).toStrictEqual({ kind: "badge", credential });
      }),
      RUNS,
    );
  });
});
