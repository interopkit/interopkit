import type { TargetType } from "./terms.js";

/**
 * A link to an object of CASE that has an identifier of the form of a UUID: the object's title, identifier and URI
 * (Information Model 7.1.36).
 */
export interface LinkURI {
  /** A human-readable title of the linked object. */
  readonly title: string;
  /** The identifier of the linked object. */
  readonly identifier: string;
  /** The network-resolvable URI of the authoritative reference to the linked object. */
  readonly uri: string;
}

/**
 * A link to either end of an association, which may be a node of another framework or not of CASE at all (Information Model
 * 7.1.35).
 */
export interface LinkGenURI {
  /** A human-readable title of the linked node. */
  readonly title: string;
  /** The identifier of the linked node, which need not be a UUID. */
  readonly identifier: string;
  /** The network-resolvable URI of the authoritative reference to the linked node. */
  readonly uri: string;
  /**
   * What the node is. CASE 1.1 only.
   *
   * @defaultValue `"CASE"`
   */
  readonly targetType?: TargetType;
}
