/**
 * What the other modules and the tests share of `model` and the package does not export.
 *
 * @module
 */
import { DataError } from "@interopkit/core";
import { checkBaseUrl, checkNonEmptyString, describe } from "@interopkit/core/checks";
import type { LinkGenURI } from "./links.js";
import { ASSOCIATION_TYPES, type CaseVersion } from "./terms.js";

/**
 * The identifier as the Information Model gives it (7.2.3): lower case, version 1 to 5, variant 8 to b. The schemas of 1.0
 * state the same pattern without anchors, which accepts text around a UUID; this one is anchored.
 */
export const INFORMATION_MODEL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The association types that CASE 1.0 defines: those of 1.1 except `isTranslationOf`. */
export const ASSOCIATION_TYPES_1_0: readonly string[] = ASSOCIATION_TYPES.filter((type) => type !== "isTranslationOf");

/** Compares identifiers as UUIDs: the digits of a UUID are the same in either case. */
export function identifierKey(identifier: string): string {
  return identifier.toLowerCase();
}

/** Tells whether a node is of CASE, which is what an absent `targetType` means. */
export function isCaseNode(node: Pick<LinkGenURI, "targetType">): boolean {
  return node.targetType === undefined || node.targetType === "CASE";
}

/** The path below the base of a service on which every endpoint of a version sits (REST binding 2.2). */
export const SERVICE_PATHS: Readonly<Record<CaseVersion, string>> = {
  "1.0": "/ims/case/v1p0",
  "1.1": "/ims/case/v1p1",
};

/** The name of the discovery file of CASE 1.1, in the folder `discovery` below the path of the version (REST binding 2.5). */
export const DISCOVERY_FILE = "imscasev1p1_openapi3_v1p0.json";

/** A base that already ends with the path of a version, which `serviceRoot` would add a second time. */
const ENDS_WITH_SERVICE_PATH = /\/ims\/case\/v1p[01]\/*$/u;

/**
 * Returns the address that every endpoint of a version of a service starts with: the base, without a trailing slash, and the
 * path of the version.
 *
 * @param baseUrl - The address of the service before the path of the version, such as `https://standards.example.org`.
 * @param version - The version of CASE whose endpoints the address leads to.
 * @param label - Names the base in the error message, such as `The option baseUrl`.
 * @throws `DataError` when the base is not an absolute `https` URL without credentials, query or fragment, or ends with
 * the path of a version.
 */
export function serviceRoot(baseUrl: unknown, version: CaseVersion, label: string): string {
  checkBaseUrl(baseUrl, label);
  const url = new URL(baseUrl);
  if (ENDS_WITH_SERVICE_PATH.test(url.pathname)) {
    throw new DataError(`${label} must be the address before ${SERVICE_PATHS[version]}, found ${describe(baseUrl)}.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}${SERVICE_PATHS[version]}`;
}

/**
 * Checks the identifier that an endpoint takes in its path. The Information Model asks for a UUID, but a framework may hold
 * another identifier, which the provider answers as an unknown object; only what would change the path is refused.
 *
 * @throws `DataError` when it is not a non-empty string, or is `.` or `..`, which a URL resolves to another path.
 */
export function checkEndpointIdentifier(identifier: unknown, label: string): asserts identifier is string {
  checkNonEmptyString(identifier, label);
  if (identifier === "." || identifier === "..") {
    throw new DataError(`${label} must not be ${describe(identifier)}, which a URL resolves to another path.`);
  }
}

/** Joins the root of a service, the collection of an endpoint and, for an endpoint of one entity, its identifier. */
export function endpointUrl(root: string, collection: string, identifier?: string): string {
  return identifier === undefined ? `${root}/${collection}` : `${root}/${collection}/${encodeURIComponent(identifier)}`;
}
