import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import { readText } from "./body.js";
import type { HttpRequest } from "./request.js";

const FORM_TYPE = "application/x-www-form-urlencoded";

/** Collects the parameters of a query or a form into a map. */
function collect(parameters: URLSearchParams, where: string): ReadonlyMap<string, string> {
  const collected = new Map<string, string>();
  for (const [name, value] of parameters) {
    // RFC 6749 section 3.1: a request parameter must not occur more than once.
    if (collected.has(name)) throw new DataError(`${where} has the parameter ${describe(name)} more than once.`);
    collected.set(name, value);
  }
  return collected;
}

/**
 * Reads the parameters of the query of a request.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @returns The parameters by name.
 * @throws `DataError` when a parameter occurs more than once.
 */
export function readQuery(request: HttpRequest): ReadonlyMap<string, string> {
  return collect(new URL(request.url).searchParams, "The query of the request");
}

/**
 * Reads the parameters of the form that a request carries.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @returns The parameters by name.
 * @throws `DataError` when the body is not `application/x-www-form-urlencoded`, is not UTF-8, or a parameter occurs more
 * than once.
 */
export function readForm(request: HttpRequest): ReadonlyMap<string, string> {
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== FORM_TYPE) {
    throw new DataError(`The content type of the request must be ${FORM_TYPE}, found ${describe(type)}.`);
  }
  return collect(new URLSearchParams(readText(request)), "The form of the request");
}
