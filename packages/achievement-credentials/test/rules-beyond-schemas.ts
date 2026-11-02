/**
 * The rules that the readers add to the JSON schemas, because the specifications state them in words: a value with such an
 * error is a valid value of a schema, and the values that the schemas generate break them.
 */
export const RULES_BEYOND_SCHEMAS: ReadonlySet<string> = new Set([
  "subject-unidentified",
  "subject-empty",
  "validity-period",
  "related-resource-form",
  "related-resource-id",
  "related-resource-duplicate",
  "related-resource-digest",
]);
