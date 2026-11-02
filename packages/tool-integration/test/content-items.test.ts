// biome-ignore-all lint/style/useNamingConvention: the custom properties of an item are named by the tool, here as the specification names them.

import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CONTENT_ITEM_TYPES, type ContentItem } from "../src/index.js";
import { readContentItem, writeContentItem } from "../src/protocol/internal.js";
import { FUZZ, fuzzJson } from "./fuzz.js";
import { expectRefusesOtherTypes, plainJson } from "./services.js";

const ICON = { url: "https://lti.example.com/image.jpg", width: 100, height: 100 };

/** One valid item of each type, with every property that Deep Linking 2.0 section 3 gives it, from the tables of the sections. */
const items = {
  link: {
    type: "link",
    url: "https://something.example.com/page.html",
    title: "My Home Page",
    text: "About it",
    icon: ICON,
    thumbnail: { url: "https://lti.example.com/thumb.jpg", width: 90, height: 90 },
    embed: { html: "<iframe></iframe>" },
    window: { targetName: "w", width: 1, height: 2, windowFeatures: "menubar=no" },
    iframe: { src: "https://www.example.com/embed/1", width: 560, height: 315 },
  },
  ltiResourceLink: {
    type: "ltiResourceLink",
    url: "https://lti.example.com/launchMe",
    title: "A title",
    text: "A graded activity",
    icon: ICON,
    thumbnail: ICON,
    window: { targetName: "examplePublisherContent" },
    iframe: { height: 890 },
    custom: { quiz_id: "az-123", duedate: "$ResourceLink.submission.endDateTime" },
    lineItem: {
      scoreMaximum: 87,
      label: "Chapter 12 quiz",
      resourceId: "xyzpdq1234",
      tag: "originality",
      gradesReleased: true,
      submissionReview: { label: "Review" },
    },
    available: { startDateTime: "2018-02-06T20:05:02Z", endDateTime: "2018-03-07T20:05:02Z" },
    submission: { endDateTime: "2018-03-06T20:05:02Z" },
  },
  file: {
    type: "file",
    url: "https://my.example.com/assignment1.pdf",
    title: "A file",
    text: "t",
    icon: ICON,
    thumbnail: ICON,
    expiresAt: "2018-03-06T20:05:02Z",
    mediaType: "application/pdf",
  },
  html: { type: "html", html: "<h1>A Custom Title</h1>", title: "t", text: "x" },
  image: {
    type: "image",
    url: "https://www.example.com/image.png",
    title: "t",
    text: "x",
    icon: ICON,
    thumbnail: ICON,
    width: 10,
    height: 20,
  },
} as const;

