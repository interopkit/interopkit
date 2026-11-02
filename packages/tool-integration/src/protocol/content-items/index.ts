/**
 * The content items of Deep Linking: the five types that it defines, the extension of a type, and the types that others define.
 *
 * @module
 */
export {
  CONTENT_ITEM_TYPES,
  type ContentItem,
  type FileItem,
  type HtmlItem,
  type ImageItem,
  type ItemBase,
  type ItemImage,
  type ItemLineItem,
  type ItemPeriod,
  type ItemWindow,
  type LinkItem,
  type LtiResourceLinkItem,
  type OtherContentItem,
} from "./model.js";
export { readContentItem } from "./read.js";
export { writeContentItem } from "./write.js";
