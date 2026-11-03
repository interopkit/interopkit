import { callPort } from "@interopkit/core";
import { nonEmptyStringSchema } from "@interopkit/core/checks";
import {
  buildJsonResponse,
  checkHttpRequest,
  type HttpRequest,
  type HttpResponse,
  readAccessDecision,
} from "@interopkit/core/http";
import * as v from "valibot";
import { API_SCOPES, type ScopedOperation } from "../model/internal.js";
import { answerList, answerUpsert } from "./credentials.js";
import {
  type CredentialsProviderOptions,
  type ProviderSettings,
  readDescription,
  readProviderOptions,
} from "./options.js";
import { answerProfile, answerProfileUpdate } from "./profile.js";
import { routeOf } from "./routes.js";
import { internalError, notAllowed, notFound, refused } from "./status.js";

/** What an allowed decision of `authorize` carries: the owner of the resources that the token reaches. */
const grantSchema = v.object({ owner: nonEmptyStringSchema });

/** Asks `authorize` whether the access token of a request holds the scope of its operation, and returns the owner or a refusal. */
async function ownerOf(
  request: HttpRequest,
  scope: string,
  settings: ProviderSettings,
): Promise<{ readonly owner: string } | { readonly refusal: HttpResponse }> {
  const { authorize, signal } = settings;
  const asked = await callPort(() => authorize(request, scope, { signal }), { signal });
  if (asked === undefined) return { refusal: internalError() };
  const decision = readAccessDecision(asked.value, "The decision of authorize", { grant: grantSchema });
  if (decision.allowed) return { owner: decision.owner };
  return { refusal: refused(decision, scope) };
}

/** Answers an operation that needs a scope, for the owner that `authorize` named. */
function answerFor(
  operation: ScopedOperation,
  request: HttpRequest,
  owner: string,
  settings: ProviderSettings,
): Promise<HttpResponse> {
  switch (operation) {
    case "getCredentials":
      return answerList(request, owner, settings);
    case "upsertCredential":
      return answerUpsert(request, owner, settings);
    case "getProfile":
      return answerProfile(owner, settings);
    case "putProfile":
      return answerProfileUpdate(request, owner, settings);
  }
}

/**
 * Answers a request of the Open Badges API or the CLR Standard API, as the resource server: the credentials and the profile of
 * the user whose access token the request carries, and the service description.
 *
 * @remarks
 * The endpoints are below `{basePath}/ims/ob/v3p0` or `{basePath}/ims/clr/v2p0`: `GET` and `POST /credentials`, `GET` and
 * `PUT /profile`, and `GET /discovery`, which is public. For every other endpoint the handler asks `authorize` whether the
 * token holds the scope of the operation and whose resources it reaches, and answers 401, 403 or 429 as it refuses.
 *
 * The list takes `limit`, `offset` and `since`, and answers the objects in `credential` and the compact JWS in
 * `compactJwsString`, with `X-Total-Count` when the store can count and `Link`. An upsert takes a credential as JSON
 * (`application/json` or `application/vc+ld+json`) or as a compact JWS (`text/plain`) of at most `maxBodyBytes`, reads it as
 * the credential that the API exchanges, verifies it when `verify` is set, and answers as the store decides: 201 or 200 with
 * the credential of the request, or 304 with no body. A profile is read and replaced whole. Every failure is an
 * `imsx_StatusInfo` with the code of Open Badges B.3.6: 400 for a query or a body that cannot be read, 404 for another path and
 * for no profile, 405, 413 and 415, 422 for a body that is not a credential or a profile of the API or does not verify, and
 * 500 when a port rejects.
 *
 * The URL of the request is the one the client used, and the `Link` header is built from it. The handler keeps no state and
 * reads no clock.
 *
 * @param request - The request.
 * @param options - The API, the stores, `authorize`, the service description and the settings.
 * @returns The answer.
 * @throws `DataError` when the request or the options have the wrong type, when the service description lacks what a client
 * needs, or when a port answers something other than its contract.
 * @throws The reason of the `signal` of the options, when it aborts before the answer is ready.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#open-badges-api | Open Badges 3.0, Open Badges API}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/#clr-standard-api | CLR 2.0, CLR Standard API}
 */
export async function handleCredentialsRequest(
  request: HttpRequest,
  options: CredentialsProviderOptions,
): Promise<HttpResponse> {
  checkHttpRequest(request);
  const settings = readProviderOptions(options);
  const route = routeOf(new URL(request.url).pathname, settings);
  if (route === undefined) return notFound();
  const operation = route.get(request.method);
  if (operation === undefined) return notAllowed(request.method, [...route.keys()]);
  if (operation === "getServiceDescription") return buildJsonResponse(200, readDescription(settings));
  const access = await ownerOf(request, API_SCOPES[settings.api][operation], settings);
  if ("refusal" in access) return access.refusal;
  return answerFor(operation, request, access.owner, settings);
}