describe("a content item", () => {
  it("of each of the five types is read with every property of its table, and written as it is read", () => {
    expect(Object.keys(items)).toEqual([...CONTENT_ITEM_TYPES]);
    for (const [type, item] of Object.entries(items)) {
      const read = readContentItem(item);
      expect(read.type, type).toBe(type);
      expect(JSON.parse(JSON.stringify(writeContentItem(read))), type).toEqual(item);
    }
    const lti = readContentItem(items.ltiResourceLink);
    expect(lti).toMatchObject({
      custom: new Map([
        ["quiz_id", "az-123"],
        ["duedate", "$ResourceLink.submission.endDateTime"],
      ]),
    });
  });

  it("keeps the extensions of a type, named by a URL, and ignores other unknown properties", () => {
    const extended = {
      ...items.image,
      "https://www.example.com/resourceMetadata": { license: "CCBY4.0" },
      vendor: "x",
    };
    const read = readContentItem(extended);
    expect(read).toMatchObject({ extensions: { "https://www.example.com/resourceMetadata": { license: "CCBY4.0" } } });
    expect(writeContentItem(read)).toEqual({
      ...items.image,
      "https://www.example.com/resourceMetadata": { license: "CCBY4.0" },
    });
    expect(() => writeContentItem({ ...(read as ContentItem & { type: "image" }), extensions: { vendor: 1 } })).toThrow(
      DataError,
    );
    expect(() =>
      writeContentItem({
        ...(read as ContentItem & { type: "image" }),
        extensions: { "https://x.example/": 1, url: 2 },
      }),
    ).toThrow(DataError);
  });

  it("of another type keeps its properties as JSON, and is written only with a type that is a URL", () => {
    const other = { type: "https://www.example.com/custom_type", data: "somedata", nested: { a: [1, null] } };
    const read = readContentItem(other);
    expect(read).toEqual({ type: other.type, properties: { data: "somedata", nested: { a: [1, null] } } });
    expect(writeContentItem(read)).toEqual(other);
    for (const type of ["custom", "link", "urn:x:y", ""]) {
      expect(() => writeContentItem({ type, properties: {} }), type).toThrow(DataError);
    }
    expect(() => writeContentItem({ type: other.type, properties: { type: "x" } })).toThrow(DataError);
    expect(readContentItem({ type: "custom" })).toEqual({ type: "custom", properties: {} });
  });

  it("is refused when it breaks a rule of Deep Linking 2.0 section 3", () => {
    const refusals: readonly (readonly [string, unknown])[] = [
      ["no type", { url: "https://x.example/" }],
      ["a type that is a number", { type: 5, url: "https://x.example/" }],
      ["a link without a url", { type: "link" }],
      ["a link whose url is http", { type: "link", url: "http://x.example/" }],
      ["a link whose iframe has no src", { type: "link", url: "https://x.example/", iframe: { width: 1 } }],
      ["a link whose embed has no html", { type: "link", url: "https://x.example/", embed: {} }],
      ["a file without a url", { type: "file" }],
      [
        "a file that expires without a zone",
        { type: "file", url: "https://x.example/", expiresAt: "2018-03-06T20:05:02" },
      ],
      ["an html item without html", { type: "html" }],
      ["an image without a url", { type: "image" }],
      ["an image of a width that is a string", { type: "image", url: "https://x.example/", width: "1" }],
      ["an icon without a url", { type: "image", url: "https://x.example/", icon: { width: 1 } }],
      [
        "an icon of a width of 0",
        { type: "image", url: "https://x.example/", icon: { url: "https://x.example/i", width: 0 } },
      ],
      ["a resource link whose url is http", { type: "ltiResourceLink", url: "http://x.example/" }],
      ["a resource link whose custom holds a number", { type: "ltiResourceLink", custom: { a: 1 } }],
      ["a line item without a scoreMaximum", { type: "ltiResourceLink", lineItem: { label: "x" } }],
      ["a line item whose scoreMaximum is 0", { type: "ltiResourceLink", lineItem: { scoreMaximum: 0 } }],
      [
        "an availability that starts without a zone",
        { type: "ltiResourceLink", available: { startDateTime: "2018-02-06T20:05:02" } },
      ],
      ["a submission that ends in a number", { type: "ltiResourceLink", submission: { endDateTime: 5 } }],
    ];
    for (const [name, item] of refusals) expect(() => readContentItem(item), name).toThrow(DataError);
    expectRefusesOtherTypes(readContentItem);
  });

  it("is written only when its addresses are https and its line item has a scoreMaximum above 0", () => {
    const refusals: readonly (readonly [string, ContentItem])[] = [
      ["a link that is http", { type: "link", url: "http://x.example/" }],
      [
        "a link whose iframe is http",
        { type: "link", url: "https://x.example/", iframe: { src: "http://x.example/" } },
      ],
      ["a resource link that is http", { type: "ltiResourceLink", url: "http://x.example/" }],
      ["a file that is http", { type: "file", url: "http://x.example/" }],
      ["an image that is http", { type: "image", url: "http://x.example/" }],
      ["an icon that is http", { type: "image", url: "https://x.example/", icon: { url: "http://x.example/" } }],
      ["a line item of 0", { type: "ltiResourceLink", lineItem: { scoreMaximum: 0 } }],
      [
        "a submission review that is http",
        { type: "ltiResourceLink", lineItem: { scoreMaximum: 1, submissionReview: { url: "http://x.example/" } } },
      ],
    ];
    for (const [name, item] of refusals) expect(() => writeContentItem(item), name).toThrow(DataError);
    expect(writeContentItem({ type: "html", html: "<p>x</p>" })).toEqual({ type: "html", html: "<p>x</p>" });
  });
});

