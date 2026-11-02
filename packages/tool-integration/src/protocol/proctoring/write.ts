// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { DataError } from "@interopkit/core";
import { describe, type JsonValue } from "@interopkit/core/checks";
import { compact } from "../claims/index.js";
import type { ControlRequest, ControlStatus } from "./model.js";

/**
 * Writes the request of a proctoring tool, as `readControlRequest` reads it.
 *
 * @throws `DataError` when the severity is not from 0 to 1.
 */
export function writeControlRequest(request: ControlRequest): Record<string, JsonValue> {
  const { incidentSeverity } = request;
  if (incidentSeverity !== undefined && !(incidentSeverity >= 0 && incidentSeverity <= 1)) {
    throw new DataError(
      `The incident severity of a control request must be from 0 to 1, found ${describe(incidentSeverity)}.`,
    );
  }
  return compact({
    user: { iss: request.user.issuer, sub: request.user.subject },
    resource_link: compact({ ...request.resourceLink }),
    attempt_number: request.attemptNumber,
    action: request.action,
    incident_time: request.incidentTime,
    extra_time: request.extraTime,
    incident_severity: incidentSeverity,
    reason_code: request.reasonCode,
    reason_msg: request.reasonMessage,
  });
}

/** Writes the answer of the Assessment Control Service, as `readControlStatus` reads it. */
export function writeControlStatus(status: ControlStatus): Record<string, JsonValue> {
  return compact({ status: status.status, extra_time: status.extraTime });
}
