import type { JsonObject } from "@interopkit/core/checks";
import type { SystemIdentifierType } from "../internal.js";
import type { Ref } from "./entity.js";
import type { SoftwareApplication } from "./people.js";

/**
 * An identifier of an entity that belongs to one system, such as a sourcedId or an email address (Caliper 1.2 Appendix C). It
 * has no `id` of its own.
 */
export interface SystemIdentifier {
  /** The term `SystemIdentifier`. */
  readonly type: "SystemIdentifier";
  /** The kind of identifier. */
  readonly identifierType: SystemIdentifierType;
  /** The identifier, an opaque string. */
  readonly identifier: string;
  /** The application that created or owns the identifier. */
  readonly source?: Ref<SoftwareApplication>;
  /** Attributes of the sender's own that the model does not describe. */
  readonly extensions?: JsonObject;
}

/**
 * A selection of text by position (Caliper 1.2 Appendix C): characters counted from the start of the enclosing text, which is
 * position 0. It has no `id` of its own.
 */
export interface TextPositionSelector {
  /** The term `TextPositionSelector`. */
  readonly type: "TextPositionSelector";
  /** The position of the first selected character. */
  readonly start: number;
  /** The position at which the selection ends. */
  readonly end: number;
}
