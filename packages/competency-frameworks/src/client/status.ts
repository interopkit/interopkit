import { type StatusDetail as DetailOf, readStatusDetail, type ServiceError } from "@interopkit/core";
import type { ImsxStatusInfo } from "../model/index.js";
import { readEntity } from "../read/index.js";

/** What a provider said when it refused a request: the `imsx_StatusInfo` in the body of its answer, and how long it asks to wait. */
export type StatusDetail = DetailOf<ImsxStatusInfo>;

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
  return readStatusDetail(error, (json) => readEntity("imsx_StatusInfo", json));
}
