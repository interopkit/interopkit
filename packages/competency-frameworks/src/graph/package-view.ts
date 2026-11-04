import { DataError } from "@interopkit/core";
import { parseWith } from "@interopkit/core/checks";
import * as v from "valibot";
import type { CasePackage, CFPckgItem } from "../model/index.js";
import { identifierKey } from "../model/internal.js";

const nodeSchema = v.looseObject({
  identifier: v.string(),
  uri: v.string(),
  targetType: v.optional(v.string()),
});

const packageSchema = v.looseObject({
  CFDocument: v.looseObject({
    identifier: v.string(),
    uri: v.string(),
    adoptionStatus: v.optional(v.string()),
  }),
  CFItems: v.optional(
    v.array(
      v.looseObject({
        identifier: v.string(),
        uri: v.string(),
        humanCodingScheme: v.optional(v.string()),
      }),
    ),
  ),
  CFAssociations: v.optional(
    v.array(
      v.looseObject({
        identifier: v.string(),
        associationType: v.string(),
        sequenceNumber: v.optional(v.number()),
        originNodeURI: nodeSchema,
        destinationNodeURI: nodeSchema,
      }),
    ),
  ),
});

/**
 * Checks that a value has what the functions of this module read of a package: a document, and items and associations that
 * have their identifiers, URIs, types and nodes. It holds no value to the rest of the schemas; `readPackage` does that.
 *
 * @param value - The package.
 * @param label - Names the package in the error message, such as `The package`.
 * @throws `DataError` that names the path of the first property that is missing or of the wrong type.
 */
export function checkPackageView(value: unknown, label: string): asserts value is CasePackage {
  parseWith(packageSchema, value, label);
}

/** Returns the items of a package by identifier in lower case; of two items with one identifier, the first. */
export function itemsByKey(pkg: CasePackage): Map<string, CFPckgItem> {
  const items = new Map<string, CFPckgItem>();
  for (const item of pkg.CFItems ?? []) {
    const key = identifierKey(item.identifier);
    if (!items.has(key)) items.set(key, item);
  }
  return items;
}

/**
 * Copies a value of the model so that the result shares nothing with it.
 *
 * @throws `DataError` when the value holds something that cannot be copied, such as a function, or nests too deep.
 */
export function copyOf<TValue>(value: TValue, label: string): TValue {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new DataError(
      `${label} must be plain data that can be copied: it holds a function or a symbol, or nests too deep.`,
      { cause: error },
    );
  }
}
