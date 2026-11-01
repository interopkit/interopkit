/** The outcomes of a request as a whole (Information Model 7.4.4). */
export const STATUS_CODES_MAJOR = ["success", "processing", "failure", "unsupported"] as const;

/** The outcome of a request as a whole (Information Model 7.4.4). */
export type StatusCodeMajor = (typeof STATUS_CODES_MAJOR)[number];

/** How serious an outcome is (Information Model 7.4.6). */
export const STATUS_SEVERITIES = ["status", "warning", "error"] as const;

/** How serious the outcome is (Information Model 7.4.6). */
export type StatusSeverity = (typeof STATUS_SEVERITIES)[number];

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

/** One detail of a status (Information Model 7.1.38): the name of a field and its code. */
export interface StatusCodeMinorField {
  /** The name of the field, such as the name of the parameter that was refused. */
  readonly imsx_codeMinorFieldName: string;
  /** The code of the field. */
  readonly imsx_codeMinorFieldValue: StatusCodeMinorValue;
}

/** The details of a status (Information Model 7.1.37), at least one. */
export interface StatusCodeMinor {
  /** The details. */
  readonly imsx_codeMinorField: readonly StatusCodeMinorField[];
}

/**
 * The status that a provider returns with an answer that is not a success (Information Model 7.1.39), which the 1EdTech
 * services share.
 */
export interface ImsxStatusInfo {
  /** The outcome of the request as a whole. */
  readonly imsx_codeMajor: StatusCodeMajor;
  /** How serious the outcome is. */
  readonly imsx_severity: StatusSeverity;
  /** A description of the outcome, for people. */
  readonly imsx_description?: string;
  /** The details of the outcome. */
  readonly imsx_codeMinor?: StatusCodeMinor;
}
