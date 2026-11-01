import type { Finding } from "@interopkit/core/checks";

/**
 * A finding about a credential or another object of the model: where it is, which rule it breaks, what is wrong, and how
 * serious it is.
 *
 * @remarks
 * An `error` means that the data breaks the specification or cannot be used without a guess: a missing property, a value of
 * the wrong form, a subject that nothing identifies. A `warning` means that the data is usable and departs from what the
 * specification asks for: a hash of an identity in no form that the specification names, a credential that names no schema.
 * The rules are the table of the model guide.
 */
export interface CredentialIssue extends Finding {
  /** Whether the data is unusable (`error`) or usable with a departure (`warning`). */
  readonly severity: "error" | "warning";
}
