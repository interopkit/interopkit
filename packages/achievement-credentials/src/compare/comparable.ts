import { looseRecord, parseWith, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";

/** What two credentials are compared by: the address of the credential and of its issuer, and when it became valid. */
interface Comparable {
  readonly id?: string;
  readonly issuer: string | { readonly id: string };
  readonly validFrom?: string;
}

const issuerSchema = v.lazy((input) => (typeof input === "string" ? v.string() : looseRecord({ id: v.string() })));

const comparableSchema: Schema<Comparable> = looseRecord({
  id: v.optional(v.string()),
  issuer: issuerSchema,
  validFrom: v.optional(v.string()),
});

/** Reads the parts of a credential that a comparison needs, and refuses a value that has no issuer. */
export function comparableOf(credential: unknown, label: string): Comparable {
  return parseWith(comparableSchema, credential, label);
}

/** Unescapes the percent-encoded characters of a text and trims the white space around it (OB 10). */
function normalized(text: string): string {
  const unescaped = text.replace(/(?:%[0-9A-Fa-f]{2})+/gu, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      // A run that is not valid UTF-8 stays as it is: nothing says what it stands for.
      return run;
    }
  });
  return unescaped.trim();
}

/** Returns the address of the issuer, normalized. */
function issuerOf(comparable: Comparable): string {
  return normalized(typeof comparable.issuer === "string" ? comparable.issuer : comparable.issuer.id);
}

/** Tells whether two comparable credentials have the same `id` and the same issuer (OB 10). */
export function isSame(first: Comparable, second: Comparable): boolean {
  if (first.id === undefined || second.id === undefined) return false;
  return normalized(first.id) === normalized(second.id) && issuerOf(first) === issuerOf(second);
}
