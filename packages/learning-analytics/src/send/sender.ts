// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import { clientOptionsEntries, type Fetch } from "@interopkit/core";
import { httpsUrlSchema, isAbsoluteUri, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";

// The credential of the Bearer scheme is a b64token (RFC 6750 section 2.1). It goes into a header, so a character outside
// this set, such as a line break, must never reach it.
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/u;

/** Where and as whom a sensor sends and asks. */
export interface CaliperSender {
  /** The address of the Caliper endpoint, an `https` URL (Caliper 1.2 section 5.4 requires TLS). */
  readonly endpoint: string;
  /**
   * The bearer token that the endpoint validates (RFC 6750 section 2.1). Caliper 1.2 section 5.4 recommends one, and an
   * endpoint that does not ask for one gets none.
   *
   * @defaultValue none: the request has no `Authorization` header
   */
  readonly token?: string;
  /** The `fetch` that makes the request: the global one, or a replacement. */
  readonly fetch: Fetch;
  /** The IRI that identifies the sensor, which is the application that sends. */
  readonly sensor: string;
  /**
   * The most time in milliseconds that the call may take, from the request to the last byte of the answer.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
}

/**
 * The schema of an absolute IRI, which Caliper requires for every entity, in the form that `readEvent` and `readEntity` take as
 * the `id` of an entity: a scheme, no white space, and a text that `URL` parses.
 */
export const iriSchema = v.pipe(
  v.string(),
  v.check(isAbsoluteUri, (issue) => `expected an absolute IRI, found ${issue.received}`),
);

/**
 * The options that the calls of a sensor read: a host keeps one object of them for `sendCaliper` and `pingEndpoint`, so that a
 * property that neither takes is refused and a shared object is not.
 */
const senderEntries = {
  endpoint: httpsUrlSchema,
  token: v.optional(
    v.pipe(
      v.string(),
      v.check(
        (token) => BEARER_TOKEN.test(token),
        "expected a bearer token of RFC 6750 section 2.1: letters, digits and -._~+/, then =",
      ),
    ),
  ),
  fetch: clientOptionsEntries.fetch,
  sensor: v.optional(iriSchema),
  // `formatDateTime` checks the time when it writes it.
  sendTime: v.optional(v.unknown()),
  timeoutMs: clientOptionsEntries.timeoutMs,
  maxPayloadBytes: v.optional(positiveIntegerSchema),
  signal: clientOptionsEntries.signal,
};

/** The options of `pingEndpoint`. */
export const pingOptionsSchema = strictRecord(senderEntries);

/** The options of `sendCaliper`, which requires a sensor. */
export const sendOptionsSchema = strictRecord({ ...senderEntries, sensor: iriSchema });

/** The header that carries the bearer token, and none when the sender has no token. */
export function bearerHeaders(token: string | undefined): Readonly<Record<string, string>> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}
