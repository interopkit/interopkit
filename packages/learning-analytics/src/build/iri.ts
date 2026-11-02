import { DataError } from "@interopkit/core";
import { checkString, describe } from "@interopkit/core/checks";

/**
 * Checks that a value is an absolute IRI, which Caliper requires for every entity.
 *
 * @param value - The value.
 * @param label - Names the value in the error message, such as `The actor of the context`.
 * @throws `DataError` when it is not an absolute IRI.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export function checkIri(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!URL.canParse(value)) {
    throw new DataError(`${label} must be an absolute IRI, found ${describe(value)}.`);
  }
}
