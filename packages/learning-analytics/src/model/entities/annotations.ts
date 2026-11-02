import type { Entity, Ref } from "./entity.js";
import type { TextPositionSelector } from "./identifier.js";
import type { Person } from "./people.js";
import type { AnyAgent, AnyDigitalResource } from "./ranges.js";

/**
 * A comment, explanation, highlight, mark, note, question or tag that is linked to a digital resource (Caliper 1.2 B.4). A
 * sender uses the generic type only when no subtype fits.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Annotation<TType extends string = "Annotation"> extends Entity<TType> {
  /** The person who made the annotation. */
  readonly annotator?: Ref<Person>;
  /** The digital resource that was annotated. */
  readonly annotated?: Ref<AnyDigitalResource>;
}

/** A mark at a location of a digital resource (Caliper 1.2 B.10). */
export interface BookmarkAnnotation extends Annotation<"BookmarkAnnotation"> {
  /** The note that goes with the bookmark, as plain text. */
  readonly bookmarkNotes?: string;
}

/** A marked segment of a digital resource (Caliper 1.2 B.25). */
export interface HighlightAnnotation extends Annotation<"HighlightAnnotation"> {
  /** The highlighted text as plain text. */
  readonly selectionText?: string;
  /** The place of the highlighted segment. */
  readonly selection?: Ref<TextPositionSelector>;
}

/** The sharing of a reference to a digital resource with other agents (Caliper 1.2 B.61). */
export interface SharedAnnotation extends Annotation<"SharedAnnotation"> {
  /** The agents with whom the resource was shared. */
  readonly withAgents?: readonly Ref<AnyAgent>[];
}

/** The tagging of a digital resource with tags or labels (Caliper 1.2 B.65). */
export interface TagAnnotation extends Annotation<"TagAnnotation"> {
  /** The tags. */
  readonly tags?: readonly string[];
}
