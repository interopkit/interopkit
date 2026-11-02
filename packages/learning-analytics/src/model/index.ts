/**
 * The Caliper 1.2 model: the JSON-LD contexts, the vocabularies, and the entities and events that Caliper 1.2 and the Library
 * Use Profile define.
 *
 * @module
 */
export { CALIPER_CONTEXT, type Context, LIBRARY_PROFILE_CONTEXT } from "./context.js";
export * from "./entities/index.js";
export type { EntityDocument } from "./entity-document.js";
export type { CaliperEvent } from "./event.js";
export * from "./terms.js";
