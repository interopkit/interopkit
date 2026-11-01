/**
 * What the other modules and the tests share of `model` and the package does not export.
 *
 * @module
 */
export { durationKey, hasFinerThanCentiseconds, isDuration, splitDuration } from "./duration.js";
export { isMailtoIri, isMediaType, isSha1Hex, isSha2Hex } from "./formats.js";
export { hasMillisecondPrecision, isUtc } from "./timestamp.js";
