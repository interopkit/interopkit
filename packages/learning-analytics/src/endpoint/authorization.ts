import { callPort } from "@interopkit/core";
import { nonEmptyStringSchema, parseWith } from "@interopkit/core/checks";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import * as v from "valibot";
import type { EndpointSettings } from "./options.js";
import { internalError, unauthorized } from "./status.js";

/** A request that says `Bearer` and a b64token (RFC 6750 section 2.1); the scheme is case-insensitive (RFC 9110 section 11.1). */
const BEARER = /^bearer +([A-Za-z0-9\-._~+/]+=*)$/iu;

/** What `authorize` gives for a request that is allowed: the principal, a name that the host chose. */
const grantSchema = v.object({ principal: nonEmptyStringSchema });

/** Reads the bearer token of a request, and gives `undefined` when it has no `Authorization` header or another scheme. */
function tokenOf(request: HttpRequest): string | undefined {
  return BEARER.exec(request.headers.authorization ?? "")?.[1];
}

/**
 * Asks `authorize` who sends a request, before anything of its body is read.
 *
 * @returns The principal, or the answer that refuses the request: 401 when `authorize` gives none, and 500 when it fails.
 * @throws `DataError` when `authorize` answers something other than `undefined` or an object with a `principal`.
 */
export async function principalOf(
  request: HttpRequest,
  settings: EndpointSettings,
): Promise<{ readonly principal: string } | { readonly refusal: HttpResponse }> {
  const { authorize, signal } = settings;
  const asked = await callPort(() => authorize(tokenOf(request), { signal }), signal);
  if (asked === undefined) return { refusal: internalError() };
  if (asked.value === undefined) return { refusal: unauthorized() };
  return { principal: parseWith(grantSchema, asked.value, "The decision of authorize").principal };
}
