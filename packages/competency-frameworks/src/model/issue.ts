import type { Finding } from "@interopkit/core/checks";

/**
 * A finding about a package or an entity: where it is, which rule it breaks, what is wrong, and how serious it is.
 *
 * @remarks
 * An `error` means that the data breaks the specification or cannot be used without a guess: a missing property, a value of
 * the wrong form, two entities with one identifier, a tree that loops. A `warning` means that the data is usable and departs
 * from what the specification or its guide asks for: an identifier that is not of the form that the Information Model
 * gives, a link that points to nothing in the package. The rules are the table of the model guide.
 */
export interface CaseIssue extends Finding {
  /** Whether the data is unusable (`error`) or usable with a departure (`warning`). */
  readonly severity: "error" | "warning";
}
