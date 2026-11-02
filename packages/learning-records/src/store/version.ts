import type { XapiVersion } from "../model/index.js";
import { VERSION_PATTERNS } from "../model/internal.js";

/** How a sentence names the versions that a request may name for each route. */
const NAMES: Readonly<Record<XapiVersion, string>> = { "2.0.0": "2.0 or 2.0.x", "1.0.3": "1.0 or 1.0.x" };

/** Finds the route of the version that the `X-Experience-API-Version` header of a request names, among those the LRS serves. */
export function routeOf(header: string | undefined, served: readonly XapiVersion[]): XapiVersion | undefined {
  return header === undefined ? undefined : served.find((version) => VERSION_PATTERNS[version].test(header));
}

/** Writes the versions that a request may name, for the message of a refusal: `2.0 or 2.0.x, or 1.0 or 1.0.x`. */
export function namesOf(served: readonly XapiVersion[]): string {
  return served.map((version) => NAMES[version]).join(", or ");
}
