import type { StatusInfo } from "@interopkit/core";

/**
 * The details that a provider gives (Information Model 7.4.5 and REST binding 2.4).
 *
 * @remarks
 * `invalid_filter_field` is in the binding and not in the Information Model or the schema, which both stop at
 * `invalid_selection_field`; a provider answers with it for a filter it cannot read.
 */
export const STATUS_CODES_MINOR = [
  "fullsuccess",
  "invalid_sort_field",
  "invalid_selection_field",
  "invalid_filter_field",
  "forbidden",
  "unauthorised_request",
  "internal_server_error",
  "unknownobject",
  "server_busy",
  "invalid_uuid",
] as const;

/** What a provider says in particular. */
export type StatusCodeMinorValue = (typeof STATUS_CODES_MINOR)[number];

/**
 * The status that a provider returns with an answer that is not a success (Information Model 7.1.39), which the 1EdTech
 * services share: the `imsx_StatusInfo` of `@interopkit/core` with the codes of this binding.
 */
export type ImsxStatusInfo = StatusInfo<StatusCodeMinorValue>;
