/**
 * Writes a JSON value in a canonical form: members in the order of their names as UTF-16 code units, and no white space
 * (RFC 8785 for the values that a JSON-LD context holds: strings, booleans, null, arrays, objects and the numbers that
 * `JSON.stringify` writes as RFC 8785 does).
 *
 * @remarks
 * Two documents that mean the same JSON have the same canonical form, so a host that holds a context as parsed data can be
 * checked against the same pin as one that fetched its text.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const members = Object.entries(value)
      .toSorted(([first], [second]) => (first < second ? -1 : 1))
      .map(([name, member]) => `${JSON.stringify(name)}:${canonicalJson(member)}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}
