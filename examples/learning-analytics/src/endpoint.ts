import type { CallOptions, Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { CaliperVersion } from "@interopkit/learning-analytics";
import { handleCaliperRequest, type ReceivedEnvelope } from "@interopkit/learning-analytics/endpoint";

/** A sender that may post: the bearer token it presents, and the name the endpoint gives it. */
interface Sender {
  readonly token: string;
  readonly principal: string;
}

/** What the host sets for the example endpoint. */
export interface EndpointConfig {
  /** The address of the endpoint before its path, such as `https://lrs.example`. */
  readonly origin: string;
  /** The path the endpoint is mounted at. @defaultValue `"/caliper"` */
  readonly path?: string;
  /** The senders that may post. */
  readonly senders: readonly Sender[];
  /** The versions of Caliper that the endpoint reads. @defaultValue both, 1.2 and 1.1 */
  readonly versions?: readonly CaliperVersion[];
}

/** An event or an entity that the endpoint holds. */
export interface Stored {
  /** The `id` the item is kept by. */
  readonly id: string;
  /** The `type` of the item. */
  readonly type: string;
  /** Who sent it, as the endpoint named them for the token. */
  readonly principal: string;
  /** The context of the Caliper version of the envelope it came in. */
  readonly dataVersion: string;
}

/** One POST that the endpoint answered: what it said, and what it did with the envelope. */
export interface Logged {
  readonly status: number;
  /** The version of the envelope, when it was read. */
  readonly dataVersion?: string;
  /** How many items were new, how many were held already, and how many findings the envelope had. */
  readonly stored: number;
  readonly again: number;
  readonly findings: readonly string[];
}

/** The example endpoint: the handler that a web framework routes requests to, a `fetch` for a sender in the same process, and what it holds. */
export interface Endpoint {
  readonly handle: (request: HttpRequest, options?: CallOptions) => Promise<HttpResponse>;
  readonly fetch: Fetch;
  /** The events and entities held, each once by `id`, in the order they first arrived. */
  readonly held: () => readonly Stored[];
  /** The POSTs it received that were read, in order. */
  readonly log: () => readonly Logged[];
}

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
 * Creates the example endpoint: `handleCaliperRequest` over a table of tokens and a store in memory, and a `fetch` for a sender
 * in the same process.
 *
 * It keeps an event once by its `id`, since Caliper defines no deduplication and a sensor that sends again carries the same
 * identifiers, and replaces an entity by the describe that arrives last. It keeps what an envelope of either version holds in
 * the same shape, because the readers give both versions one model.
 */
export function createEndpoint(config: EndpointConfig): Endpoint {
  const { origin, path = "/caliper", senders, versions } = config;
  const held = new Map<string, Stored>();
  const log: Logged[] = [];

  const accept = async (envelope: ReceivedEnvelope): Promise<void> => {
    let stored = 0;
    let again = 0;
    for (const item of envelope.data) {
      // The entities with no `id` mean something only inside another entity, so there is nothing to keep them by.
      if (!("id" in item)) continue;
      const entity = !item.type.endsWith("Event") && item.type !== "Event";
      const known = held.has(item.id);
      // An entity describe tells the latest of the entity, so it replaces; an event happened once, so a copy is dropped.
      if (known && !entity) {
        again += 1;
        continue;
      }
      if (known) again += 1;
      else stored += 1;
      held.set(item.id, {
        id: item.id,
        type: item.type,
        principal: envelope.principal,
        dataVersion: envelope.dataVersion,
      });
    }
    log.push({
      status: 200,
      dataVersion: envelope.dataVersion,
      stored,
      again,
      findings: envelope.findings.map(({ severity, path: where, rule }) => `${severity} ${where} ${rule}`),
    });
  };

  // The token is compared with each known token in a loop that does not stop at the first match, so that the time of a refusal
  // does not say how much of a token was right; the sender is named by the table and not by anything in the envelope.
  const authorize = async (token: string | undefined) => {
    let found: Sender | undefined;
    for (const sender of senders) if (token === sender.token) found = sender;
    return found === undefined ? undefined : { principal: found.principal };
  };

  const handle = (request: HttpRequest, options?: CallOptions): Promise<HttpResponse> =>
    handleCaliperRequest(request, { ...options, authorize, accept, ...(versions === undefined ? {} : { versions }) });

  const fetch: Fetch = async (url, init) => {
    if (new URL(url).origin + new URL(url).pathname !== `${origin}${path}`) {
      throw new TypeError(`Nothing answers at ${url}.`);
    }
    const response = await handle(requestOf(url, init), { signal: init.signal });
    if (init.method === "POST" && response.status !== 200) {
      log.push({ status: response.status, stored: 0, again: 0, findings: [] });
    }
    // A status without a body takes no body at all.
    return new Response(response.body.length === 0 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
  return { handle, fetch, held: () => [...held.values()], log: () => [...log] };
}
