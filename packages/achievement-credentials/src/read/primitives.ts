import { guardSchema, jsonObjectSchema, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import type { ContextEntry, ExtensionTerm } from "../model/index.js";

/** A string. The schemas of 1EdTech give a URI, a name and a text the same type, so the reader checks no more than that. */
export const text = v.string();

/** The context of Open Badges 3.0: any `context-3.0.x.json` of the specification's address (OB B.1.2). */
export const OB_CONTEXT_PATTERN = /^https:\/\/purl\.imsglobal\.org\/spec\/ob\/v3p0\/context(-3\.\d\.\d)*\.json$/u;

/** The context of CLR 2.0: any `context-2.0.x.json` of the specification's address (CLR B.1.1). */
export const CLR_CONTEXT_PATTERN = /^https:\/\/purl\.imsglobal\.org\/spec\/clr\/v2p0\/context(-2\.\d\.\d)*\.json$/u;

/** A compact JWS: three parts of base64url characters, the middle one empty for a detached payload (RFC 7515, 7.1). */
const COMPACT_JWS = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+$/u;

/** A language tag as the schemas of 1EdTech write it: a language, an optional script and an optional region (BCP 47). */
const LANGUAGE_TAG = /^[a-z]{2,4}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/u;

/** A term that extends a vocabulary: `ext:` and a name (OB C.2). */
const EXTENSION_TERM = /^ext:[A-Za-z0-9._-]+$/u;

/** A string in the form of a compact JWS. */
export const jws = v.pipe(
  v.string(),
  v.regex(COMPACT_JWS, "expected a compact JWS of three parts of base64url characters"),
);

/** A language tag, such as `en` or `pt-BR`. */
export const language = v.pipe(
  v.string(),
  v.regex(LANGUAGE_TAG, (issue) => `expected a language tag such as "en" or "pt-BR", found ${issue.received}`),
);

/**
 * Defers a reference to a schema that is defined later or in a cycle, so that classes can refer to each other.
 *
 * @param schema - Returns the schema when the first value is read.
 */
export function ref<TOutput>(schema: () => Schema<TOutput>): Schema<TOutput> {
  return v.lazy(schema);
}

/**
 * The schema of a list that the compacted form of JSON-LD may write as its only member (OB A.2.1): the result is always a
 * list.
 *
 * @param item - The schema of a member.
 * @param least - The fewest members.
 */
export function many<TOutput>(item: Schema<TOutput>, least = 0): Schema<readonly TOutput[]> {
  const list = least > 0 ? v.pipe(v.array(item), v.minLength(least)) : v.array(item);
  const single = v.pipe(
    item,
    v.transform((member) => [member]),
  );
  return v.lazy((input) => (Array.isArray(input) ? list : single));
}

/**
 * The schema of the `type` of a class: a list of terms, or one term, that includes every term the class requires. A required
 * term given as a list stands for any one of them.
 *
 * @param required - The terms that the types must include, such as `"Achievement"`.
 */
export function types(...required: readonly (string | readonly string[])[]): Schema<readonly string[]> {
  return typesOf(text, ...required);
}

/**
 * The schema of the `type` of a class whose terms have a form of their own: a list of terms of that form, or one term, that
 * includes every term the class requires.
 *
 * @param term - The schema of one term.
 * @param required - The terms that the types must include; a list stands for any one of them.
 */
export function typesOf(
  term: Schema<string>,
  ...required: readonly (string | readonly string[])[]
): Schema<readonly string[]> {
  return v.pipe(
    many(term, 1),
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      const missing = required.find((term) =>
        typeof term === "string" ? !dataset.value.includes(term) : !term.some((name) => dataset.value.includes(name)),
      );
      if (missing === undefined) return dataset.value;
      const names = typeof missing === "string" ? [missing] : missing;
      addIssue({ message: `expected the types to include ${names.map((name) => JSON.stringify(name)).join(" or ")}` });
      return NEVER;
    }),
  );
}

/**
 * The schema of a term of an extensible vocabulary: one of its terms, or an `ext:` term (OB C.2).
 *
 * @param terms - The terms of the vocabulary.
 * @param label - Says what the term is, such as `an achievement type`.
 */
export function openEnumeration<const TTerms extends readonly string[]>(
  terms: TTerms,
  label: string,
): Schema<TTerms[number] | ExtensionTerm> {
  return guardSchema(
    (value): value is TTerms[number] | ExtensionTerm =>
      typeof value === "string" && (terms.includes(value) || EXTENSION_TERM.test(value)),
    `${label} of the vocabulary or a term of ext: and a name`,
  );
}

/** A context after those that a class requires: the address of a context, or a context that the credential holds. */
const contextEntry: Schema<ContextEntry> = v.lazy((input) => (typeof input === "string" ? text : jsonObjectSchema));

/**
 * The schema of the `@context` of a class: an ordered list that starts with the given contexts, an address or a pattern
 * each, and may go on with more.
 *
 * @param required - The first contexts, in order.
 */
export function contextSchema(required: readonly (string | RegExp)[]): Schema<readonly ContextEntry[]> {
  const first = required.map((context) =>
    typeof context === "string"
      ? v.literal(context)
      : v.pipe(
          v.string(),
          v.regex(
            context,
            (issue) => `expected the address of a context of the specification, found ${issue.received}`,
          ),
        ),
  );
  return v.tupleWithRest(first, contextEntry);
}
