import { checkArray, describe } from "../checks.js";
import { DataError } from "../errors.js";

/** RFC 6749 section 3.3: a scope is one or more printable characters, but not a space, a quote or a backslash. */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/u;

/**
 * Checks the scopes that a call asks for.
 *
 * @throws `DataError` when they are not an array of scope tokens.
 */
export function checkScopes(scopes: unknown): asserts scopes is readonly string[] {
  checkArray(scopes, "The scopes must be an array");
  for (const scope of scopes) {
    if (typeof scope !== "string" || !SCOPE_TOKEN.test(scope)) {
      throw new DataError(
        `A scope must be a non-empty string without spaces, quotes or backslashes, found ${describe(scope)}.`,
      );
    }
  }
}

/** Splits the `scope` of a response or a request into its scopes. */
export function splitScope(scope: string | null | undefined): readonly string[] {
  return (scope ?? "").split(" ").filter((part) => part !== "");
}
