import type { JsonObject } from "@interopkit/core/checks";

/**
 * A map of other properties that a Statement may carry in an Activity Definition, in a Result and in a Context (4.2.7): the
 * keys are IRIs, and the values are any JSON.
 */
export type Extensions = JsonObject;
