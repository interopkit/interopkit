/**
 * Readers and validators of Open Badges 3.0 and CLR 2.0: a credential or another object of the model, read from untrusted
 * data and judged with every finding that the schemas and the rules of the specification give.
 *
 * @module
 */
export type { EntityReadOptions, ReadOptions } from "./options.js";
export { readCredential, validateCredential } from "./read-credential.js";
export { readEntity, validateEntity } from "./read-entity.js";
