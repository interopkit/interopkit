// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { finiteSchema, looseRecord, parseWith } from "@interopkit/core/checks";
import * as v from "valibot";
import { DATE_TIME, IDENTIFIER, resourceLinkSchema, STRING } from "../claims/index.js";
import { ATTEMPT_STATUSES, CONTROL_ACTIONS, type ControlRequest, type ControlStatus } from "./model.js";

/** The severity of an incident, from 0 to 1. The text of the specification prints it as a string in its example, which is read as the number it spells. */
const SEVERITY = v.pipe(
  v.union([finiteSchema, v.pipe(v.string(), v.regex(/^-?\d+(?:\.\d+)?$/u), v.transform(Number))]),
  v.minValue(0),
  v.maxValue(1),
);

const controlRequestSchema = v.pipe(
  looseRecord({
    user: looseRecord({ iss: STRING, sub: IDENTIFIER }),
    resource_link: resourceLinkSchema,
    attempt_number: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    action: v.picklist(CONTROL_ACTIONS),
    incident_time: v.optional(DATE_TIME),
    extra_time: v.optional(v.pipe(finiteSchema, v.minValue(0))),
    incident_severity: v.optional(SEVERITY),
    reason_code: v.optional(STRING),
    reason_msg: v.optional(STRING),
  }),
  v.transform(
    (claim): ControlRequest => ({
      user: { issuer: claim.user.iss, subject: claim.user.sub },
      resourceLink: claim.resource_link,
      attemptNumber: claim.attempt_number,
      action: claim.action,
      incidentTime: claim.incident_time,
      extraTime: claim.extra_time,
      incidentSeverity: claim.incident_severity,
      reasonCode: claim.reason_code,
      reasonMessage: claim.reason_msg,
    }),
  ),
);

const controlStatusSchema = v.pipe(
  looseRecord({ status: v.picklist(ATTEMPT_STATUSES), extra_time: v.optional(v.pipe(finiteSchema, v.minValue(0))) }),
  v.transform((claim): ControlStatus => ({ status: claim.status, extraTime: claim.extra_time })),
);

/**
 * Reads the request that a proctoring tool sent to the Assessment Control Service.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` that names the path of the first invalid member.
 */
export function readControlRequest(value: unknown): ControlRequest {
  return parseWith(controlRequestSchema, value, "The control request");
}

/** Reads the answer of the Assessment Control Service. @throws `DataError` that names the path of the first invalid member. */
export function readControlStatus(value: unknown): ControlStatus {
  return parseWith(controlStatusSchema, value, "The control status");
}
