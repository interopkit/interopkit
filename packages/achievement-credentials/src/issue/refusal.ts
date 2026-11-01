import { DataError } from "@interopkit/core";
import type { Finding } from "@interopkit/core/checks";

/**
 * Makes the error of a builder that names every fault: its path, when it has one, and what is wrong.
 *
 * @param label - Names what is refused, such as `The credential`.
 * @param findings - The faults, at least one.
 */
export function refuseWith(label: string, findings: readonly Finding[]): DataError {
  const faults = findings.map(({ path, message }) => `${path === "" ? "" : `${path}: `}${message.replace(/\.$/u, "")}`);
  return new DataError(`${label} is invalid: ${faults.join("; ")}.`);
}
