import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { SOUND_EVENT } from "../../../scripts/caliper-rules.js";
import type { CaliperEndpointOptions, ReceivedEnvelope } from "../src/endpoint/index.js";
import { CALIPER_CONTEXT, type CaliperEvent, readEvent } from "../src/index.js";
import { eventAt } from "./fixture.js";

/** The URL that the endpoint is mounted at in the tests. */
export const ENDPOINT = "https://lrs.example/caliper";

/** The text of a body, as the bytes of a request carry it. */
export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A request with the media type of JSON and the bearer token of the tests, and what a test changes. */
export function request(
  body: string | Uint8Array,
  changes: { readonly method?: string; readonly headers?: Readonly<Record<string, string>> } = {},
): HttpRequest {
  return {
    method: changes.method ?? "POST",
    url: ENDPOINT,
    headers: { "content-type": "application/json", authorization: "Bearer token-123", ...changes.headers },
    body: typeof body === "string" ? bytesOf(body) : body,
  };
}

/** An event that follows every rule of its profile, with the identifier of the event at the index. */
export const soundAt = (index: number): CaliperEvent => readEvent({ ...SOUND_EVENT, id: eventAt(index).id });

/** The envelope that a sensor sends: the four properties, and what a test changes. */
export function envelopeOf(
  data: readonly unknown[] = [soundAt(0), soundAt(1)],
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sensor: "https://exam.example/sensors/1",
    sendTime: "2023-11-14T22:13:20.000Z",
    dataVersion: CALIPER_CONTEXT,
    data,
    ...changes,
  };
}

/** The request that posts an envelope. */
export const post = (envelope: Record<string, unknown> = envelopeOf()): HttpRequest =>
  request(JSON.stringify(envelope));

/** What an endpoint of the tests did: the tokens it was asked about, the envelopes it received, and the options for the handler. */
export interface Recorder {
  readonly tokens: (string | undefined)[];
  readonly received: ReceivedEnvelope[];
  readonly options: CaliperEndpointOptions;
}

/** An endpoint that names the principal `tool-7` for any token, and keeps every envelope. A test changes the options. */
export function recorder(changes: Partial<CaliperEndpointOptions> = {}): Recorder {
  const tokens: (string | undefined)[] = [];
  const received: ReceivedEnvelope[] = [];
  const options: CaliperEndpointOptions = {
    authorize: async (token) => {
      tokens.push(token);
      return { principal: "tool-7" };
    },
    accept: async (envelope) => {
      received.push(envelope);
    },
    ...changes,
  };
  return { tokens, received, options };
}

/** The text of the body of an answer. */
export const textOf = (response: HttpResponse): string =>
  typeof response.body === "string" ? response.body : new TextDecoder().decode(response.body);

/** A request whose body counts how often it is read, so that a test can tell that a handler left it alone. */
export function spied(body: string): { readonly request: HttpRequest; readonly reads: () => number } {
  let reads = 0;
  const bytes = bytesOf(body);
  const base = request(body);
  const watched = {
    ...base,
    get body() {
      reads += 1;
      return bytes;
    },
  };
  return { request: watched, reads: () => reads };
}
