import { callPort } from "@interopkit/core";
import { nonEmptyStringSchema, parseWith } from "@interopkit/core/checks";
import { bearerTokenOf, type HttpRequest, type HttpResponse } from "@interopkit/core/http";
import * as v from "valibot";
import type { EndpointSettings } from "./options.js";
import { internalError, unauthorized } from "./status.js";

/** What `authorize` gives for a request that is allowed: the principal, a name that the host chose. */
const grantSchema = v.object({ principal: nonEmptyStringSchema });

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
  const asked = await callPort(() => authorize(bearerTokenOf(request), { signal }), signal);
  if (asked === undefined) return { refusal: internalError() };
  if (asked.value === undefined) return { refusal: unauthorized() };
  return { principal: parseWith(grantSchema, asked.value, "The decision of authorize").principal };
}
