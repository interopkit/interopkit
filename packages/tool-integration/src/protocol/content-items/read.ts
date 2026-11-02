import { jsonObjectSchema, looseRecord, parseWith, positiveIntegerSchema, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  BOOLEAN,
  DATE_TIME,
  extensionsOf,
  HTTPS_URL,
  NON_EMPTY_STRING,
  NULLABLE_STRING,
  OPTIONAL_TEXT,
  POSITIVE_NUMBER,
  STRING,
  STRING_RECORD,
  submissionReviewSchema,
} from "../claims/index.js";
import type {
  ContentItem,
  FileItem,
  HtmlItem,
  ImageItem,
  LinkItem,
  LtiResourceLinkItem,
  OtherContentItem,
} from "./model.js";

const SIZE = v.optional(positiveIntegerSchema);
const imageSchema = v.pipe(
  looseRecord({ url: HTTPS_URL, width: SIZE, height: SIZE }),
  v.transform(({ url, width, height }) => ({ url, width, height })),
);
const windowSchema = v.pipe(
  looseRecord({ targetName: v.optional(STRING), width: SIZE, height: SIZE, windowFeatures: v.optional(STRING) }),
  v.transform(({ targetName, width, height, windowFeatures }) => ({ targetName, width, height, windowFeatures })),
);
const periodSchema = v.pipe(
  looseRecord({ startDateTime: v.optional(DATE_TIME), endDateTime: v.optional(DATE_TIME) }),
  v.transform(({ startDateTime, endDateTime }) => ({ startDateTime, endDateTime })),
);
const lineItemSchema = v.pipe(
  looseRecord({
    scoreMaximum: POSITIVE_NUMBER,
    label: OPTIONAL_TEXT,
    resourceId: OPTIONAL_TEXT,
    tag: OPTIONAL_TEXT,
    gradesReleased: v.optional(BOOLEAN),
    submissionReview: v.optional(submissionReviewSchema),
  }),
  v.transform(({ scoreMaximum, label, resourceId, tag, gradesReleased, submissionReview }) => ({
    scoreMaximum,
    label,
    resourceId,
    tag,
    gradesReleased,
    submissionReview,
  })),
);

/** The properties that every known type has. */
const base = { title: NULLABLE_STRING, text: NULLABLE_STRING };

const linkSchema = v.pipe(
  looseRecord({
    type: v.literal("link"),
    url: HTTPS_URL,
    ...base,
    icon: v.optional(imageSchema),
    thumbnail: v.optional(imageSchema),
    embed: v.optional(
      v.pipe(
        looseRecord({ html: STRING }),
        v.transform(({ html }) => ({ html })),
      ),
    ),
    window: v.optional(windowSchema),
    iframe: v.optional(
      v.pipe(
        looseRecord({ src: HTTPS_URL, width: SIZE, height: SIZE }),
        v.transform(({ src, width, height }) => ({ src, width, height })),
      ),
    ),
  }),
  v.transform(
    (item): LinkItem => ({
      type: item.type,
      url: item.url,
      title: item.title,
      text: item.text,
      icon: item.icon,
      thumbnail: item.thumbnail,
      embed: item.embed,
      window: item.window,
      iframe: item.iframe,
      extensions: extensionsOf(item),
    }),
  ),
);

const ltiResourceLinkSchema = v.pipe(
  looseRecord({
    type: v.literal("ltiResourceLink"),
    url: v.optional(HTTPS_URL),
    ...base,
    icon: v.optional(imageSchema),
    thumbnail: v.optional(imageSchema),
    window: v.optional(windowSchema),
    iframe: v.optional(
      v.pipe(
        looseRecord({ width: SIZE, height: SIZE }),
        v.transform(({ width, height }) => ({ width, height })),
      ),
    ),
    custom: v.optional(STRING_RECORD),
    lineItem: v.optional(lineItemSchema),
    available: v.optional(periodSchema),
    submission: v.optional(periodSchema),
  }),
  v.transform(
    (item): LtiResourceLinkItem => ({
      type: item.type,
      url: item.url,
      title: item.title,
      text: item.text,
      icon: item.icon,
      thumbnail: item.thumbnail,
      window: item.window,
      iframe: item.iframe,
      custom: item.custom,
      lineItem: item.lineItem,
      available: item.available,
      submission: item.submission,
      extensions: extensionsOf(item),
    }),
  ),
);

const fileSchema = v.pipe(
  looseRecord({
    type: v.literal("file"),
    url: HTTPS_URL,
    ...base,
    icon: v.optional(imageSchema),
    thumbnail: v.optional(imageSchema),
    expiresAt: v.optional(DATE_TIME),
    mediaType: v.optional(NON_EMPTY_STRING),
  }),
  v.transform(
    (item): FileItem => ({
      type: item.type,
      url: item.url,
      title: item.title,
      text: item.text,
      icon: item.icon,
      thumbnail: item.thumbnail,
      expiresAt: item.expiresAt,
      mediaType: item.mediaType,
      extensions: extensionsOf(item),
    }),
  ),
);

const htmlSchema = v.pipe(
  looseRecord({ type: v.literal("html"), html: STRING, ...base }),
  v.transform(
    (item): HtmlItem => ({
      type: item.type,
      html: item.html,
      title: item.title,
      text: item.text,
      extensions: extensionsOf(item),
    }),
  ),
);

const imageItemSchema = v.pipe(
  looseRecord({
    type: v.literal("image"),
    url: HTTPS_URL,
    ...base,
    icon: v.optional(imageSchema),
    thumbnail: v.optional(imageSchema),
    width: SIZE,
    height: SIZE,
  }),
  v.transform(
    (item): ImageItem => ({
      type: item.type,
      url: item.url,
      title: item.title,
      text: item.text,
      icon: item.icon,
      thumbnail: item.thumbnail,
      width: item.width,
      height: item.height,
      extensions: extensionsOf(item),
    }),
  ),
);

/** An item of a type that Deep Linking does not define: every other property is kept as JSON. */
const otherSchema = v.pipe(
  jsonObjectSchema,
  v.transform((item): OtherContentItem => {
    const { type, ...properties } = item;
    return { type: String(type), properties };
  }),
);

const KNOWN: ReadonlyMap<string, Schema<ContentItem>> = new Map<string, Schema<ContentItem>>([
  ["link", linkSchema],
  ["ltiResourceLink", ltiResourceLinkSchema],
  ["file", fileSchema],
  ["html", htmlSchema],
  ["image", imageItemSchema],
]);

/**
 * Reads an item of a Deep Linking response by its `type`: the five types that Deep Linking defines with their properties, and
 * any other type as an `OtherContentItem` that keeps its properties as JSON. Properties of a known type that the model does not
 * name are ignored, except those named by a URL, which are its extensions.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` that names the path of the first invalid member, or says the item has no `type`.
 */
export function readContentItem(value: unknown): ContentItem {
  const { type } = parseWith(looseRecord({ type: NON_EMPTY_STRING }), value, "The content item");
  return parseWith(KNOWN.get(type) ?? otherSchema, value, `The content item of type ${JSON.stringify(type)}`);
}
