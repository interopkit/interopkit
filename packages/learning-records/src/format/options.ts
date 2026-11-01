import { guardSchema, isLanguageTag, parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type { ActivityDefinition } from "../model/index.js";

/** The formats of the Statements that an LRS returns (4.1.6.1). */
export const STATEMENT_FORMATS = ["ids", "exact", "canonical"] as const;

/** A format of the Statements that an LRS returns: `ids`, `exact` or `canonical`. */
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];

/** The options of `formatStatement`. */
export interface FormatOptions {
  /**
   * The canonical definitions of Activities, by Activity id, which the format `canonical` puts in place of the definitions in
   * the Statement. An Activity that the map lacks keeps its own definition.
   *
   * @defaultValue none: definitions as stored
   */
  readonly activities?: ReadonlyMap<string, ActivityDefinition>;
  /**
   * The languages to return, in the order of preference, as the language ranges of an `Accept-Language` header without their
   * weights: `["fr-CA", "fr", "en"]`. `*` asks for the first entry. The format `canonical` returns one entry of each language
   * map: the first that a language matches, or the first entry of the map.
   *
   * @defaultValue none: the first entry of each map
   */
  readonly languages?: readonly string[];
}

const formatSchema = v.picklist(STATEMENT_FORMATS);

const optionsSchema = strictRecord({
  activities: v.optional(
    guardSchema(
      (value): value is ReadonlyMap<string, ActivityDefinition> => value instanceof Map,
      "a Map from an Activity id to its definition",
    ),
  ),
  languages: v.optional(
    v.array(
      v.pipe(
        v.string(),
        v.check(
          (range) => range === "*" || isLanguageTag(range),
          (issue) => `expected a language tag of RFC 5646 or *, found ${issue.received}`,
        ),
      ),
    ),
  ),
});

/** Checks the format that a caller asks for. */
export function readFormat(format: unknown): StatementFormat {
  return parseWith(formatSchema, format, "The format");
}

/** Checks the options of a format. */
export function readFormatOptions(options: unknown): FormatOptions {
  return parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
}
