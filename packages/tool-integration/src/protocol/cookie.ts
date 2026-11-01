import type { HttpRequest } from "@interopkit/core/http";

/** Returns the value of the cookie of that name in the request, or `undefined` when the request has none. */
export function readCookie(request: HttpRequest, name: string): string | undefined {
  for (const pair of (request.headers.cookie ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at !== -1 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return undefined;
}
