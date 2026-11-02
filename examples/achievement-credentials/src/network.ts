import type { Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";

/** A handler that a host routes the requests of one origin to. */
export type Handler = (request: HttpRequest) => Promise<HttpResponse>;

/** Builds a plain request from the arguments of a `fetch`, with header names in lower case as the handlers read them. */
function requestOf(url: string, init: Parameters<Fetch>[1]): HttpRequest {
  const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : (init.body ?? new Uint8Array());
  return {
    method: init.method,
    url,
    headers: Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value])),
    body,
  };
}

/**
 * Makes a `fetch` over a network in memory: a call to an origin reaches the handler of that origin and nothing else is
 * reachable. A real host passes `fetch`, which must refuse loopback, private and link-local addresses after resolution.
 */
export function createNetwork(hosts: Readonly<Record<string, Handler>>): Fetch {
  return async (url, init) => {
    const handler = hosts[new URL(url).origin];
    if (handler === undefined) throw new TypeError(`Nothing answers at ${new URL(url).origin}.`);
    const response = await handler(requestOf(url, init));
    // A status without a body takes no body at all.
    return new Response(response.body.length === 0 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}
