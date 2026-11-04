/**
 * Readers and validators of xAPI Statements: the text of a request into a value without a repeated property, a value into the
 * model, and the findings of the rules of an LRS or of a Learning Record Provider.
 *
 * @module
 */
export type { ReadOptions } from "./options.js";
export {
  type ParseStatementJsonOptions,
  parseStatementJson,
} from "./parse-statement-json.js";
export { readStatement, validateStatement, validateStatements } from "./read-statement.js";
