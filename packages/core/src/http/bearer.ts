import type { HttpRequest } from "./request.js";

/**
 * The credentials of the bearer scheme (RFC 6750 section 2.1): `Bearer`, in any case (RFC 9110 section 11.1), one or more
 * spaces, and a b64token.
 */
const BEARER = /^bearer +([A-Za-z0-9\-._~+/]+=*)$/iu;

/**
 * Returns the bearer token of a request: the credentials of its `Authorization` header in the bearer scheme.
 *
 * @remarks
 * The scheme is read in any case and may be followed by more than one space, as RFC 6750 section 2.1 writes it. A header of
 * another scheme, or whose credentials are not one b64token, gives no token, so that a handler answers it as a request
 * without one. What the token grants is the host's to decide.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @returns The token, or `undefined` when the request has no `Authorization` header, or one of another scheme or form.
 * @see {@link https://www.rfc-editor.org/rfc/rfc6750#section-2.1 | RFC 6750 section 2.1}
 */
export function readBearerToken(request: HttpRequest): string | undefined {
  const header = request.headers.authorization;
  return header === undefined ? undefined : BEARER.exec(header)?.[1];
}
