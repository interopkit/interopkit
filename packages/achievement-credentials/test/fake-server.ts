import type { Fetch } from "@interopkit/core";

/** A request that the fake server saw. */
export interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The address of the resource server in the tests. */
export const BASE = "https://badges.example.org";

/** A `fetch` that answers each request with `handler` and records it. */
export function fakeServer(handler: (seen: Seen) => Response | Promise<Response>): {
  readonly fetch: Fetch;
  readonly requests: Seen[];
} {
  const requests: Seen[] = [];
  const fetch: Fetch = async (url, init) => {
    const seen: Seen = {
      url,
      method: init.method,
      headers: init.headers,
      body: typeof init.body === "string" ? init.body : "",
    };
    requests.push(seen);
    return handler(seen);
  };
  return { fetch, requests };
}

/** An answer with a JSON body. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** An answer with a text body. */
export function text(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });
}

/** A compact JWS in shape, which the client sends and lists without reading. */
export const JWS = "aGVhZGVy.cGF5bG9hZA.c2ln";
