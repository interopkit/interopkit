import { finiteSchema, parseWith } from "@interopkit/core/checks";
import { v5 } from "uuid";
import * as v from "valibot";

/**
 * The namespace of the identifiers that `mintUrn` makes: the name-based UUID of
 * `https://github.com/assesskit/assesskit/tree/main/packages/player/src/caliper` in the URL namespace. Changing it changes
 * every identifier, so it never changes.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc9562#section-5.5 | RFC 9562, UUID version 5}
 */
export const CALIPER_NAMESPACE = "4bcd2e8b-df2f-56d9-b6c1-d17e5077c977";

// A number that is not finite writes as `null` in JSON, so it would name the same thing as `null`.
const partsSchema = v.pipe(
  v.array(v.union([v.string(), finiteSchema], "expected a string or a finite number")),
  v.nonEmpty(),
);

/**
 * Returns the URN `urn:uuid:<UUID>` of the name that the parts make: the JSON text of the array, so that no two lists of
 * parts make one name. The same parts always give the same URN.
 *
 * @param parts - What identifies the thing: strings and finite numbers, such as the kind of entity and the session it
 * belongs to. At least one.
 * @returns The URN.
 * @throws `DataError` when `parts` is not a non-empty array of strings and finite numbers.
 */
export function mintUrn(parts: readonly (string | number)[]): string {
  const checked = parseWith(partsSchema, parts, "The list of parts");
  return `urn:uuid:${v5(JSON.stringify(checked), CALIPER_NAMESPACE)}`;
}
