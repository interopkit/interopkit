import * as v from "valibot";
import { checkNonEmptyString, describe, nonEmptyStringSchema, parseWith, strictRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { buildJsonResponse, type HttpResponse } from "./response.js";

/** The severities of a failure that the services of 1EdTech give: an error, or a status such as a resource not found. */
const FAILURE_SEVERITIES = ["error", "status"] as const;

/**
 * The `imsx_codeMinorFieldName` of every detail: the identity of the system that produced the code, which the services of 1EdTech
 * write as `TargetEndSystem` for the server itself.
 */
const STATUS_SOURCE = "TargetEndSystem";

/** The smallest and largest status of an answer that reports a failure: a 3xx is not one, and a status has three digits. */
const LOWEST_FAILURE = 400;
const HIGHEST_STATUS = 599;

const optionsSchema = strictRecord({
  minor: v.optional(nonEmptyStringSchema),
  severity: v.optional(v.picklist(FAILURE_SEVERITIES)),
  headers: v.optional(v.record(v.string(), v.string())),
});

/** The options of `buildStatusInfoResponse`. */
export interface StatusInfoOptions {
  /**
   * The code of the detail, from the vocabulary of the specification, such as `server_busy` or `invalid_uuid`.
   *
   * @defaultValue none: the status has no `imsx_codeMinor`
   */
  readonly minor?: string;
  /**
   * The `imsx_severity`: `"error"`, or `"status"` where the specification pairs the code with it, as Open Badges does with
   * `not_found`.
   *
   * @defaultValue `"error"`
   */
  readonly severity?: (typeof FAILURE_SEVERITIES)[number];
  /**
   * More headers of the answer, such as `Retry-After` or `Allow`.
   *
   * @defaultValue none
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Builds the answer of a failed request to a service of 1EdTech: the HTTP status and an `imsx_StatusInfo` with the code major
 * `failure`, a severity, a description and, when there is one, the code of the detail.
 *
 * @remarks
 * The REST bindings of CASE, Open Badges and CLR answer every failure with this body. A detail names the system that produced
 * it as `TargetEndSystem`. The body is JSON, `application/json;charset=UTF-8`.
 *
 * @param status - The HTTP status code, from 400 to 599.
 * @param description - What went wrong, as a sentence for people.
 * @param options - The code of the detail, the severity and more headers.
 * @returns The answer.
 * @throws `DataError` when the status is not a whole number from 400 to 599, the description is empty, or an option is of the
 * wrong type.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#org.1edtech.ob.v3p0.imsx_statusinfo.class | Open Badges 3.0, Imsx_StatusInfo}
 */
export function buildStatusInfoResponse(
  status: number,
  description: string,
  options: StatusInfoOptions = {},
): HttpResponse {
  if (!Number.isSafeInteger(status) || status < LOWEST_FAILURE || status > HIGHEST_STATUS) {
    throw new DataError(`The status must be a whole number from 400 to 599, found ${describe(status)}.`);
  }
  checkNonEmptyString(description, "The description");
  const {
    minor,
    severity = "error",
    headers = {},
  } = parseWith(optionsSchema, options, "The options of buildStatusInfoResponse");
  const body = {
    imsx_codeMajor: "failure",
    imsx_severity: severity,
    imsx_description: description,
    ...(minor === undefined
      ? {}
      : {
          imsx_codeMinor: {
            imsx_codeMinorField: [{ imsx_codeMinorFieldName: STATUS_SOURCE, imsx_codeMinorFieldValue: minor }],
          },
        }),
  };
  return buildJsonResponse(status, body, { headers });
}