describe("the content items", () => {
  const text = fc.string({ minLength: 1, maxLength: 8 });
  const url = text.map((path) => `https://example.com/${encodeURIComponent(path)}`);
  const some = <TValue>(value: fc.Arbitrary<TValue>) => fc.option(value, { nil: undefined });
  const size = some(fc.integer({ min: 1, max: 5000 }));
  const image = fc.record({ url, width: size, height: size });
  const zoned = fc
    .date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true })
    .map((date) => date.toISOString());
  const period = fc.record({ startDateTime: some(zoned), endDateTime: some(zoned) });
  const extensions = some(fc.dictionary(url, plainJson, { minKeys: 1, maxKeys: 2 }));
  const window = fc.record({ targetName: some(text), width: size, height: size, windowFeatures: some(text) });
  const any = fc.oneof<fc.Arbitrary<ContentItem>[]>(
    fc.record({
      type: fc.constant("link" as const),
      url,
      title: some(text),
      text: some(text),
      icon: some(image),
      thumbnail: some(image),
      embed: some(fc.record({ html: text })),
      window: some(window),
      iframe: some(fc.record({ src: url, width: size, height: size })),
      extensions,
    }),
    fc.record({
      type: fc.constant("ltiResourceLink" as const),
      url: some(url),
      title: some(text),
      text: some(text),
      icon: some(image),
      thumbnail: some(image),
      window: some(window),
      iframe: some(fc.record({ width: size, height: size })),
      custom: some(fc.dictionary(text, text, { maxKeys: 2 }).map((entries) => new Map(Object.entries(entries)))),
      lineItem: some(
        fc.record({
          scoreMaximum: fc.double({ min: 0.001, max: 1e6, noNaN: true }),
          label: some(text),
          resourceId: some(text),
          tag: some(text),
          gradesReleased: some(fc.boolean()),
          submissionReview: some(fc.record({ label: some(text), url: some(url), custom: fc.constant(undefined) })),
        }),
      ),
      available: some(period),
      submission: some(period),
      extensions,
    }),
    fc.record({
      type: fc.constant("file" as const),
      url,
      title: some(text),
      text: some(text),
      icon: some(image),
      thumbnail: some(image),
      expiresAt: some(zoned),
      mediaType: some(text),
      extensions,
    }),
    fc.record({ type: fc.constant("html" as const), html: text, title: some(text), text: some(text), extensions }),
    fc.record({
      type: fc.constant("image" as const),
      url,
      title: some(text),
      text: some(text),
      icon: some(image),
      thumbnail: some(image),
      width: size,
      height: size,
      extensions,
    }),
    fc.record({
      type: url.filter((value) => !CONTENT_ITEM_TYPES.some((known) => known === value)),
      properties: fc.dictionary(
        text.filter((key) => key !== "type"),
        plainJson,
        { maxKeys: 3 },
      ),
    }),
  );

  it("read back what was written, for any item of any type", () => {
    fc.assert(
      fc.property(any, (item) => {
        expect(
          readContentItem(
            JSON.parse(
              JSON.stringify(writeContentItem(item), (_, member) =>
                member instanceof Map ? Object.fromEntries(member) : member,
              ),
            ),
          ),
        ).toEqual(item);
      }),
      FUZZ,
    );
  });

  it("return a value or throw a DataError for any JSON, and for the examples with any value replaced", () => {
    fuzzJson(readContentItem, Object.values(items));
  });
});
