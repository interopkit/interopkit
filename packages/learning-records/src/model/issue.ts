import type { Finding } from "@interopkit/core/checks";

/**
 * A finding about a Statement: where it is, which rule it breaks, what is wrong, and how serious it is.
 *
 * @remarks
 * An `error` is what the role refuses: for an LRS, what the standard says it shall reject; for a Learning Record Provider,
 * what the standard says it shall or shall not do. A `warning` is a departure from a recommendation or from what an LRS may
 * reject: the Statement is usable. The rules are the table of the model guide.
 */
export interface StatementIssue extends Finding {
  /** Whether the Statement breaks a requirement (`error`) or a recommendation (`warning`). */
  readonly severity: "error" | "warning";
}
