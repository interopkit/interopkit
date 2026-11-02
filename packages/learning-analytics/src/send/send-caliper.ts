// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import { type CallOptions, callService, DataError, type Fetch } from "@interopkit/core";
import {
  checkArray,
  checkHttpsUrl,
  checkNonEmptyString,
  checkRecord,
  checkString,
  describe,
} from "@interopkit/core/checks";
import { caliperTime, checkIri } from "../build/index.js";
import { CALIPER_CONTEXT, type CaliperEvent, LIBRARY_PROFILE_CONTEXT } from "../model/index.js";

/** The time that a call to the endpoint may take when the host sets none, in milliseconds. */
export const DEFAULT_CALIPER_TIMEOUT_MS = 10_000;

// The credential of the Bearer scheme is a b64token (RFC 6750 section 2.1). It goes into a header, so a character outside
// this set, such as a line break, must never reach it.
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/u;

/** Where and as whom `sendCaliper` sends. */
export interface CaliperSender {
  /** The address of the Caliper endpoint, an `https` URL (Caliper 1.2 section 5.4 requires TLS). */
  readonly endpoint: string;
  /** The bearer token that the endpoint validates (RFC 6750 section 2.1). */
  readonly token: string;
  /** The `fetch` that makes the request: the global one, or a replacement. */
  readonly fetch: Fetch;
  /** The IRI that identifies the sensor, which is the application that sends. */
  readonly sensor: string;
  /**
   * The most time in milliseconds that the call may take, from the request to the last byte of the answer.
   *
   * @defaultValue {@link DEFAULT_CALIPER_TIMEOUT_MS}, `10000`
   */
  readonly timeoutMs?: number;
}

/** The options of {@link sendCaliper}: the sender, when it sends, and the signal that ends the caller's wait. */
export interface SendCaliperOptions extends CaliperSender, CallOptions {
  /** The time at which the sensor issues the message, in epoch milliseconds. A resend has the time of the resend. */
  readonly sendTime: number;
}

/** Checks the events to send: at least one, each an event with the Caliper context and an identifier. */
function checkEvents(events: unknown): asserts events is readonly CaliperEvent[] {
  checkArray(events, "The Caliper events must be an array");
  if (events.length === 0) throw new DataError("The Caliper events must have at least one event, as an envelope does.");
  events.forEach((event, at) => {
    checkRecord(event, `The Caliper event ${at} must be an object`);
    const context = event["@context"];
    const last = Array.isArray(context) ? context.at(-1) : context;
    if (last !== CALIPER_CONTEXT && last !== LIBRARY_PROFILE_CONTEXT) {
      throw new DataError(
        `The @context of the Caliper event ${at} must be ${CALIPER_CONTEXT}, the context of the Library Use Profile, or a list that ends with one of them, found ${describe(context)}.`,
      );
    }
    checkNonEmptyString(event.id, `The id of the Caliper event ${at}`);
  });
}

/**
 * Checks the options that the sensor reads itself, as a host passes them from JavaScript. `fetch`, `timeoutMs` and
 * `signal` are checked by the call to the service.
 */
function checkOptions(value: unknown): asserts value is SendCaliperOptions {
  checkRecord(value, "The options must be an object");
  checkHttpsUrl(value.endpoint, "The option endpoint");
  checkString(value.token, "The option token");
  if (!BEARER_TOKEN.test(value.token)) {
    throw new DataError(
      "The option token must be a bearer token of RFC 6750 section 2.1: letters, digits and -._~+/, then =.",
    );
  }
  checkIri(value.sensor, "The option sensor");
}

/**
 * Sends events to a Caliper endpoint in one envelope.
 *
 * @remarks
 * The request is a POST over HTTPS with the media type `application/json` and the bearer token. It goes through
 * `callService` of `@interopkit/core`: a redirect is an error, because it would send the token elsewhere, the answer has
 * at most 65,536 bytes, and the call ends at `timeoutMs` even when `fetch` ignores its signal.
 *
 * Nothing is retried and nothing is kept between calls. A call that fails after the request left may still have reached the
 * endpoint, so a host that retries sends the same events again with a new `sendTime`: their identifiers are the same,
 * which lets an endpoint that keeps an event once by its `id` hold each event once. Caliper defines no deduplication, so an
 * endpoint may hold both copies.
 *
 * @param events - The events, at least one. They are sent as they are.
 * @param options - The endpoint, the token, `fetch`, the sensor, the time of sending, and the optional time limit and
 * signal.
 * @returns Nothing; the promise resolves when the endpoint answered with a status from 200 to 299.
 * @throws `DataError` when an argument has the wrong type or value, before any request.
 * @throws `ServiceError` with status `0` when the endpoint did not answer in time, and with its status and body when it
 * answered with another status than 2xx, with a redirect or with more than 65,536 bytes; Caliper names 400, 401, 415 and
 * 422.
 * @throws The `reason` of `options.signal` when it aborts, before or during the call. A request in flight may have
 * reached the endpoint.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}, transport
 */
export async function sendCaliper(events: readonly CaliperEvent[], options: SendCaliperOptions): Promise<void> {
  checkOptions(options);
  checkEvents(events);
  const { endpoint, token, sensor, sendTime, fetch, signal, timeoutMs = DEFAULT_CALIPER_TIMEOUT_MS } = options;
  const envelope = {
    sensor,
    sendTime: caliperTime(sendTime, "The option sendTime"),
    dataVersion: CALIPER_CONTEXT,
    data: events,
  };
  await callService({ fetch, timeoutMs, signal }, `The Caliper endpoint at ${endpoint}`, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(envelope),
  });
}
