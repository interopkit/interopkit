import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { bakePng, bakeSvg, readPng, readSvg } from "@interopkit/achievement-credentials/baking";
import { SaxesParser } from "saxes";
import { expect, test } from "vitest";
import { clrOf } from "./bench-fixtures.js";
import { alternate, expectRatioWithin } from "./budgets.js";

/** The credentials of the CLR that the images hold: a record of a year, about 20 KB of JSON. */
const HELD = 20;
/** The bytes of the picture of an image of the benchmark, as a badge of 512 by 512 pixels may take. */
const PICTURE_BYTES = 262_144;

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/baking/baked-images.json", import.meta.url), "utf8")) as {
  png: { base: string };
};

/** A PNG chunk of a type and its data, with its CRC-32. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
}

/** The PNG of the fixture with a private ancillary chunk of `PICTURE_BYTES` before its IEND, which a reader skips. */
function largePng(): Uint8Array {
  const base = Uint8Array.from(Buffer.from(FIXTURE.png.base, "base64"));
  const iend = base.length - 12;
  return Uint8Array.from([
    ...base.subarray(0, iend),
    ...chunk("prVt", new Uint8Array(PICTURE_BYTES).fill(7)),
    ...base.subarray(iend),
  ]);
}

/** An SVG of a path with points enough for `PICTURE_BYTES` characters. */
function largeSvg(): string {
  const points = Array.from({ length: PICTURE_BYTES / 16 }, (_, index) => `L${index % 512} ${(index * 7) % 512} `);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path d="M0 0 ${points.join("")}Z"/></svg>`;
}

/** Parses an SVG with saxes, which the package reads the XML with, and does nothing with what it reads. */
function parseWithSaxes(svg: string): void {
  const parser = new SaxesParser({ xmlns: true });
  parser.write(svg).close();
}

test("bakes and reads a CLR in a PNG near JSON.stringify and JSON.parse of it", async ({ annotate, bench }) => {
  const clr = clrOf(HELD);
  const text = JSON.stringify(clr);
  const image = largePng();
  const baked = bakePng(image, clr);
  expect(readPng(baked)).toStrictEqual({ kind: "clr", credential: JSON.parse(text) });
  await annotate(`The image has ${image.length} bytes, and the CLR ${text.length} characters of JSON.`);
  const baking = await alternate(bench, "bakePng", () => bakePng(image, clr), {
    name: "JSON.stringify",
    run: () => JSON.stringify(clr),
  });
  await expectRatioWithin(annotate, "bakePng", "JSON.stringify of the CLR", baking);
  const reading = await alternate(bench, "readPng", () => readPng(baked), {
    name: "JSON.parse",
    run: () => JSON.parse(text),
  });
  await expectRatioWithin(annotate, "readPng", "JSON.parse of the CLR", reading);
});

test("bakes and reads a CLR in an SVG near saxes alone", async ({ annotate, bench }) => {
  const clr = clrOf(HELD);
  const image = largeSvg();
  const baked = bakeSvg(image, clr);
  expect(readSvg(baked)).toStrictEqual({ kind: "clr", credential: JSON.parse(JSON.stringify(clr)) });
  await annotate(`The image has ${image.length} characters, and the baked image ${baked.length}.`);
  const baking = await alternate(bench, "bakeSvg", () => bakeSvg(image, clr), {
    name: "saxes",
    run: () => parseWithSaxes(image),
  });
  await expectRatioWithin(annotate, "bakeSvg", "saxes over the image", baking);
  const reading = await alternate(bench, "readSvg", () => readSvg(baked), {
    name: "saxes",
    run: () => parseWithSaxes(baked),
  });
  await expectRatioWithin(annotate, "readSvg", "saxes over the baked image", reading);
});
