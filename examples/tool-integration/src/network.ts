import type { Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/tool-integration";

/** A handler of a system: it takes a plain request and gives a plain answer. */
export type Handler = (request: HttpRequest) => Promise<HttpResponse>;

/** Builds a plain request, with header names in lower case as the handlers read them. */
export function plainRequest(
  method: string,
  url: string,
  headers: Readonly<Record<string, string>> = {},
  body = "",
): HttpRequest {
  return {
    method,
    url,
    headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
    body,
  };
}

/**
 * Connects the systems by origin: a `fetch` whose calls reach the handler of the origin they are for, so that the tool's
 * calls to the platform need no network. An origin that nothing serves is a failure of the network.
 */
export function connect(systems: Readonly<Record<string, Handler>>): Fetch {
  return async (url, init) => {
    const handler = systems[new URL(url).origin];
    if (handler === undefined) throw new TypeError(`No system answers at ${new URL(url).origin}.`);
    const response = await handler(plainRequest(init.method, url, init.headers, init.body ?? ""));
    // A status without a body, such as 204, takes no body at all.
    return new Response(response.body === "" ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}
