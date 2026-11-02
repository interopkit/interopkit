import { readFileSync } from "node:fs";
import { DataError } from "@interopkit/core";
import { describe, expect, it, vi } from "vitest";
import { bakePng, bakeSvg, readPng, readSvg } from "../src/baking/index.js";
import { crc32, DEFAULT_MAX_BYTES, MAX_SVG_ATTRIBUTES, MAX_SVG_DEPTH } from "../src/baking/internal.js";
import { HOSTILE } from "./hostile.js";

interface Case {
  readonly kind: "badge" | "clr";
  readonly credential: string | object;
  readonly baked: string;
}
interface Fixture {
  readonly credentials: { readonly badge: object; readonly clr: object };
  readonly png: {
    readonly base: string;
    readonly cases: Record<string, Case>;
    readonly replaced: { readonly image: string; readonly baked: string };
    readonly refused: Record<string, string>;
    readonly withoutCredential: Record<string, string>;
    readonly firstWins: { readonly image: string; readonly kind: string; readonly credential: object };
    readonly afterData: { readonly image: string; readonly kind: string; readonly credential: string };
  };
  readonly svg: {
    readonly base: string;
    readonly cases: Record<string, Case>;
    readonly rebound: { readonly image: string; readonly baked: string };
    readonly emptyRoot: { readonly image: string; readonly baked: string };
    readonly replaced: { readonly image: string; readonly baked: string };
    readonly otherPrefix: { readonly image: string; readonly kind: string; readonly credential: string };
  };
  readonly openBadgesV2: {
    readonly assertion: object;
    readonly signed: string;
    readonly png: Record<
      string,
      { readonly image: string; readonly kind: string; readonly credential: string | object }
    >;
    readonly pngRefused: Record<string, string>;
    readonly svg: Record<
      string,
      { readonly image: string; readonly kind: string; readonly credential: string | object }
    >;
    readonly svgRefused: Record<string, string>;
  };
}

// The fixture is written by validation/baked_images.py, which writes the PNG chunks with struct and zlib and the SVG text by
// string edits, and parses every SVG with ElementTree. Nothing here is typed by hand that an oracle can write.
const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/baking/baked-images.json", import.meta.url), "utf8"),
) as Fixture;

const bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, "base64"));
const CASES = Object.entries(FIXTURE.png.cases);
const SVG_CASES = Object.entries(FIXTURE.svg.cases);
const SVG_ROOT = '<svg xmlns="http://www.w3.org/2000/svg">';
const PARAMETERS = { badge: FIXTURE.credentials.badge, clr: FIXTURE.credentials.clr };

const TOKENS_REFUSAL = "more than the 1000000 tokens of JSON";

/**
 * Runs a call that must refuse a credential for its tokens, and shows that it did so before the only step that costs memory
 * out of proportion to the text: `JSON.parse` takes about forty times the text of small objects, and is never called.
 *
 * @returns The message of the refusal.
 */
function refusedBeforeParse(call: () => unknown): string {
  const parse = vi.spyOn(JSON, "parse");
  try {
    const error = failureOf(call);
    expect(error).toBeInstanceOf(DataError);
    expect(parse).not.toHaveBeenCalled();
    return (error as DataError).message;
  } finally {
    parse.mockRestore();
  }
}

/** Runs a call and returns what it throws. */
function failureOf(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error("The call returned.");
}

