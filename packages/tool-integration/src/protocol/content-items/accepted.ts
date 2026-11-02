import { describe } from "@interopkit/core/checks";
import type { ContentItem, OtherContentItem } from "./model.js";

/** An item of a type that Deep Linking defines. */
type KnownItem = Exclude<ContentItem, OtherContentItem>;

/** Returns whether an item has a type that Deep Linking defines. */
const isKnown = (item: ContentItem): item is KnownItem => !("properties" in item);

/** What a Deep Linking request says the platform accepts back (Deep Linking 2.0 section 4.4.1). */
interface AcceptedItems {
  /** The types of content item that the platform accepts. */
  readonly acceptTypes: readonly string[];
  /** The ways to present an item that the platform supports: `embed`, `iframe` and `window`. */
  readonly acceptPresentationDocumentTargets: readonly string[];
  /**
   * The media types of a file that the platform accepts, with `*` for a whole type or for any.
   *
   * @defaultValue any
   */
  readonly acceptMediaTypes?: readonly string[] | undefined;
  /**
   * Whether the platform takes several items in one response.
   *
   * @defaultValue `false`: one item
   */
  readonly acceptMultiple?: boolean | undefined;
  /**
   * Whether the platform creates a line item for a resource link that has one: `false` says it ignores them.
   *
   * @defaultValue no assumption
   */
  readonly acceptLineItem?: boolean | undefined;
}

/** Returns the media type of a value without its parameters, in lower case: `Text/HTML; charset=utf-8` is `text/html`. */
const essenceOf = (mediaType: string): string => (mediaType.split(";")[0] ?? "").trim().toLowerCase();

/** Returns whether a media type is one that a pattern names: the same type, `type/*` for any subtype, or `*` for any. */
function matchesMediaType(pattern: string, mediaType: string): boolean {
  const wanted = essenceOf(pattern);
  if (wanted === "*" || wanted === "*/*") return true;
  const [type = "", subtype = ""] = essenceOf(mediaType).split("/");
  const [wantedType = "", wantedSubtype = ""] = wanted.split("/");
  return wantedType === type && (wantedSubtype === "*" || wantedSubtype === subtype);
}

/**
 * Returns the ways an item offers to present it: `window`, `iframe` or `embed`, for the types that have them (Deep Linking 2.0
 * sections 3.1 and 3.2).
 */
function presentationsOf(item: KnownItem): readonly string[] {
  if (item.type === "link") {
    return [
      ...(item.window === undefined ? [] : ["window"]),
      ...(item.iframe === undefined ? [] : ["iframe"]),
      ...(item.embed === undefined ? [] : ["embed"]),
    ];
  }
  if (item.type === "ltiResourceLink") {
    return [...(item.window === undefined ? [] : ["window"]), ...(item.iframe === undefined ? [] : ["iframe"])];
  }
  return [];
}

/** Returns why the platform refuses one item, or `undefined`. */
function findItemRefusal(item: ContentItem, index: number, accepted: AcceptedItems): string | undefined {
  const { acceptTypes, acceptMediaTypes, acceptLineItem, acceptPresentationDocumentTargets } = accepted;
  const label = `The item ${index + 1}`;
  if (!acceptTypes.includes(item.type)) {
    return `${label} has the type ${describe(item.type)}, and the platform accepts the types ${describe(acceptTypes.join(", "))}.`;
  }
  if (!isKnown(item)) return undefined;
  if (item.type === "file" && acceptMediaTypes !== undefined && item.mediaType !== undefined) {
    const mediaType = item.mediaType;
    if (!acceptMediaTypes.some((pattern) => matchesMediaType(pattern, mediaType))) {
      return `${label} is a file of the media type ${describe(mediaType)}, and the platform accepts the media types ${describe(acceptMediaTypes.join(", "))}.`;
    }
  }
  if (item.type === "ltiResourceLink" && item.lineItem !== undefined && acceptLineItem === false) {
    return `${label} has a line item, and the platform ignores them.`;
  }
  const presentations = presentationsOf(item);
  // The tool should offer every way that applies and the platform picks one, so an item is refused only when it offers ways
  // and the platform supports none of them.
  if (presentations.length > 0 && !presentations.some((way) => acceptPresentationDocumentTargets.includes(way))) {
    return `${label} offers the presentations ${describe(presentations.join(", "))}, and the platform supports ${describe(acceptPresentationDocumentTargets.join(", "))}.`;
  }
  return undefined;
}

/**
 * Returns the sentence that says why a platform with the given acceptances refuses the items of a response, or `undefined` when
 * it takes them: several items without `accept_multiple`, a type outside `accept_types`, a file of a media type outside
 * `accept_media_types`, a line item where the platform ignores them, and an item whose only presentations the platform does not
 * support (Deep Linking 2.0 section 4.4.1). A file that names no media type passes, since nothing says what it is.
 *
 * @param items - The items of the response, as `readContentItem` reads them.
 * @param accepted - The settings of the request.
 */
export function findRefusal(items: readonly ContentItem[], accepted: AcceptedItems): string | undefined {
  if (items.length > 1 && accepted.acceptMultiple !== true) {
    return `The platform does not say that it accepts several items, and ${items.length} were given.`;
  }
  for (const [index, item] of items.entries()) {
    const refusal = findItemRefusal(item, index, accepted);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}
