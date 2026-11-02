import type { XapiVersion } from "../model/index.js";

/**
 * The versions that a request may name for each route: 2.0 and 2.0.x for xAPI 2.0 (4.1.7), and 1.0 and 1.0.x for xAPI 1.0.3,
 * which takes 1.0 as 1.0.0 and refuses 1.1.0 and later (1.0.3 Communication 3.3).
 */
const NAMED: Readonly<Record<XapiVersion, { readonly pattern: RegExp; readonly names: string }>> = {
  "2.0.0": { pattern: /^2\.0(?:\.\d+)?$/u, names: "2.0 or 2.0.x" },
  "1.0.3": { pattern: /^1\.0(?:\.\d+)?$/u, names: "1.0 or 1.0.x" },
};

/** Finds the route of the version that the `X-Experience-API-Version` header of a request names, among those the LRS serves. */
export function routeOf(header: string | undefined, served: readonly XapiVersion[]): XapiVersion | undefined {
  return header === undefined ? undefined : served.find((version) => NAMED[version].pattern.test(header));
}

/** Writes the versions that a request may name, for the message of a refusal: `2.0 or 2.0.x, or 1.0 or 1.0.x`. */
export function namesOf(served: readonly XapiVersion[]): string {
  return served.map((version) => NAMED[version].names).join(", or ");
}
