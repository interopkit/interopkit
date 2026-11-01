import { DataError, ServiceError } from "@interopkit/core";
import type { ImsxStatusInfo } from "../model/index.js";
import { readEntity } from "../read/index.js";

/** The most digits of a number of seconds in `Retry-After`: more are not a delay a client can wait. */
const SECONDS = /^\d{1,15}$/u;

/** What a provider said when it refused a request. */
export interface StatusDetail {
  /** The `imsx_StatusInfo` in the body of the answer, when it has one that reads. */
  readonly info?: ImsxStatusInfo;
  /** The seconds that `Retry-After` asks the client to wait, when it gives a number of seconds. */
  readonly retryAfterSeconds?: number;
}

/**
 * Reads what a provider said in the answer that made a call fail: its status, if the body is one, and how long it asks the
 * client to wait.
 *
 * @remarks
 * A provider answers an error with an `imsx_StatusInfo` (REST binding 2.4) that names the cause in `imsx_codeMinor`, such as
 * `invalid_filter_field` or `server_busy`. A body that is not one, such as the page of a proxy, gives no `info`. `Retry-After`
 * is read when it is a number of seconds; the form that gives a date needs a clock, so the header stays in
 * `error.headers["retry-after"]` for a caller that wants it. The client retries nothing itself.
 *
 * @param error - The error that a call of the client threw.
 * @returns The status and the delay, each left out when the answer does not give it.
 * @throws `DataError` when the argument is not a `ServiceError`.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1, REST binding 2.4}
 */
export function readStatusInfo(error: ServiceError): StatusDetail {
  if (!(error instanceof ServiceError)) throw new DataError("The error must be a ServiceError.");
  const detail: { info?: ImsxStatusInfo; retryAfterSeconds?: number } = {};
  try {
    detail.info = readEntity("imsx_StatusInfo", JSON.parse(error.body));
  } catch {
    // A body that is not JSON, or not a status, is an answer without detail and not a fault of the caller.
  }
  const delay = error.headers["retry-after"]?.trim();
  if (delay !== undefined && SECONDS.test(delay)) detail.retryAfterSeconds = Number(delay);
  return detail;
}
