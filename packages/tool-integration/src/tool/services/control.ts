import { type CallOptions, DataError } from "@interopkit/core";
import { checkHttpsUrl, checkRecord } from "@interopkit/core/checks";
import { type ControlRequest, type ControlStatus, SCOPES } from "../../protocol/index.js";
import {
  CONTROL_MEDIA_TYPE,
  readControlRequest,
  readControlStatus,
  writeControlRequest,
} from "../../protocol/internal.js";
import type { ServiceAccess } from "./access.js";

/** The client of the Assessment Control Service (Proctoring Services 1.0 section 5) of a platform. */
export interface ControlClient {
  /**
   * Sends an action on an attempt to the Assessment Control Service and returns the status of the attempt after it.
   *
   * @remarks
   * The request names the attempt as the Start Proctoring message did: the user by the issuer and the `sub` of the message, the
   * resource link and the attempt number. The service may be called after the attempt ended, to flag it, and `update` polls the
   * status. A platform that cannot take the action answers the status unchanged (Proctoring Services 1.0 section 5.1.4); a 404 is
   * a `ServiceError`, for an attempt that the platform does not know.
   *
   * @param url - The `assessmentControl.url` of the Start Proctoring message.
   * @param request - The attempt and the action, with the incident and the extra time when there are any.
   * @throws `DataError` when an argument has the wrong type or the request breaks a rule of Proctoring Services 1.0 section 5.1.
   */
  control(url: string, request: ControlRequest, options?: CallOptions): Promise<ControlStatus>;
}

/** Writes a control request that the host gave, and reads it back: the reader is the check of the request against section 5.1. */
function controlBody(request: unknown): ReturnType<typeof writeControlRequest> {
  checkRecord(request, "The control request must be an object");
  try {
    const written = writeControlRequest(request as unknown as ControlRequest);
    readControlRequest(written);
    return written;
  } catch (error) {
    // The writer takes the types of the model, and a member of another kind, such as `null` for the user, fails it with a TypeError.
    if (error instanceof TypeError) throw new DataError(`The control request is not one: ${error.message}.`);
    throw error;
  }
}

/** Makes the client of the Assessment Control Service over the access to the services of a platform. */
export function controlClient(access: ServiceAccess): ControlClient {
  return {
    async control(url, request, options) {
      checkHttpsUrl(url, "The URL of the Assessment Control Service");
      const body = { type: CONTROL_MEDIA_TYPE, json: controlBody(request) };
      const init = { method: "POST", scopes: [SCOPES.assessmentControl], accept: CONTROL_MEDIA_TYPE, body } as const;
      const response = await access.request(url, init, options);
      return access.read(response, `The Assessment Control Service at ${url}`, readControlStatus);
    },
  };
}
