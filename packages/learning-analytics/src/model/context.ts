import type { JsonObject } from "@interopkit/core/checks";

/**
 * The JSON-LD context of Caliper 1.2. Every event names it as its `@context`, and an envelope names it as its
 * `dataVersion`.
 *
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export const CALIPER_CONTEXT = "http://purl.imsglobal.org/ctx/caliper/v1p2";

/**
 * The JSON-LD context of Caliper 1.1. The endpoint reads documents that name it, and an envelope that names it as its
 * `dataVersion`; the package never writes it.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/caliper/v1p1/caliper-spec-v1p1/caliper-spec-v1p1.html | Caliper Analytics 1.1}
 */
export const CALIPER_1_1_CONTEXT = "http://purl.imsglobal.org/ctx/caliper/v1p1";

/**
 * The versions of Caliper that the readers know, the current one first: 1.2, which the package reads and writes, and 1.1, which
 * it reads and never writes.
 */
export const CALIPER_VERSIONS = ["1.2", "1.1"] as const;

/** A version of Caliper that the readers know. */
export type CaliperVersion = (typeof CALIPER_VERSIONS)[number];

/**
 * The JSON-LD context of the Library Use Profile, which extends Caliper 1.2. The events and entities of that profile name it
 * as their `@context`.
 *
 * @see {@link https://www.imsglobal.org/spec/caliper-library/v1p2 | Caliper Analytics Library Use Profile}
 */
export const LIBRARY_PROFILE_CONTEXT = "http://purl.imsglobal.org/ctx/caliper/v1p2/LibraryProfile-extension";

/**
 * The `@context` of an event or an entity: the address of one context, the terms of one defined inline, or a list of them. At
 * the top of a document the context is the Caliper context, or a list that ends with it (Caliper 1.2 section 4.1); an entry
 * before the last is a context of the sender's own.
 */
export type Context = string | JsonObject | readonly (string | JsonObject)[];
