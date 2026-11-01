import type { JsonObject } from "@interopkit/core/checks";

/**
 * The proprietary data of an entity that CASE 1.1 lets a provider add (Information Model 10.1.2): a JSON object whose
 * properties the specification does not define. A consumer ignores what it does not know.
 */
export type Extensions = JsonObject;
