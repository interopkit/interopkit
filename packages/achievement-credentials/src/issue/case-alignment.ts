import { absoluteUriSchema, type Schema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type { Alignment } from "../model/index.js";
import { CLASS_SCHEMAS } from "../read/internal.js";
import { finish, readInput } from "./finish.js";

/** The item of a CASE framework that an alignment names, as plain strings. */
export interface CaseItem {
  /** The address of the item, an absolute URI. */
  readonly uri: string;
  /** The name of the item. */
  readonly name: string;
  /** The human coding scheme of the item, such as `3.NF.A.1`. */
  readonly code?: string;
  /** The name of the framework that the item belongs to. */
  readonly framework?: string;
}

const caseItemSchema: Schema<CaseItem> = strictRecord({
  uri: absoluteUriSchema,
  name: v.string(),
  code: v.optional(v.string()),
  framework: v.optional(v.string()),
});

/**
 * Builds the Alignment of an achievement to an item of a CASE framework, with the target type `CFItem`.
 *
 * @remarks
 * The item is plain strings, so that no CASE package is needed: take them from a competency framework with any library.
 *
 * @param item - The item: its `uri` (the address of the item), its `name`, and optionally its human coding scheme as `code`
 * and the name of its `framework`.
 * @returns The alignment.
 * @throws `DataError` that names every fault of the item, such as a `uri` that is not an absolute URI.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#alignment | Open Badges 3.0, Alignment}
 */
export function caseAlignment(item: CaseItem): Alignment {
  const { uri, name, code, framework } = readInput(caseItemSchema, item, "The item");
  const written = {
    type: ["Alignment"],
    targetUrl: uri,
    targetName: name,
    targetType: "CFItem",
    ...(code === undefined ? {} : { targetCode: code }),
    ...(framework === undefined ? {} : { targetFramework: framework }),
  };
  return finish(CLASS_SCHEMAS.alignmentSchema, written, "The alignment");
}
