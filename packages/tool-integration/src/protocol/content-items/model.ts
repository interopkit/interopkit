import type { JsonObject, JsonValue } from "@interopkit/core/checks";
import type { SubmissionReview } from "../claims/index.js";

/** An image of an item: its address and, when known, its size in pixels (Deep Linking 2.0 section 3, `icon` and `thumbnail`). */
export interface ItemImage {
  /** The address of the image file. */
  readonly url: string;
  /** The width in pixels. */
  readonly width?: number;
  /** The height in pixels. */
  readonly height?: number;
}

/** What every item of a known type may carry. */
export interface ItemBase {
  /** A title in plain text. */
  readonly title?: string;
  /** A description in plain text for every user who can reach the item. */
  readonly text?: string;
  /** Properties that a vendor added, by the URL that names each (Deep Linking 2.0, extending a type). */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** The ways to open a link in a window (Deep Linking 2.0 section 3.1, `window`). */
export interface ItemWindow {
  /** The name of the window, so that links can share one. */
  readonly targetName?: string;
  /** The width in pixels. */
  readonly width?: number;
  /** The height in pixels. */
  readonly height?: number;
  /** The features of `window.open`, comma-separated. */
  readonly windowFeatures?: string;
}

/** A link: an address that is navigable to (Deep Linking 2.0 section 3.1). */
export interface LinkItem extends ItemBase {
  /** The type. */
  readonly type: "link";
  /** The address of the resource. */
  readonly url: string;
  /** An icon to put beside the link. */
  readonly icon?: ItemImage;
  /** A thumbnail to make a hyperlink of. */
  readonly thumbnail?: ItemImage;
  /** An HTML fragment that embeds the resource. */
  readonly embed?: {
    /** The HTML fragment, which the platform sanitizes. */
    readonly html: string;
  };
  /** How to open the link in a new window. */
  readonly window?: ItemWindow;
  /** How to embed the resource in a frame. */
  readonly iframe?: {
    /** The address to use as `src` of the frame, which may differ from `url`. */
    readonly src: string;
    /** The width in pixels. */
    readonly width?: number;
    /** The height in pixels. */
    readonly height?: number;
  };
}

/** The line item that a platform may create for a resource link (Deep Linking 2.0 section 3.2, `lineItem`). */
export interface ItemLineItem {
  /** The most a user can score, above 0. */
  readonly scoreMaximum: number;
  /** The label of the line item; the title of the item when absent. */
  readonly label?: string;
  /** The tool's identifier of the resource. */
  readonly resourceId?: string;
  /** A tag that tells the line items of one resource apart. */
  readonly tag?: string;
  /** Whether the platform should release the grades to learners. */
  readonly gradesReleased?: boolean;
  /** The launch back to the work behind a result. */
  readonly submissionReview?: SubmissionReview;
}

/** A period, with a time zone designator at each end (Deep Linking 2.0 section 3.2, `available` and `submission`). */
export interface ItemPeriod {
  /** When the period starts. */
  readonly startDateTime?: string;
  /** When the period ends. */
  readonly endDateTime?: string;
}

/** A link to an LTI resource, usually of the tool that was asked (Deep Linking 2.0 section 3.2). */
export interface LtiResourceLinkItem extends ItemBase {
  /** The type. */
  readonly type: "ltiResourceLink";
  /** The address to launch, which the platform uses as the `target_link_uri`; the base address of the tool when absent. */
  readonly url?: string;
  /** An icon to put beside the link. */
  readonly icon?: ItemImage;
  /** A thumbnail to make a hyperlink of. */
  readonly thumbnail?: ItemImage;
  /** How to open the link in a new window. */
  readonly window?: ItemWindow;
  /** The preferred size of the frame. */
  readonly iframe?: {
    /** The width in pixels. */
    readonly width?: number;
    /** The height in pixels. */
    readonly height?: number;
  };
  /** The custom properties that every launch of the link carries. */
  readonly custom?: ReadonlyMap<string, string>;
  /** The line item that the link is expected to receive scores in. */
  readonly lineItem?: ItemLineItem;
  /** When the link is available to learners. */
  readonly available?: ItemPeriod;
  /** When submissions can be made. */
  readonly submission?: ItemPeriod;
}

/** A file that the platform fetches and keeps; its address is short-lived (Deep Linking 2.0 section 3.3). */
export interface FileItem extends ItemBase {
  /** The type. */
  readonly type: "file";
  /** The address of the file. */
  readonly url: string;
  /** An icon to put beside the file. */
  readonly icon?: ItemImage;
  /** A thumbnail to make a hyperlink of. */
  readonly thumbnail?: ItemImage;
  /** Until when the address works at least, with a time zone designator. */
  readonly expiresAt?: string;
  /** The media type of the file, which the examples of the specification give and its table does not. */
  readonly mediaType?: string;
}

/** An HTML fragment to embed in a page; the platform sanitizes it (Deep Linking 2.0 section 3.4). */
export interface HtmlItem extends ItemBase {
  /** The type. */
  readonly type: "html";
  /** The fragment. */
  readonly html: string;
}

/** An image that the browser shows with an `img` element (Deep Linking 2.0 section 3.5). */
export interface ImageItem extends ItemBase {
  /** The type. */
  readonly type: "image";
  /** The address of the image. */
  readonly url: string;
  /** An icon to put beside the image. */
  readonly icon?: ItemImage;
  /** A thumbnail to make a hyperlink of. */
  readonly thumbnail?: ItemImage;
  /** The width in pixels. */
  readonly width?: number;
  /** The height in pixels. */
  readonly height?: number;
}

/**
 * An item of a type that Deep Linking does not define: a vendor's, named by a URL, or one that another specification defines.
 */
export interface OtherContentItem {
  /** The type, which is a fully qualified URL unless 1EdTech defines it. */
  readonly type: string;
  /** The other properties of the item, as JSON. */
  readonly properties: JsonObject;
}

/** The types that Deep Linking 2.0 defines. */
export const CONTENT_ITEM_TYPES = ["link", "ltiResourceLink", "file", "html", "image"] as const;

/** An item that a tool selected or made, which a platform adds (Deep Linking 2.0 section 3). */
export type ContentItem = LinkItem | LtiResourceLinkItem | FileItem | HtmlItem | ImageItem | OtherContentItem;
