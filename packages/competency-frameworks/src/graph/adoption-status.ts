import { DataError } from "@interopkit/core";
import { checkRecord, describe } from "@interopkit/core/checks";
import type { CFPckgDocument } from "../model/index.js";

/**
 * The adoption statuses of a framework that the working group recommends (Implementation Guide 4.2): being written, approved
 * and not yet in force, in force, and no longer in force.
 */
export const ADOPTION_STATUSES = ["Draft", "Pending Implementation", "Implemented", "Retired"] as const;

/** An adoption status of a framework that the working group recommends. */
export type AdoptionStatus = (typeof ADOPTION_STATUSES)[number];

/** The statuses of the best practices of 1.0 and the status that each is the same as. */
const LEGACY_STATUSES: ReadonlyMap<string, AdoptionStatus> = new Map([
  ["adopted", "Implemented"],
  ["deprecated", "Retired"],
]);

const STATUSES: ReadonlyMap<string, AdoptionStatus> = new Map([
  ...ADOPTION_STATUSES.map((status): [string, AdoptionStatus] => [status.toLowerCase(), status]),
  ...LEGACY_STATUSES,
]);

/**
 * Reads the adoption status of a framework into the vocabulary that the working group recommends.
 *
 * @remarks
 * The specification fixes no vocabulary for `adoptionStatus`. `Adopted`, which 1.0 recommended, is read as `Implemented`, and
 * `Deprecated` as `Retired`, as the guide says. Case is ignored. The status is the one that the document states: it is not
 * worked out from `statusStartDate` and `statusEndDate`.
 *
 * @param document - The document of a package, or any object with an `adoptionStatus`.
 * @returns The status, or `undefined` when the document states none or states a term that is not in the vocabulary.
 * @throws `DataError` when the document is not an object, or its `adoptionStatus` is not a string.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1/impl | CASE Implementation Guide}, 4.2
 */
export function adoptionStatus(document: Pick<CFPckgDocument, "adoptionStatus">): AdoptionStatus | undefined {
  checkRecord(document, "The document must be an object");
  const { adoptionStatus: status } = document;
  if (status !== undefined && typeof status !== "string") {
    throw new DataError(`The adoptionStatus of the document must be a string, found ${describe(status)}.`);
  }
  return status === undefined ? undefined : STATUSES.get(status.toLowerCase());
}
