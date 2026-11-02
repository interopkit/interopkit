/**
 * The Caliper 1.2 model: the JSON-LD contexts, the vocabularies, and the entities and events that Caliper 1.2 and the Library
 * Use Profile define.
 *
 * @module
 */
export {
  CALIPER_1_1_CONTEXT,
  CALIPER_CONTEXT,
  CALIPER_VERSIONS,
  type CaliperVersion,
  type Context,
  LIBRARY_PROFILE_CONTEXT,
} from "./context.js";
export type { EndpointConfiguration } from "./endpoint-configuration.js";
export * from "./entities/index.js";
export type { EntityDocument } from "./entity-document.js";
export * from "./events/index.js";
export * from "./terms.js";
