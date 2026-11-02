import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { VERIFICATION_TYPES_V2 } from "../src/index.js";
import { ALIASES_V2, KEYWORD_TERMS_V2, PREFIXES_V2, TERMS_V2, V2_SCHEMAS } from "../src/read/internal.js";
import { heldClass } from "./official.js";

/** A definition of a term in a context: an IRI, a compact IRI or another term, or an object with `@id` and `@type`. */
type Definition = string | { readonly "@id": string; readonly "@type"?: string };

const CONTEXT: Readonly<Record<string, Definition>> = JSON.parse(
  readFileSync(join(requireSchemas(join(import.meta.dirname, "../../..")), "openbadges-v2-context.json"), "utf8"),
)["@context"];

/** Expands a value of the context to an absolute IRI, through the terms and the prefixes that it defines (JSON-LD 1.0, 6.3). */
function expand(value: string, seen: ReadonlySet<string> = new Set()): string {
  if (value.startsWith("@")) return value;
  const definition = CONTEXT[value];
  if (definition !== undefined && !seen.has(value)) {
    const id = typeof definition === "string" ? definition : definition["@id"];
    return expand(id, new Set([...seen, value]));
  }
  const colon = value.indexOf(":");
  const prefix = colon > 0 ? CONTEXT[value.slice(0, colon)] : undefined;
  return typeof prefix === "string" ? `${prefix}${value.slice(colon + 1)}` : value;
}

/** The type coercion of a term: the `@type` of its definition, if any. */
function coercion(term: string): string | undefined {
  const definition = CONTEXT[term];
  return typeof definition === "string" ? undefined : definition?.["@type"];
}

/** The terms of the context, grouped by the IRI that they expand to, for the IRIs that more than one term names. */
function sharedIris(): readonly (readonly string[])[] {
  const byIri = new Map<string, string[]>();
  for (const term of Object.keys(CONTEXT)) {
    const iri = expand(term);
    byIri.set(iri, [...(byIri.get(iri) ?? []), term]);
  }
  return [...byIri.values()].filter((terms) => terms.length > 1);
}

describe("what the reader knows of the context of Open Badges 2.0", () => {
  it("lists every term of the pinned context, in its order", () => {
    expect([...TERMS_V2]).toStrictEqual(Object.keys(CONTEXT));
  });

  it("lists as keywords the terms that alias a keyword, and as prefixes the terms that end an IRI with # or /", () => {
    expect([...KEYWORD_TERMS_V2]).toStrictEqual(Object.keys(CONTEXT).filter((term) => expand(term).startsWith("@")));
    expect([...PREFIXES_V2]).toStrictEqual(
      Object.entries(CONTEXT)
        .filter(([, definition]) => typeof definition === "string" && /[#/]$/u.test(definition))
        .map(([term]) => term),
    );
  });

  it("has an alias for every term that names the IRI of another, but revoked and revokedAssertions", () => {
    const groups = sharedIris().map((terms) => terms.toSorted().join(" "));
    const aliases = [...ALIASES_V2].map(([alias, term]) => [alias, term].toSorted().join(" "));
    expect(groups.toSorted()).toStrictEqual([...aliases, "revoked revokedAssertions"].toSorted());
  });

  it("keeps revoked and revokedAssertions apart, since the context reads one as a boolean and the other as a list", () => {
    expect([coercion("revoked"), coercion("revokedAssertions")]).toStrictEqual(["xsd:boolean", undefined]);
  });

  it("writes each alias as a term of the context with the same IRI", () => {
    for (const [alias, term] of ALIASES_V2) {
      expect(expand(alias)).toBe(expand(term));
      expect(term in CONTEXT).toBe(true);
    }
  });

  it("names in its schemas only properties and classes that the context defines", () => {
    for (const [name, schema] of Object.entries(V2_SCHEMAS)) {
      const held = heldClass(schema);
      if (held === undefined) continue;
      const unknown = held.properties.filter((property) => !property.startsWith("@") && !(property in CONTEXT));
      expect([name, unknown]).toStrictEqual([name, []]);
    }
    for (const name of [
      "Assertion",
      "BadgeClass",
      "Issuer",
      "Profile",
      "Endorsement",
      "RevocationList",
      ...VERIFICATION_TYPES_V2,
    ]) {
      expect(name in CONTEXT).toBe(true);
    }
  });
});
