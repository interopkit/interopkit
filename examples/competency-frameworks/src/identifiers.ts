import type { LinkURI, ServedKind } from "@interopkit/competency-frameworks";
import { caseEntityUri } from "@interopkit/competency-frameworks/graph";

/** The width of the last group of an identifier: twelve hexadecimal digits. */
const LAST_GROUP_DIGITS = 12;

/** The collections below the root of the REST binding that are not entities a provider serves by identifier alone. */
export type PartCollection = "CFPackages" | "CFRubricCriteria" | "CFRubricCriterionLevels";

/** Returns the identifier of the entity with a number: a UUID of version 4 whose last group is the number. */
export function identifierOf(number: number): string {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(LAST_GROUP_DIGITS, "0")}`;
}

/** Returns the `uri` that an entity has at a provider: the address from which a consumer retrieves it. */
export function uriOf(origin: string, kind: ServedKind, number: number): string {
  return caseEntityUri(origin, kind, identifierOf(number));
}

/** Returns the address of a package, or of a part of a rubric, which `caseEntityUri` does not name. */
export function partUriOf(origin: string, collection: PartCollection, identifier: string): string {
  return `${origin}/ims/case/v1p1/${collection}/${identifier}`;
}

/** Returns a link to an entity that a provider serves. */
export function linkTo(origin: string, kind: ServedKind, number: number, title: string): LinkURI {
  return { title, identifier: identifierOf(number), uri: uriOf(origin, kind, number) };
}
