// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import type { Fetch } from "@interopkit/core";
import { DataError } from "@interopkit/core";
import { checkHttpsUrl, checkRecord, checkString } from "@interopkit/core/checks";
import { checkIri } from "../build/index.js";

/** The time that a call to the endpoint may take when the host sets none, in milliseconds. */
export const DEFAULT_CALIPER_TIMEOUT_MS = 10_000;

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
   * @defaultValue {@link DEFAULT_CALIPER_TIMEOUT_MS}, `10000`
   */
  readonly timeoutMs?: number;
}

/**
 * Checks the options that a sensor reads itself, as a host passes them from JavaScript. `fetch`, `timeoutMs` and `signal` are
 * checked by the call to the service.
 */
export function checkSender(value: unknown): asserts value is CaliperSender {
  checkRecord(value, "The options must be an object");
  checkHttpsUrl(value.endpoint, "The option endpoint");
  if (value.token !== undefined) {
    checkString(value.token, "The option token");
    if (!BEARER_TOKEN.test(value.token)) {
      throw new DataError(
        "The option token must be a bearer token of RFC 6750 section 2.1: letters, digits and -._~+/, then =.",
      );
    }
  }
  checkIri(value.sensor, "The option sensor");
}

/** The header that carries the bearer token, and none when the sender has no token. */
export function bearerHeaders(token: string | undefined): Readonly<Record<string, string>> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}