describe("the checksum of a chunk", () => {
  it("is the CRC-32 of the PNG specification", () => {
    // The check value of CRC-32 (ISO 3309, as PNG annex D): the checksum of the digits 1 to 9.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("bakePng", () => {
  it.each(CASES)("writes the chunk that the oracle writes for %s", (_name, expected) => {
    const result = bakePng(bytes(FIXTURE.png.base), expected.credential);
    expect(Buffer.from(result).toString("base64")).toBe(expected.baked);
  });

  it("replaces the credential of the other kind, and every other chunk keeps its place", () => {
    const image = bytes(FIXTURE.png.replaced.image);
    const result = bakePng(image, PARAMETERS.badge, { replace: true });
    expect(Buffer.from(result).toString("base64")).toBe(FIXTURE.png.replaced.baked);
  });

  it("writes the same bytes with replace on an image that holds none", () => {
    const [, first] = CASES[0] as [string, Case];
    expect(bakePng(bytes(FIXTURE.png.base), first.credential, { replace: true })).toStrictEqual(bytes(first.baked));
  });

  it("refuses an image that holds a credential unless the option replace says to replace it", () => {
    const error = failureOf(() => bakePng(bytes(FIXTURE.png.replaced.image), PARAMETERS.badge));
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain("replace");
    const [, baked] = CASES[0] as [string, Case];
    expect(failureOf(() => bakePng(bytes(baked.baked), PARAMETERS.clr, { replace: false }))).toBeInstanceOf(DataError);
  });

  it("changes nothing of the image it is given and returns a new array", () => {
    const image = bytes(FIXTURE.png.base);
    const before = Uint8Array.from(image);
    const result = bakePng(image, PARAMETERS.badge);
    expect(image).toStrictEqual(before);
    expect(result.buffer).not.toBe(image.buffer);
  });

  it("takes a view of a larger buffer as the image", () => {
    const image = bytes(FIXTURE.png.base);
    const padded = new Uint8Array(image.length + 16);
    padded.set(image, 8);
    expect(bakePng(padded.subarray(8, 8 + image.length), PARAMETERS.clr)).toStrictEqual(bakePng(image, PARAMETERS.clr));
  });

  it.each([
    ["not a PNG", "does not start with the eight bytes"],
    ["no IEND", "without an IEND chunk"],
    ["truncated chunk", "more than the image holds"],
    ["frame cut short", "ends inside the chunk"],
    ["chunk longer than the image", "more than the image holds"],
    ["chunk longer than a chunk may be", "more than a chunk may hold"],
    ["first chunk is not IHDR", "must be IHDR"],
  ])("refuses an image that is %s", (name, reason) => {
    const error = failureOf(() => bakePng(bytes(FIXTURE.png.refused[name] as string), PARAMETERS.badge));
    expect((error as DataError).message).toContain(reason);
  });

  it("refuses an image larger than the limit before it reads any of it", () => {
    const error = failureOf(() => bakePng(new Uint8Array(11), PARAMETERS.badge, { maxBytes: 10 }));
    expect((error as DataError).message).toBe(
      "The image has 11 bytes, more than the 10 that the option maxBytes allows.",
    );
    expect(DEFAULT_MAX_BYTES).toBe(10_485_760);
  });

  it("refuses a result that is over the limit", () => {
    const image = bytes(FIXTURE.png.base);
    const jws = FIXTURE.png.cases["badge-jws"]?.credential as string;
    const error = failureOf(() => bakePng(image, jws, { maxBytes: image.length + jws.length }));
    expect((error as DataError).message).toContain("The baked image has");
    expect(bakePng(image, jws, { maxBytes: image.length + jws.length + 100 }).length).toBeLessThanOrEqual(
      image.length + jws.length + 100,
    );
  });

  it("refuses a credential with more tokens of JSON than maxTokens, as text or as an object, before it parses or reads it", () => {
    const image = bytes(FIXTURE.png.base);
    const signed = `e30.${Buffer.from(HOSTILE).toString("base64url")}.c2ln`;
    expect(refusedBeforeParse(() => bakePng(image, signed))).toContain(TOKENS_REFUSAL);
    // A property that no class has would be the first finding of the readers, so this is the refusal of the count.
    const object = { ...PARAMETERS.badge, evidence: Array.from({ length: 400_000 }, () => []) };
    expect(refusedBeforeParse(() => bakePng(image, object))).toContain(TOKENS_REFUSAL);
    expect(refusedBeforeParse(() => bakePng(image, PARAMETERS.badge, { maxTokens: 20 }))).toContain(
      "more than the 20 tokens",
    );
    expect(bakePng(image, PARAMETERS.badge).length).toBeGreaterThan(image.length);
  });

  it("takes a long credential that stays within the limits of tokens and bytes: there is no limit of characters", () => {
    const image = bytes(FIXTURE.png.base);
    const long = { ...PARAMETERS.badge, name: "x".repeat(2_000_000) };
    const baked = bakePng(image, long);
    expect(readPng(baked)?.credential).toMatchObject({ name: long.name });
    expect(() => bakePng(image, long, { maxBytes: 1_000_000 })).toThrow("The baked image has");
  });

  it("refuses what is not a credential", () => {
    const image = bytes(FIXTURE.png.base);
    const assertion = {
      "@context": "https://w3id.org/openbadges/v2",
      type: "Assertion",
      id: "https://example.edu/a/1",
    };
    for (const credential of [
      assertion,
      {},
      { ...PARAMETERS.badge, id: 1 },
      "text",
      "a.b",
      "a..c",
      null,
      1,
      [],
      () => 1,
    ]) {
      expect(failureOf(() => bakePng(image, credential as never))).toBeInstanceOf(DataError);
    }
  });

  it("refuses a compact JWS whose payload names no credential type", () => {
    const image = bytes(FIXTURE.png.base);
    const part = (value: string) => Buffer.from(value).toString("base64url");
    for (const payload of ["not json", "[]", "{}", '{"type":1}', "[".repeat(100)]) {
      expect(failureOf(() => bakePng(image, `${part("{}")}.${part(payload)}.${part("s")}`))).toBeInstanceOf(DataError);
    }
    // A payload of one character is not base64url at all, and `_w` decodes to the byte 0xff, which is not UTF-8.
    for (const payload of ["A", "_w"]) {
      const error = failureOf(() => bakePng(image, `${part("{}")}.${payload}.${part("s")}`));
      expect((error as DataError).message).toContain("not canonical base64url text of UTF-8");
    }
  });

  it("refuses a credential that is not JSON, and one that nests too deep", () => {
    const image = bytes(FIXTURE.png.base);
    let deep: Record<string, unknown> = {};
    for (let level = 0; level < 100; level += 1) deep = { deep };
    expect(failureOf(() => bakePng(image, { ...PARAMETERS.badge, deep }))).toBeInstanceOf(DataError);
    expect(failureOf(() => bakePng(image, { ...PARAMETERS.badge, count: 1n }))).toBeInstanceOf(DataError);
  });

  it("refuses options of other types", () => {
    const image = bytes(FIXTURE.png.base);
    for (const options of [
      null,
      1,
      "replace",
      [],
      { maxBytes: "10" },
      { maxBytes: 0 },
      { maxTokens: 0 },
      { replace: "yes" },
      { other: 1 },
    ]) {
      expect(failureOf(() => bakePng(image, PARAMETERS.badge, options as never))).toBeInstanceOf(DataError);
    }
    for (const image of [null, "png", [], new ArrayBuffer(8), undefined]) {
      expect(failureOf(() => bakePng(image as never, PARAMETERS.badge))).toBeInstanceOf(DataError);
    }
  });
});

describe("readPng", () => {
  it.each(CASES)("reads %s as the oracle wrote it", (_name, expected) => {
    expect(readPng(bytes(expected.baked))).toStrictEqual({ kind: expected.kind, credential: expected.credential });
  });

  it("reads what bakePng wrote", () => {
    for (const [, expected] of CASES) {
      const baked = bakePng(bytes(FIXTURE.png.base), expected.credential);
      expect(readPng(baked)).toStrictEqual({ kind: expected.kind, credential: expected.credential });
    }
  });

  it("reads the first credential chunk, wherever it is", () => {
    const { image, kind, credential } = FIXTURE.png.firstWins;
    expect(readPng(bytes(image))).toStrictEqual({ kind, credential });
    const after = FIXTURE.png.afterData;
    expect(readPng(bytes(after.image))).toStrictEqual({ kind: after.kind, credential: after.credential });
  });

  it("gives undefined for an image without a credential, and for a chunk that only looks like one", () => {
    expect(readPng(bytes(FIXTURE.png.base))).toBeUndefined();
    for (const image of Object.values(FIXTURE.png.withoutCredential)) expect(readPng(bytes(image))).toBeUndefined();
  });

  it.each(Object.entries(FIXTURE.png.refused))("refuses an image with %s", (_name, image) => {
    expect(failureOf(() => readPng(bytes(image)))).toBeInstanceOf(DataError);
  });

  it("refuses a chunk that claims more than the image holds, and one that claims more than a chunk may hold", () => {
    const message = (name: string) =>
      (failureOf(() => readPng(bytes(FIXTURE.png.refused[name] as string))) as DataError).message;
    expect(message("chunk longer than the image")).toContain("more than the image holds");
    expect(message("chunk longer than a chunk may be")).toContain("more than a chunk may hold");
    expect(message("first chunk is not IHDR")).toContain("must be IHDR");
  });

  it("names the fault of a damaged or compressed chunk", () => {
    const message = (name: string) =>
      (failureOf(() => readPng(bytes(FIXTURE.png.refused[name] as string))) as DataError).message;
    expect(message("bad crc")).toContain("fails its CRC-32");
    expect(message("compressed")).toContain("forbid compression");
    expect(message("compression method")).toContain("forbid compression");
    expect(message("text that is not UTF-8")).toContain("not UTF-8");
    expect(message("no language tag")).toContain("language tag");
  });

  it("refuses a credential chunk with more tokens of JSON than maxTokens before it parses it", () => {
    const keyword = new TextEncoder().encode("openbadgecredential");
    const json = new TextEncoder().encode(`{"a":${HOSTILE}}`);
    const text = new Uint8Array(keyword.length + 5 + json.length);
    text.set(keyword);
    text.set(json, keyword.length + 5);
    const chunk = new Uint8Array(12 + text.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, text.length);
    chunk.set(new TextEncoder().encode("iTXt"), 4);
    chunk.set(text, 8);
    view.setUint32(8 + text.length, crc32(chunk.subarray(4, 8 + text.length)));
    const base = bytes(FIXTURE.png.base);
    const image = new Uint8Array([...base.subarray(0, 33), ...chunk, ...base.subarray(33)]);
    expect(refusedBeforeParse(() => readPng(image))).toContain(TOKENS_REFUSAL);
    expect(refusedBeforeParse(() => readPng(image, { maxTokens: 100 }))).toContain("more than the 100 tokens");
    // The option raises the limit, and what the image holds is then parsed as it is.
    expect(readPng(image, { maxTokens: 2_000_000 })).toMatchObject({ kind: "badge" });
  });

  it("refuses an image larger than the limit before it reads any of it", () => {
    const image = bytes(FIXTURE.png.base);
    expect((failureOf(() => readPng(image, { maxBytes: image.length - 1 })) as DataError).message).toContain(
      "maxBytes",
    );
    expect(readPng(image, { maxBytes: image.length })).toBeUndefined();
    expect(failureOf(() => readPng(new Uint8Array(11), { maxBytes: 10 }))).toBeInstanceOf(DataError);
  });

  it("refuses options and images of other types", () => {
    for (const options of [null, 1, { maxBytes: -1 }, { maxTokens: 1.5 }, { replace: true }]) {
      expect(failureOf(() => readPng(bytes(FIXTURE.png.base), options as never))).toBeInstanceOf(DataError);
    }
    for (const image of [null, "png", [], new ArrayBuffer(8)]) {
      expect(failureOf(() => readPng(image as never))).toBeInstanceOf(DataError);
    }
  });
});

describe("bakeSvg", () => {
  it.each(SVG_CASES)("writes the element that the oracle writes for %s", (_name, expected) => {
    expect(bakeSvg(FIXTURE.svg.base, expected.credential)).toBe(expected.baked);
  });

  it.each(["rebound", "emptyRoot", "replaced"] as const)("writes what the oracle writes for the %s image", (name) => {
    const { image, baked } = FIXTURE.svg[name];
    expect(bakeSvg(image, PARAMETERS.badge, { replace: true })).toBe(baked);
  });

  it("refuses an image that holds a credential unless the option replace says to replace it", () => {
    const error = failureOf(() => bakeSvg(FIXTURE.svg.replaced.image, PARAMETERS.badge));
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain("replace");
  });

  it("splits a CDATA end marker and escapes the marks that XML forbids", () => {
    const credential = { ...PARAMETERS.badge, name: "a ]]> b ￾ ￿ c" };
    const baked = bakeSvg(FIXTURE.svg.base, credential);
    expect(baked).toContain("a ]]]]><![CDATA[> b \\ufffe \\uffff c");
    expect(readSvg(baked)).toStrictEqual({ kind: "badge", credential });
  });

  it("keeps what comes before and after, including characters outside the first plane", () => {
    const before = `<?xml version="1.0"?>\n<!-- ${"\u{1f600}".repeat(40_000)} -->\n`;
    const svg = `${before}${SVG_ROOT}<g/></svg>\n<!-- ${"é".repeat(30)} -->`;
    const baked = bakeSvg(svg, PARAMETERS.clr);
    expect(baked.startsWith(before)).toBe(true);
    expect(baked.endsWith(`<g/></svg>\n<!-- ${"é".repeat(30)} -->`)).toBe(true);
    const replaced = bakeSvg(baked, PARAMETERS.badge, { replace: true });
    expect(replaced.startsWith(before)).toBe(true);
    expect(replaced).not.toContain("clr:credential");
    expect(readSvg(replaced)?.kind).toBe("badge");
  });

  it("refuses an image that is not an SVG or is not well-formed", () => {
    for (const svg of [
      "",
      "text",
      "<svg>",
      "<svg></svg><svg/>",
      '<svg xmlns:a="u"><a:b></svg>',
      "<html/>",
      `<svg xmlns="urn:other"/>`,
    ]) {
      expect(failureOf(() => bakeSvg(svg, PARAMETERS.badge))).toBeInstanceOf(DataError);
    }
  });

  it("refuses an image larger than the limit, and a result that is over it", () => {
    const error = failureOf(() => bakeSvg(FIXTURE.svg.base, PARAMETERS.badge, { maxBytes: 10 }));
    expect((error as DataError).message).toContain("The image has");
    const over = failureOf(() =>
      bakeSvg(FIXTURE.svg.base, PARAMETERS.badge, { maxBytes: JSON.stringify(PARAMETERS.badge).length + 10 }),
    );
    expect((over as DataError).message).toContain("The baked image has");
  });

  it("counts the bytes of an image and not its characters", () => {
    const svg = `${SVG_ROOT}<!-- ${"é".repeat(100)} --></svg>`;
    const bytesOfSvg = new TextEncoder().encode(svg).length;
    expect(failureOf(() => bakeSvg(svg, PARAMETERS.badge, { maxBytes: bytesOfSvg - 1 }))).toBeInstanceOf(DataError);
    const wide = `${SVG_ROOT}<!-- ${"世".repeat(100)} --></svg>`;
    expect(failureOf(() => readSvg(wide, { maxBytes: 300 }))).toBeInstanceOf(DataError);
    expect(readSvg(wide, { maxBytes: 3 * wide.length })).toBeUndefined();
    const pairs = `${SVG_ROOT}<!-- ${"\u{1f600}".repeat(100)} --></svg>`;
    expect(failureOf(() => readSvg(pairs, { maxBytes: 400 }))).toBeInstanceOf(DataError);
  });

  it("refuses what is not a credential, options and images of other types", () => {
    for (const credential of [{}, "text", null, 1, []]) {
      expect(failureOf(() => bakeSvg(FIXTURE.svg.base, credential as never))).toBeInstanceOf(DataError);
    }
    for (const options of [null, 1, { replace: 1 }, { maxBytes: 1.5 }, { more: true }]) {
      expect(failureOf(() => bakeSvg(FIXTURE.svg.base, PARAMETERS.badge, options as never))).toBeInstanceOf(DataError);
    }
    for (const svg of [null, 1, [], new Uint8Array(4)]) {
      expect(failureOf(() => bakeSvg(svg as never, PARAMETERS.badge))).toBeInstanceOf(DataError);
    }
  });
});

describe("readSvg", () => {
  it.each(SVG_CASES)("reads %s as the oracle wrote it", (_name, expected) => {
    expect(readSvg(expected.baked)).toStrictEqual({ kind: expected.kind, credential: expected.credential });
  });

  it("reads an element with any prefix, even one that is self-closing", () => {
    const { image, kind, credential } = FIXTURE.svg.otherPrefix;
    expect(readSvg(image)).toStrictEqual({ kind, credential });
  });

  it("gives undefined for an image without a credential, and for an element in another namespace", () => {
    expect(readSvg(FIXTURE.svg.base)).toBeUndefined();
    const other = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:o="urn:other"><o:credential verify="a.b.c"/></svg>`;
    expect(readSvg(other)).toBeUndefined();
  });

  it("reads the first credential and nothing after it", () => {
    const first = FIXTURE.svg.cases["badge-jws"] as Case;
    const malformed = first.baked.replace("</svg>", "<unclosed></svg>");
    expect(readSvg(malformed)).toStrictEqual({ kind: "badge", credential: first.credential });
    const twice = first.baked.replace(
      "</svg>",
      `<clr:credential xmlns:clr="https://purl.imsglobal.org/clr/v2p0" verify="x.y.z"/></svg>`,
    );
    expect(readSvg(twice)?.kind).toBe("badge");
  });

  it("reads a credential that comes after the first chunk of text that the parser takes", () => {
    const padding = "<!-- x -->".repeat(20_000);
    const svg = `${SVG_ROOT}${padding}<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0" verify="a.b.c"/></svg>`;
    expect(readSvg(svg)).toStrictEqual({ kind: "badge", credential: "a.b.c" });
  });

  it("refuses an image that is not well-formed before the credential", () => {
    for (const svg of [
      "",
      "text",
      "<svg><a></svg>",
      "<svg><o:c/></svg>",
      "<!DOCTYPE s [<!ENTITY x 'y'>]><s>&x;</s>",
      "<svg a='1' a='2'/>",
    ]) {
      expect(failureOf(() => readSvg(svg))).toBeInstanceOf(DataError);
    }
  });

  it.each([
    [
      "has a verify attribute and text",
      `<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0" verify="a.b.c">{}</o:credential>`,
    ],
    ["is empty", `<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0"/>`],
    ["holds an element", `<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0"><g/></o:credential>`],
    [
      "has a verify attribute that is not a JWS",
      `<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0" verify="{}"/>`,
    ],
    ["holds a JWS and not JSON", `<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0">a.b.c</o:credential>`],
    ["holds JSON that is not valid", `<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0">{"a":</o:credential>`],
    [
      "holds JSON that is not an object",
      `<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0">[1,2]</o:credential>`,
    ],
    [
      "holds JSON that nests too deep",
      `<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0">${"[".repeat(100)}</o:credential>`,
    ],
  ])("refuses a credential element that %s", (_name, element) => {
    expect(failureOf(() => readSvg(`${SVG_ROOT}${element}</svg>`))).toBeInstanceOf(DataError);
  });

  it("refuses an image that nests more elements than the limit, before it builds them", () => {
    const nested = (levels: number) => `${"<g>".repeat(levels)}${"</g>".repeat(levels)}`;
    expect(readSvg(`${SVG_ROOT}${nested(MAX_SVG_DEPTH - 1)}</svg>`)).toBeUndefined();
    const error = failureOf(() => readSvg(`${SVG_ROOT}${nested(MAX_SVG_DEPTH)}</svg>`));
    expect((error as DataError).message).toContain(`nests more than ${MAX_SVG_DEPTH} elements`);
    expect(failureOf(() => readSvg(`${SVG_ROOT}${"<g>".repeat(200_000)}`))).toBeInstanceOf(DataError);
  });

  it("refuses an element with more attributes than the limit, before the tag ends", () => {
    const tag = (count: number) => `<g ${Array.from({ length: count }, (_, at) => `a${at}="1"`).join(" ")}/>`;
    expect(readSvg(`${SVG_ROOT}${tag(MAX_SVG_ATTRIBUTES - 1)}</svg>`)).toBeUndefined();
    const error = failureOf(() => readSvg(`${SVG_ROOT}${tag(MAX_SVG_ATTRIBUTES + 1)}</svg>`));
    expect((error as DataError).message).toContain(`more than ${MAX_SVG_ATTRIBUTES} attributes`);
    expect(
      failureOf(() => readSvg(`${SVG_ROOT}<g ${Array.from({ length: 300_000 }, (_, at) => `a${at}=""`).join(" ")}`)),
    ).toBeInstanceOf(DataError);
  });

  it("refuses a credential element with more tokens of JSON than maxTokens before it parses it", () => {
    const element = (body: string) =>
      `${SVG_ROOT}<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0">${body}</o:credential></svg>`;
    const json = `{"a":${HOSTILE}}`;
    expect(refusedBeforeParse(() => readSvg(element(`<![CDATA[${json}]]>`)))).toContain(TOKENS_REFUSAL);
    expect(refusedBeforeParse(() => readSvg(element(json)))).toContain(TOKENS_REFUSAL);
    expect(refusedBeforeParse(() => readSvg(element(json), { maxTokens: 100 }))).toContain("more than the 100 tokens");
  });

  it("refuses a credential element that nests deeper than the limit before it parses it", () => {
    const deep = `{"a":${"[".repeat(150_000)}${"]".repeat(150_000)}}`;
    const svg = `${SVG_ROOT}<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0">${deep}</o:credential></svg>`;
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect((failureOf(() => readSvg(svg)) as DataError).message).toContain("nests more than 64 levels");
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("does not parse the compact JWS of a verify attribute, so that only the bytes of the image bound it", () => {
    const attribute = `${SVG_ROOT}<o:credential xmlns:o="https://purl.imsglobal.org/ob/v3p0" verify="a.${"b".repeat(3_000_000)}.c"/></svg>`;
    expect(readSvg(attribute)).toMatchObject({ kind: "badge" });
    expect((failureOf(() => readSvg(attribute, { maxBytes: 1_000_000 })) as DataError).message).toContain("maxBytes");
  });

  it("refuses an image larger than the limit before it parses any of it", () => {
    const error = failureOf(() => readSvg("<<<<<<<<<<<", { maxBytes: 10 }));
    expect((error as DataError).message).toBe(
      "The image has 11 bytes, more than the 10 that the option maxBytes allows.",
    );
  });

  it("refuses options and images of other types", () => {
    for (const options of [null, 1, { maxBytes: "1" }, { maxTokens: 0 }, { maxTokens: "9" }, { replace: true }]) {
      expect(failureOf(() => readSvg(FIXTURE.svg.base, options as never))).toBeInstanceOf(DataError);
    }
    for (const svg of [null, 1, [], new Uint8Array(4)]) {
      expect(failureOf(() => readSvg(svg as never))).toBeInstanceOf(DataError);
    }
  });
});

describe("Open Badges 2.0 in images", () => {
  const V2 = FIXTURE.openBadgesV2;

  it.each(Object.entries(V2.png))("reads from a PNG %s", (_name, { image, kind, credential }) => {
    expect(readPng(bytes(image))).toStrictEqual({ kind, credential });
  });

  it.each(Object.entries(V2.svg))("reads from an SVG %s", (_name, { image, kind, credential }) => {
    expect(readSvg(image)).toStrictEqual({ kind, credential });
  });

  it.each(Object.entries(V2.pngRefused))("refuses a PNG with %s", (_name, image) => {
    expect(failureOf(() => readPng(bytes(image)))).toBeInstanceOf(DataError);
  });

  it.each(Object.entries(V2.svgRefused))("refuses an SVG with %s", (_name, image) => {
    expect((failureOf(() => readSvg(image)) as DataError).message).toBe(
      "The assertion element of the SVG holds no assertion: no body, and no verify attribute.",
    );
  });

  it("never bakes a 2.0 assertion, as JSON, as a BadgeAssertionV2 or in a compact JWS", () => {
    const refusal =
      "The credential is an Open Badges 2.0 assertion, which is read and never baked: bake a credential of Open Badges 3.0 or CLR 2.0.";
    const model = { version: "2.0", assertion: {}, badge: {}, issuer: {} };
    for (const credential of [V2.assertion, model, V2.signed]) {
      expect((failureOf(() => bakePng(bytes(FIXTURE.png.base), credential)) as DataError).message).toBe(refusal);
      expect((failureOf(() => bakeSvg(FIXTURE.svg.base, credential)) as DataError).message).toBe(refusal);
    }
  });

  it("bakes a credential of 3.0 into an image that holds a 2.0 assertion, which a reader then finds after it", () => {
    const image = bytes(V2.png["a legacy tEXt chunk with the address of a hosted assertion"]?.image ?? "");
    expect(readPng(bakePng(image, PARAMETERS.badge))).toStrictEqual({ kind: "badge", credential: PARAMETERS.badge });
  });
});
