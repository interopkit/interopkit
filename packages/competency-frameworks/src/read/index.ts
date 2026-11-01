/**
 * Readers and validators of CASE: a framework package or an entity of CASE 1.0 or 1.1, read into the model of 1.1, and
 * judged with every finding that the schemas and the rules of a package give.
 *
 * @module
 */
export type { ReadOptions } from "./options.js";
export { readEntity, validateEntity } from "./read-entity.js";
export { readPackage, validatePackage } from "./read-package.js";
