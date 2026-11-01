import type { Fetch } from "@interopkit/core";

/** What the fake provider answers. */
export interface Reply {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Text is sent as it is; anything else as JSON. */
  readonly body?: unknown;
}

/** A request that reached the fake provider. */
export interface Recorded {
  readonly url: string;
  readonly init: Parameters<Fetch>[1];
}

/** A `fetch` that records the requests and answers them with `handler`. */
export interface FakeProvider {
  readonly fetch: Fetch;
  readonly requests: Recorded[];
  /** The paths and queries of the requests, without the host. */
  readonly paths: () => string[];
}

/** The most requests that a fake provider answers: a client that does not stop asking fails the test instead of running on. */
const MAX_REQUESTS = 50;

/** Builds a provider for a test: `handler` sees the URL and the request, and answers with a status, headers and a body. */
export function fakeProvider(handler: (url: URL, request: Recorded) => Reply | Promise<Reply>): FakeProvider {
  const requests: Recorded[] = [];
  const fetch: Fetch = async (url, init) => {
    const request = { url, init };
    requests.push(request);
    if (requests.length > MAX_REQUESTS) throw new Error(`The fake provider was asked more than ${MAX_REQUESTS} times.`);
    const reply = await handler(new URL(url), request);
    const body =
      reply.body === undefined ? null : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(body, { status: reply.status ?? 200, headers: reply.headers });
  };
  return {
    fetch,
    requests,
    paths: () => requests.map(({ url }) => `${new URL(url).pathname}${new URL(url).search}`),
  };
}
