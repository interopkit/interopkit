import { type HttpResponse, jsonResponse } from "@interopkit/core/http";
import { SCOPES } from "../../protocol/index.js";
import {
  CONTROL_MEDIA_TYPE,
  readControlRequest,
  readControlStatus,
  writeControlStatus,
} from "../../protocol/internal.js";
import { notFound } from "../answers.js";
import type { ServiceClaims } from "../messages/write.js";
import type { AssessmentControl } from "../ports.js";
import { readBody } from "./body.js";
import { askStore, type ClaimRequest, fromStore, type Service, type ServiceRequest } from "./service.js";

/** The path of the Assessment Control Service: one endpoint, since a request names its attempt in its body. */
const CONTROL_PATH = "/assessment-control";

/**
 * POST of a control request (Proctoring Services 1.0 section 5): the attempt that the user, the resource link and the attempt
 * number name, and the action on it. An attempt of a user of another issuer is not one of this platform's, so it is 404 without a
 * call of the store; so is an attempt that the store does not give the caller.
 */
async function postControl(call: ServiceRequest<AssessmentControl>): Promise<HttpResponse> {
  const { request, store, caller, settings } = call;
  const input = readBody(request, CONTROL_MEDIA_TYPE, settings.maxBodyBytes, readControlRequest);
  if ("status" in input) return input;
  const asked = input.value;
  if (asked.user.issuer !== settings.config.issuer) return notFound();
  const found = await askStore(call, (options) => store.control(caller, asked, options));
  if (found === undefined) return notFound();
  const status = fromStore("AssessmentControl.control", () => readControlStatus(writeControlStatus(found)));
  return jsonResponse(200, writeControlStatus(status), {}, CONTROL_MEDIA_TYPE);
}

/**
 * Writes the claim of the Assessment Control Service (Proctoring Services 1.0 section 4.2.2.6) into a message that offers it, which
 * the reader of the host's messages allows only in a Start Proctoring message: the address of the service and the actions that the
 * message says the platform supports.
 */
function controlClaim({ message, origin }: ClaimRequest): ServiceClaims {
  const asked = message.services?.control;
  if (asked === undefined) return {};
  return { assessmentControl: { url: `${origin}${CONTROL_PATH}`, actions: [...asked.actions] } };
}

/** The Assessment Control Service of Proctoring Services over the host's `AssessmentControl`. */
export const CONTROL: Service<"control"> = {
  store: "control",
  scopes: [SCOPES.assessmentControl],
  claim: controlClaim,
  routes: [
    {
      path: CONTROL_PATH,
      methods: { POST: { scopes: [SCOPES.assessmentControl], uses: "control", handle: postControl } },
    },
  ],
};
