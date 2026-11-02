import { checkHttpRequest, type HttpRequest, type HttpResponse } from "@interopkit/core/http";
import { keySetResponse } from "../protocol/internal.js";
import { methodNotAllowed, notFound, refusal } from "./answers.js";
import { answerAuthorization } from "./authorize.js";
import { PATHS } from "./config.js";
import { type PlatformRequestOptions, readRequestOptions } from "./options.js";
import { answerService } from "./services/routes.js";
import { storagePage } from "./storage.js";
import { answerToken } from "./token.js";

// Security Framework section 6.3 lets the issuer say how long a retriever may cache the key set. An hour matches the cache of
// the key sets that the package reads, so a rotation that waits one max-age is followed by both.
const KEY_SET_MAX_AGE_SECONDS = 3600;

/**
 * Answers every request to the platform's origin: the authentication requests, the key set, the token requests and the storage
 * page of LTI 1.3.
 *
 * @remarks
 * | Path | Methods | Answers |
 * | --- | --- | --- |
 * | `/authorize` | GET, POST | The tool's authentication request (Security Framework section 5.1.1): the page that posts the `id_token` of the kept message, or the authentication error response |
 * | `/jwks` | GET, HEAD | The public keys of `config.keys`, with `Cache-Control: public, max-age=3600` |
 * | `/token` | POST | The client-credentials grant with a JWT assertion (Security Framework section 4.1.1) |
 * | `/storage` | GET | The storage page of the client-side login (LTI Client Side OIDC 0.1) |
 * | `/contexts/{context}/line-items` | GET, POST | The line items of a context (AGS 3.2), over `services.gradebook` |
 * | `/contexts/{context}/line-items/{lineItem}` | GET, PUT, DELETE | A line item (AGS 3.2) |
 * | `/contexts/{context}/line-items/{lineItem}/results` | GET | The results of a line item (AGS 3.3) |
 * | `/contexts/{context}/line-items/{lineItem}/scores` | POST | A score of a line item (AGS 3.4) |
 * | `/contexts/{context}/memberships` | GET | The members of a context, or of a resource link with `rlid` (NRPS 2.0), over `services.roster` |
 * | `/contexts/{context}/groups` | GET | The groups of a context, or of a user in it (Context Groups 1.0), over `services.groups` |
 * | `/contexts/{context}/group-sets` | GET | The group sets of a context (Context Groups 1.0) |
 * | `/ims/afapnp/v1p0/users/{user}/activities/{activity}/afapnprecords` | GET | The preferences record of a user for an activity (AfA PNP Connector 1.0), over `services.preferences` |
 *
 * A route of a service exists only when its store is given. A request to it needs a bearer token of `/token` with one of the
 * scopes of the method among those that the registration still grants: 401 with `WWW-Authenticate: Bearer` without one, 403
 * `insufficient_scope` with too narrow a one. The store receives the caller and answers `undefined` for a context that is not
 * the caller's, which is 404, so that existence does not leak.
 *
 * A request for another origin than `config.origin` is 403, because the tool's frame is same-origin with any page of the
 * platform on the origin of the frame page; a path that names nothing is 404, and a method that a route does not serve is 405
 * with `Allow`. A body above `maxBodyBytes` is refused before it is parsed. The handler keeps no state of its own: the launches
 * are in `launches`, the single-use identifiers in `once`. It reads the time only from `clock`, answers 500 and says nothing of
 * the cause when a port rejects, and throws `DataError` only for a port that breaks its contract.
 *
 * @param request - The request.
 * @param options - The platform, its ports and its settings.
 * @returns The answer.
 * @throws `DataError` when the request or the options have the wrong type, or a port answers with something other than its
 * contract: a registration that is not one, a message of another launch, a `checkLaunch` or `once` that does not give a boolean.
 * @throws The reason of `options.signal` when it aborts before the answer is ready.
 */
export async function handlePlatformRequest(
  request: HttpRequest,
  options: PlatformRequestOptions,
): Promise<HttpResponse> {
  checkHttpRequest(request);
  const settings = readRequestOptions(options);
  const url = new URL(request.url);
  if (url.origin !== settings.config.origin) {
    return refusal(403, "wrong_origin", `The platform answers only at ${settings.config.origin}.`);
  }
  switch (url.pathname) {
    case PATHS.authorization:
      return answerAuthorization(request, settings);
    case PATHS.jwks:
      return keySetResponse(request, settings.config.keys, KEY_SET_MAX_AGE_SECONDS);
    case PATHS.token:
      return answerToken(request, settings);
    case PATHS.storage:
      if (request.method !== "GET") return methodNotAllowed(request.method, "GET");
      return storagePage(settings.config.frameOrigin, settings.toolFrame);
    default:
      return (await answerService(request, url, settings)) ?? notFound();
  }
}
