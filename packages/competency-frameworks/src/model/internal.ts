/**
 * What the other modules and the tests share of `model` and the package does not export.
 *
 * @module
 */
import { ASSOCIATION_TYPES } from "./terms.js";

/**
 * The identifier as the Information Model gives it (7.2.3): lower case, version 1 to 5, variant 8 to b. The schemas of 1.0
 * state the same pattern without anchors, which accepts text around a UUID; this one is anchored.
 */
export const INFORMATION_MODEL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The association types that CASE 1.0 defines: those of 1.1 except `isTranslationOf`. */
export const ASSOCIATION_TYPES_1_0: readonly string[] = ASSOCIATION_TYPES.filter((type) => type !== "isTranslationOf");
