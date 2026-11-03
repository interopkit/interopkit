import { DataError } from "@interopkit/core";
import { checkString, describe, isAbsoluteUri } from "@interopkit/core/checks";

/**
 * Checks that a value is an absolute IRI, which Caliper requires for every entity.
 *
 * @remarks
 * The form is the one that `readEvent` and `readEntity` take as the `id` of an entity: a scheme, no white space, and a text that
 * `URL` parses. A value that passes is one that the readers and `buildEvent` take.
 *
 * @param value - The value.
 * @param label - Names the value in the error message, such as `The actor of the context`.
 * @throws `DataError` when it is not an absolute IRI.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export function checkIri(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!isAbsoluteUri(value)) {
    throw new DataError(`${label} must be an absolute IRI, found ${describe(value)}.`);
  }
}
