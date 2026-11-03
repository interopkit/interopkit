import { type StatusDetail as DetailOf, readStatusDetail, type ServiceError } from "@interopkit/core";
import type { ImsxStatusInfo } from "../model/index.js";
import { readEntity } from "../read/index.js";

/** What a server said when it refused a request: the `imsx_StatusInfo` in the body of its answer, and how long it asks to wait. */
export type StatusDetail = DetailOf<ImsxStatusInfo>;

/**
 * Reads what a server said in the answer that made a call fail: its status, if the body is one, and how long it asks the
 * client to wait.
 *
 * @remarks
 * A server answers an error with an `imsx_StatusInfo` (OB B.3.1). A body that is not one, such as the page of a proxy, gives no
 * `info`. `Retry-After` is read when it is a number of seconds; the form that gives a date needs a clock, so the header stays in
 * `error.headers["retry-after"]` for a caller that wants it. Without a `Retry-After`, the specifications recommend two more
 * attempts 30 minutes apart (OB 6.5, CLR 5.5), and then telling the user. The client retries nothing itself.
 *
 * @param error - The error that a call of the client threw.
 * @returns The status and the delay, each left out when the answer does not give it.
 * @throws `DataError` when the argument is not a `ServiceError`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#retry-behavior | Open Badges 3.0, Retry Behavior}
 */
export function readStatusInfo(error: ServiceError): StatusDetail {
  return readStatusDetail(error, (json) => readEntity("imsx_StatusInfo", json));
}
