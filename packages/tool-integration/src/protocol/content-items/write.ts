import { DataError } from "@interopkit/core";
import { checkHttpsUrl, describe, type JsonValue } from "@interopkit/core/checks";
import { compact, isExtensionName, writeExtensions, writeSubmissionReview } from "../claims/index.js";
import {
  CONTENT_ITEM_TYPES,
  type ContentItem,
  type ItemImage,
  type ItemLineItem,
  type ItemWindow,
  type LinkItem,
  type LtiResourceLinkItem,
} from "./model.js";

const COMMON = ["type", "url", "title", "text", "icon", "thumbnail"];
const MEMBERS: Readonly<Record<string, readonly string[]>> = {
  link: [...COMMON, "embed", "window", "iframe"],
  ltiResourceLink: [...COMMON, "window", "iframe", "custom", "lineItem", "available", "submission"],
  file: [...COMMON, "expiresAt", "mediaType"],
  html: ["type", "html", "title", "text"],
  image: [...COMMON, "width", "height"],
};

function writeImage(image: ItemImage | undefined): Record<string, JsonValue> | undefined {
  if (image === undefined) return undefined;
  checkHttpsUrl(image.url, "The URL of the image of a content item");
  return compact({ ...image });
}

function writeWindow(window: ItemWindow | undefined): Record<string, JsonValue> | undefined {
  return window && compact({ ...window });
}

function writeLineItem(lineItem: ItemLineItem | undefined): Record<string, JsonValue> | undefined {
  if (lineItem === undefined) return undefined;
  if (!(Number.isFinite(lineItem.scoreMaximum) && lineItem.scoreMaximum > 0)) {
    throw new DataError(
      `The scoreMaximum of the line item of a content item must be above 0, found ${describe(lineItem.scoreMaximum)}.`,
    );
  }
  return compact({
    scoreMaximum: lineItem.scoreMaximum,
    label: lineItem.label,
    resourceId: lineItem.resourceId,
    tag: lineItem.tag,
    gradesReleased: lineItem.gradesReleased,
    submissionReview: lineItem.submissionReview && writeSubmissionReview(lineItem.submissionReview),
  });
}

/** Writes the address that a known type requires or allows. */
function checkUrl(url: string | undefined): void {
  if (url !== undefined) checkHttpsUrl(url, "The URL of a content item");
}

function writeLink(item: LinkItem): Record<string, JsonValue> {
  checkUrl(item.url);
  if (item.iframe !== undefined) checkHttpsUrl(item.iframe.src, "The src of the iframe of a content item");
  return compact({
    type: item.type,
    url: item.url,
    title: item.title,
    text: item.text,
    icon: writeImage(item.icon),
    thumbnail: writeImage(item.thumbnail),
    embed: item.embed && { html: item.embed.html },
    window: writeWindow(item.window),
    iframe: item.iframe && compact({ ...item.iframe }),
  });
}

function writeLtiResourceLink(item: LtiResourceLinkItem): Record<string, JsonValue> {
  checkUrl(item.url);
  return compact({
    type: item.type,
    url: item.url,
    title: item.title,
    text: item.text,
    icon: writeImage(item.icon),
    thumbnail: writeImage(item.thumbnail),
    window: writeWindow(item.window),
    iframe: item.iframe && compact({ ...item.iframe }),
    custom: item.custom && Object.fromEntries(item.custom),
    lineItem: writeLineItem(item.lineItem),
    available: item.available && compact({ ...item.available }),
    submission: item.submission && compact({ ...item.submission }),
  });
}

/** Writes the members of a known type, without its extensions. */
function writeKnown(item: Exclude<ContentItem, { properties: unknown }>): Record<string, JsonValue> {
  switch (item.type) {
    case "link":
      return writeLink(item);
    case "ltiResourceLink":
      return writeLtiResourceLink(item);
    case "file":
      checkUrl(item.url);
      return compact({
        type: item.type,
        url: item.url,
        title: item.title,
        text: item.text,
        icon: writeImage(item.icon),
        thumbnail: writeImage(item.thumbnail),
        expiresAt: item.expiresAt,
        mediaType: item.mediaType,
      });
    case "html":
      return compact({ type: item.type, html: item.html, title: item.title, text: item.text });
    case "image":
      checkUrl(item.url);
      return compact({
        type: item.type,
        url: item.url,
        title: item.title,
        text: item.text,
        icon: writeImage(item.icon),
        thumbnail: writeImage(item.thumbnail),
        width: item.width,
        height: item.height,
      });
  }
}

/**
 * Writes an item of a Deep Linking response, as `readContentItem` reads it.
 *
 * @remarks
 * An item of another type holds a `type` that is a fully qualified URL, because Deep Linking 2.0 has a new type named that way
 * unless 1EdTech defines it, and its `properties` may not hold a `type`.
 *
 * @throws `DataError` when an address is not an https address, a `scoreMaximum` is not above 0, an extension is not named by
 * a URL, or the type of another item is not a fully qualified URL.
 */
export function writeContentItem(item: ContentItem): Record<string, JsonValue> {
  if ("properties" in item) {
    if (
      !isExtensionName(item.type) ||
      CONTENT_ITEM_TYPES.some((known) => known === item.type) ||
      "type" in item.properties
    ) {
      throw new DataError(
        `The type of a content item that Deep Linking does not define must be a fully qualified URL, found ${describe(item.type)}.`,
      );
    }
    return { ...item.properties, type: item.type };
  }
  return compact({ ...writeKnown(item), ...writeExtensions(item.extensions, MEMBERS[item.type]) });
}
