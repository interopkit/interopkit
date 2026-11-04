// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import { type CallOptions, callService, DataError, DEFAULT_TIMEOUT_MS, LimitError } from "@interopkit/core";
import {
  checkArray,
  checkNonEmptyString,
  checkRecord,
  describe,
  formatDateTime,
  parseWith,
} from "@interopkit/core/checks";
import { CALIPER_CONTEXT, type CaliperEvent, type EntityDocument, LIBRARY_PROFILE_CONTEXT } from "../model/index.js";
import { bearerHeaders, type CaliperSender, sendOptionsSchema } from "./sender.js";

/** The options of {@link sendCaliper}: the sender, when it sends, how much it sends, and the signal that ends the caller's wait. */
export interface SendCaliperOptions extends CaliperSender, CallOptions {
  /** The time at which the sensor issues the message, in epoch milliseconds. A resend has the time of the resend. */
  readonly sendTime: number;
  /**
   * The most bytes of the envelope that the endpoint takes, which is its `caliperMaximumPayloadSize` in kilobytes times 1,024. An
   * envelope of more bytes is refused before any request.
   *
   * @defaultValue none
   */
  readonly maxPayloadBytes?: number;
}

/** Checks the events and entity describes to send: at least one, each with the Caliper context and an identifier. */
function checkData(data: unknown): asserts data is readonly (CaliperEvent | EntityDocument)[] {
  checkArray(data, "The Caliper data must be an array");
  if (data.length === 0) {
    throw new DataError("The Caliper data must have at least one event or entity describe, as an envelope does.");
  }
  data.forEach((item, at) => {
    checkRecord(item, `The Caliper item ${at} must be an object`);
    const context = item["@context"];
    const last = Array.isArray(context) ? context.at(-1) : context;
    if (last !== CALIPER_CONTEXT && last !== LIBRARY_PROFILE_CONTEXT) {
      throw new DataError(
        `The @context of the Caliper item ${at} must be ${CALIPER_CONTEXT}, the context of the Library Use Profile, or a list that ends with one of them, found ${describe(context)}.`,
      );
    }
    checkNonEmptyString(item.id, `The id of the Caliper item ${at}`);
  });
}

/** Writes the JSON text of an envelope: data that JSON cannot write, such as a bigint or an item that holds itself, is invalid. */
function envelopeText(envelope: Readonly<Record<string, unknown>>): string {
  try {
    return JSON.stringify(envelope);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DataError(`The Caliper data must be JSON: ${reason}`, { cause: error });
  }
}

/**
 * Sends events and entity describes to a Caliper endpoint in one envelope.
 *
 * @remarks
 * The request is a POST over HTTPS with the media type `application/json`, and the bearer token when the sender has one. It
 * goes through `callService` of `@interopkit/core`: a redirect is an error, because it would send the token elsewhere, the answer
 * has at most 65,536 bytes, and the call ends at `timeoutMs` even when `fetch` ignores its signal.
 *
 * Events and entity describes may be mixed in `data`, as Caliper 1.2 section 5.2 allows. They are sent as they are, so that a
 * describe of an entity that the events refer to reaches the endpoint with them: the envelope is their JSON text.
 *
 * Nothing is retried and nothing is kept between calls. A call that fails after the request left may still have reached the
 * endpoint, so a host that retries sends the same data again with a new `sendTime`: the identifiers of the events are the same,
 * which lets an endpoint that keeps an event once by its `id` hold each event once. Caliper defines no deduplication, so an
 * endpoint may hold both copies.
 *
 * @param data - The events and entity describes, at least one. They are sent as they are.
 * @param options - The endpoint, the token, `fetch`, the sensor, the time of sending, and the optional time limit, size limit
 * and signal.
 * @returns Nothing; the promise resolves when the endpoint answered with a status from 200 to 299.
 * @throws `DataError` when an argument has the wrong type or value, such as data that JSON cannot write, or when the envelope
 * has more bytes than `maxPayloadBytes`, before any request.
 * @throws `ServiceError` with status `0` when the endpoint did not answer in time, and with its status and body when it
 * answered with another status than 2xx, with a redirect or with more than 65,536 bytes; Caliper names 400, 401, 415 and
 * 422.
 * @throws The `reason` of `options.signal` when it aborts, before or during the call. A request in flight may have
 * reached the endpoint.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}, transport
 */
export async function sendCaliper(
  data: readonly (CaliperEvent | EntityDocument)[],
  options: SendCaliperOptions,
): Promise<void> {
  parseWith(sendOptionsSchema, options, "The options");
  checkData(data);
  const { endpoint, token, sensor, sendTime, fetch, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const body = envelopeText({
    sensor,
    sendTime: formatDateTime(sendTime),
    dataVersion: CALIPER_CONTEXT,
    data,
  });
  const { maxPayloadBytes } = options;
  if (maxPayloadBytes !== undefined) {
    const size = new TextEncoder().encode(body).byteLength;
    if (size > maxPayloadBytes) {
      throw new LimitError(
        `The envelope has ${size} bytes, above the option maxPayloadBytes of ${maxPayloadBytes}: send fewer events and entities in each envelope.`,
        "maxPayloadBytes",
        maxPayloadBytes,
      );
    }
  }
  await callService({ fetch, timeoutMs, signal }, `The Caliper endpoint at ${endpoint}`, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearerHeaders(token) },
    body,
  });
}
