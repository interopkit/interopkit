/**
 * Baking: writing a credential into a PNG or an SVG image, and reading it out again, for Open Badges 3.0 and for CLR 2.0, and
 * reading an Open Badges 2.0 assertion out of one.
 *
 * @module @interopkit/achievement-credentials/baking
 */
export { bakePng } from "./bake-png.js";
export { bakeSvg } from "./bake-svg.js";
export type { BakedCredential } from "./baked-credential.js";
export type { FoundKind } from "./formats.js";
export type { BakeImageOptions, ReadImageOptions } from "./options.js";
export { readPng } from "./read-png.js";
export { readSvg } from "./read-svg.js";
