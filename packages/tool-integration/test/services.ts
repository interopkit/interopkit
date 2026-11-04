import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { expect } from "vitest";

/** The names of members that every reader refuses, since they name the prototype chain. */
const PROTOTYPE_NAMES: readonly string[] = ["__proto__", "constructor", "prototype"];

/**
 * JSON as a text of it reads, without a member that names the prototype chain, which every reader refuses: a `-0` is written
 * as `0`, which a round trip through text would change.
 */
export const plainJson = fc
  .jsonValue()
  .map((value) =>
    JSON.parse(JSON.stringify(value), (name, member) => (PROTOTYPE_NAMES.includes(name) ? undefined : member)),
  );

/** A name of a member that a reader takes: a text that does not name the prototype chain. */
export const memberName = (text: fc.Arbitrary<string>): fc.Arbitrary<string> =>
  text.filter((name) => !PROTOTYPE_NAMES.includes(name));

/** JSON that is not the body of any service: what plain JavaScript or a hostile peer may pass instead of an object. */
const OTHER_TYPES = ["null", "5", '"text"', "true", "[]", "[1]", "{}"];

/**
 * Checks that a reader refuses input of the other types, as `JSON.parse` gives it, with a `DataError`.
 *
 * @param also - More texts of JSON that the reader must refuse.
 * @param except - Texts of JSON that the reader takes, such as `[]` for the reader of a container.
 */
export function expectRefusesOtherTypes(
  read: (value: unknown) => unknown,
  also: readonly string[] = [],
  except: readonly string[] = [],
): void {
  for (const text of [...OTHER_TYPES, ...also].filter((candidate) => !except.includes(candidate))) {
    expect(() => read(JSON.parse(text)), text).toThrow(DataError);
  }
}

/** Checks that a reader refuses each change of a valid body, with a `DataError` that names the member. */
export function expectRefusals(
  read: (value: unknown) => unknown,
  valid: Readonly<Record<string, unknown>>,
  changes: readonly (readonly [name: string, change: Readonly<Record<string, unknown>>])[],
): void {
  expect(() => read(valid)).not.toThrow();
  for (const [name, change] of changes) {
    expect(() => read(JSON.parse(JSON.stringify({ ...valid, ...change }))), name).toThrow(DataError);
  }
}
