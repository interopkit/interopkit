import * as v from "valibot";
import { checkNonEmptyString, describe, nonEmptyStringSchema, parseWith, strictRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { ACCESS_REFUSAL_STATUSES, type AccessRefusal, type AccessRefusalReason, refusalSchema } from "./access.js";
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

/**
 * The codes of the detail that a service names for each reason of a refusal.
 *
 * @typeParam TMinor - The codes of the service.
 */
export type RefusalCodes<TMinor extends string = string> = Readonly<Record<AccessRefusalReason, TMinor>>;

const refusalCodesSchema = strictRecord({
  unauthenticated: nonEmptyStringSchema,
  forbidden: nonEmptyStringSchema,
  "too-many-requests": nonEmptyStringSchema,
});

const refusalOptionsSchema = strictRecord({ forbiddenHeaders: v.optional(v.record(v.string(), v.string())) });

/** The options of `buildRefusalResponse`. */
export interface RefusalResponseOptions {
  /**
   * More headers of a `forbidden` answer, such as the `WWW-Authenticate` challenge of RFC 6750 that names the scope a token
   * lacks.
   *
   * @defaultValue none
   */
  readonly forbiddenHeaders?: Readonly<Record<string, string>>;
}

/**
 * Builds the answer to a request that a host's port refuses: 401, 403 or 429 with an `imsx_StatusInfo` that carries the code
 * of the service for the reason.
 *
 * @remarks
 * The message is the host's when it gives one, else a sentence for the reason. A 401 carries the challenge of the refusal in
 * `WWW-Authenticate`, `Bearer` when it gives none, and a 429 carries `Retry-After` when the refusal gives the seconds.
 *
 * @param refusal - The refusal, as `readAccessDecision` reads it.
 * @param codes - The code of the detail for each reason, from the vocabulary of the service, such as `server_busy` for
 * `too-many-requests`.
 * @param options - More headers of a `forbidden` answer.
 * @returns The answer.
 * @throws `DataError` when an argument is of the wrong type or the message is empty.
 */
export function buildRefusalResponse(
  refusal: AccessRefusal,
  codes: RefusalCodes,
  options: RefusalResponseOptions = {},
): HttpResponse {
  const { reason, message, challenge, retryAfterSeconds } = parseWith(refusalSchema, refusal, "The refusal");
  const minors = parseWith(refusalCodesSchema, codes, "The codes of the refusals");
  const { forbiddenHeaders = {} } = parseWith(refusalOptionsSchema, options, "The options of buildRefusalResponse");
  const status = ACCESS_REFUSAL_STATUSES[reason];
  const minor = minors[reason];
  if (reason === "unauthenticated") {
    return buildStatusInfoResponse(status, message ?? "The request was not authorized.", {
      minor,
      headers: { "www-authenticate": challenge ?? "Bearer" },
    });
  }
  if (reason === "forbidden") {
    return buildStatusInfoResponse(status, message ?? "The request is not allowed.", {
      minor,
      headers: forbiddenHeaders,
    });
  }
  return buildStatusInfoResponse(
    status,
    message ?? "The service is receiving too many requests: retry at a later time.",
    {
      minor,
      headers: retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) },
    },
  );
}
