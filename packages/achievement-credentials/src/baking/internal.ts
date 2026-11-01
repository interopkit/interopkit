/**
 * What the tests share of `baking` and the package does not export: the checksum of a chunk and the limits of the parser.
 *
 * @module
 */

export { MAX_CREDENTIAL_CHARACTERS } from "../model/internal.js";
export { crc32 } from "./crc32.js";
export { DEFAULT_MAX_BYTES } from "./options.js";
export { MAX_SVG_ATTRIBUTES, MAX_SVG_DEPTH } from "./svg-scan.js";
