/**
 * What the other modules and the tests share of `read` and the package does not export.
 *
 * @module
 */
import * as api from "./api-schemas.js";
import * as clr from "./clr-schemas.js";
import * as credentials from "./credential-schemas.js";
import * as keys from "./key-schemas.js";
import * as v1p1 from "./v1p1-schemas.js";

/** Every schema of a class, by the name of its export: the class name with a lower-case initial and `Schema`. */
export const CLASS_SCHEMAS = { ...credentials, ...v1p1, ...clr, ...api, ...keys };
