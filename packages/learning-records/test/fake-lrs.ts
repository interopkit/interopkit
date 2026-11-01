import type { Fetch } from "@interopkit/core";

/** What the fake LRS answers. */
export interface Reply {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Text and bytes are sent as they are; anything else as JSON. */
  readonly body?: unknown;
}

/** A request that reached the fake LRS. */
export interface Recorded {
  readonly url: string;
  readonly init: Parameters<Fetch>[1];
}

/** A `fetch` that records the requests and answers them with `handler`. */
export interface FakeLrs {
  readonly fetch: Fetch;
  readonly requests: Recorded[];
  /** The paths and queries of the requests, without the host. */
  readonly paths: () => string[];
}

/** The most requests that a fake LRS answers: a client that does not stop asking fails the test instead of running on. */
const MAX_REQUESTS = 50;

/** The body of a reply: text and bytes as they are, `undefined` as none, anything else as JSON. */
function bodyOf(body: unknown): string | Uint8Array<ArrayBuffer> | null {
  if (body === undefined) return null;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new Uint8Array(body);
  return JSON.stringify(body);
}

/** Builds an LRS for a test: `handler` sees the URL and the request, and answers with a status, headers and a body. */
export function fakeLrs(handler: (url: URL, request: Recorded) => Reply | Promise<Reply>): FakeLrs {
  const requests: Recorded[] = [];
  const fetch: Fetch = async (url, init) => {
    const request = { url, init };
    requests.push(request);
    if (requests.length > MAX_REQUESTS) throw new Error(`The fake LRS was asked more than ${MAX_REQUESTS} times.`);
    const reply = await handler(new URL(url), request);
    return new Response(bodyOf(reply.body), { status: reply.status ?? 200, headers: reply.headers });
  };
  return {
    fetch,
    requests,
    paths: () => requests.map(({ url }) => `${new URL(url).pathname}${new URL(url).search}`),
  };
}
