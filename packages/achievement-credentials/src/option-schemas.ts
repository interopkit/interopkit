import { type Clock, clientOptionsEntries } from "@interopkit/core";
import { guardSchema, methodsSchema, nonNegativeIntegerSchema, positiveIntegerSchema } from "@interopkit/core/checks";
import * as v from "valibot";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "./model/index.js";

/** The JOSE algorithms that a credential may be verified with: the RSA, ECDSA and EdDSA algorithms that Web Crypto runs (Open Badges 8.2.1). */
const VERIFICATION_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

const keysSchema = methodsSchema<KeyResolver>("resolve", "issuerKeys");

const contextsSchema = guardSchema((value): value is ContextLoader => typeof value === "function", "a function");

const suiteSchema = v.pipe(
  methodsSchema<DataIntegritySuite>("verify"),
  v.check(
    ({ cryptosuite }) => typeof cryptosuite === "string" && cryptosuite !== "",
    "expected a suite that names its cryptosuite",
  ),
);

/**
 * The schemas of the options that several functions take, by name, all optional: a function declares the options it takes in a
 * `strictRecord` that spreads `optionsOf` of their names beside its own, so that it refuses every other option, whatever its
 * type. The options it requires it names from `REQUIRED_OPTIONS`.
 */
const OPTION_ENTRIES = {
  ...clientOptionsEntries,
  fetch: v.optional(clientOptionsEntries.fetch),
  clock: v.optional(methodsSchema<Clock>("now")),
  contexts: v.optional(contextsSchema),
  algorithms: v.optional(v.array(v.picklist(VERIFICATION_ALGORITHMS))),
  clockSkewSeconds: v.optional(nonNegativeIntegerSchema),
  allowUnboundKeys: v.optional(v.boolean()),
  legacyProofs: v.optional(v.boolean()),
  suites: v.optional(v.array(suiteSchema)),
  maxInputBytes: v.optional(positiveIntegerSchema),
  maxDepth: v.optional(positiveIntegerSchema),
  maxJsonLdTokens: v.optional(positiveIntegerSchema),
};

/** The names of the options in `OPTION_ENTRIES`. */
type OptionName = keyof typeof OPTION_ENTRIES;

/**
 * Returns the schemas of the options of the given names, to spread into the `strictRecord` of a function's options.
 *
 * @param names - The options that the function takes among those that several functions take.
 */
export function optionsOf<const TName extends OptionName>(
  ...names: readonly TName[]
): Pick<typeof OPTION_ENTRIES, TName> {
  return Object.fromEntries(names.map((name) => [name, OPTION_ENTRIES[name]])) as Pick<typeof OPTION_ENTRIES, TName>;
}

/** The schemas of the options that a function requires when it takes them: the resolver of keys, the loader of contexts and the `fetch`. */
export const REQUIRED_OPTIONS = {
  keys: keysSchema,
  contexts: contextsSchema,
  fetch: clientOptionsEntries.fetch,
};
