/**
 * Building Caliper events and entities: the event itself, the identifiers that stay the same when an event is reported again, and the
 * check of the IRIs that Caliper requires.
 *
 * @module
 */
export { type BuildOptions, buildEntity, buildEvent } from "./build-event.js";
export { mintUrn } from "./identifier.js";
export { checkIri } from "./iri.js";
