import { checkHttpRequest, type HttpRequest, type HttpResponse } from "@interopkit/core/http";
import { principalOf } from "./authorization.js";
import { configurationAnswer } from "./configuration.js";
import { type CaliperEndpointOptions, readEndpointOptions } from "./options.js";
import { receive } from "./receive.js";
import { notAllowed } from "./status.js";

/**
 * Answers a request to a Caliper endpoint: a POST of an envelope, which it reads and hands to `accept`, and a GET, which it
 * answers with its configuration.
 *
 * @remarks
 * The handler serves the one URL that the host mounts it at, and looks at no path. A POST runs its checks in this order, so that a
 * request that fails an early check costs nothing of the later ones: the method (405), the authorization (401), the media type
 * `application/json` (415), the size (413), the JSON within its limits and the four fields of the envelope (400), the version
 * (422), and then its items. It answers 200 with an empty body when `accept` has received the envelope. A GET runs the method and
 * the authorization, then answers 200 with the configuration of section 6.2. A request that is not authorized costs no parsing:
 * its body is not read.
 *
 * `authorize` names the principal that sent the request, and the `ReceivedEnvelope` carries that name, not the `sensor` of the
 * envelope, which the sender chose. An envelope is read with `validateEvent` and `validateEntity`: an item that does not read is
 * left out of `data` and named in `findings`, and with `strict` it refuses the envelope. Every failure is a problem detail
 * (RFC 9457) with the status of section 6.1; 405 names the methods in `Allow`, 401 carries `WWW-Authenticate: Bearer`, and 500
 * says nothing of the cause. The handler keeps no state, reads no clock and never dereferences an IRI or a context.
 *
 * The body limits bound parsing and not reading: the host caps the read of the request before it builds the `HttpRequest`.
 *
 * @param request - The request.
 * @param options - `authorize`, `accept` and the limits.
 * @returns The answer.
 * @throws `DataError` when the request or the options have the wrong type, or when `authorize` answers something that is
 * neither `undefined` nor a principal.
 * @throws The reason of the `signal` of the options, when it aborts before the answer is ready.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2#endpoint-0 | Caliper Analytics 1.2, Endpoint}
 */
export async function handleCaliperRequest(
  request: HttpRequest,
  options: CaliperEndpointOptions,
): Promise<HttpResponse> {
  checkHttpRequest(request);
  const settings = readEndpointOptions(options);
  const { method } = request;
  if (method !== "GET" && method !== "POST") return notAllowed(method);
  const caller = await principalOf(request, settings);
  if ("refusal" in caller) return caller.refusal;
  return method === "GET" ? configurationAnswer(settings) : receive(request, caller.principal, settings);
}
