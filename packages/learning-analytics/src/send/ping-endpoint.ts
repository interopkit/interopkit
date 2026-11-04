import { type CallOptions, DEFAULT_TIMEOUT_MS, readAnswerJson, requestService } from "@interopkit/core";
import { parseWith, readCallOptions, strictRecord } from "@interopkit/core/checks";
import type { EndpointConfiguration } from "../model/index.js";
import { endpointConfigurationSchema } from "./configuration.js";
import { bearerHeaders, type CaliperSender, senderEntries } from "./sender.js";

/** What a ping found: the endpoint answered with its configuration, refused the token, or is not serving. */
export type PingResult =
  | {
      /** The endpoint answered 200 with its configuration. */
      readonly status: "available";
      /** What the endpoint says of itself. */
      readonly configuration: EndpointConfiguration;
    }
  | {
      /** The endpoint answered 401: it did not accept the token, or wants one. */
      readonly status: "unauthorized";
    }
  | {
      /** The endpoint answered with another status than 200 and 401, which Caliper reads as unavailable. */
      readonly status: "unavailable";
      /** The HTTP status that it answered with. */
      readonly httpStatus: number;
    };

/** The lowest and the highest HTTP status, of the classes 1xx to 5xx (RFC 9110 section 15). */
const LOWEST_STATUS = 100;
const HIGHEST_STATUS = 599;

/** The first status of the class of redirects, and the first of the class after it. */
const FIRST_REDIRECT = 300;
const FIRST_CLIENT_ERROR = 400;

const optionsSchema = strictRecord(senderEntries);

/** The statuses that a ping returns as values: every one a service answers with but a redirect, which no call follows. */
const PING_STATUSES: readonly number[] = Array.from(
  { length: HIGHEST_STATUS - LOWEST_STATUS + 1 },
  (_, at) => LOWEST_STATUS + at,
).filter((status) => status < FIRST_REDIRECT || status >= FIRST_CLIENT_ERROR);

/**
 * Asks a Caliper endpoint for its configuration and says whether it is available.
 *
 * @remarks
 * The request is a GET over HTTPS with the bearer token when the sender has one. Caliper 1.2 section 6.2 reads 200 as available
 * with the configuration in the body, 401 as unauthorized, and any other status as unavailable. A redirect is an error, as in
 * every call of the package, since it would send the token elsewhere. The answer has at most 65,536 bytes, and its JSON at most
 * 64 levels.
 *
 * @param sender - The endpoint, the token, `fetch` and the time limit, as for `sendCaliper`. A ping sends no sensor.
 * @param options - The signal that ends the caller's wait.
 * @returns What the endpoint said: available with its configuration, unauthorized, or unavailable with its status.
 * @throws `DataError` when an argument has the wrong type or value, before any request, and when the endpoint answers 200 with
 * a body that is not JSON, or is not the configuration of section 6.2.
 * @throws `LimitError` when the JSON of a 200 nests deeper than 64 levels.
 * @throws `ServiceError` with status `0` when the endpoint did not answer in time, and with its status when it answered with a
 * redirect or with more than 65,536 bytes.
 * @throws The `reason` of `options.signal` when it aborts, before or during the call.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2#configuration-information | Caliper Analytics 1.2, Configuration Information}
 */
export async function pingEndpoint(sender: Omit<CaliperSender, "sensor">, options?: CallOptions): Promise<PingResult> {
  parseWith(optionsSchema, sender, "The options");
  const { signal } = readCallOptions(options);
  const { endpoint, token, fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = sender;
  const what = `The Caliper endpoint at ${endpoint}`;
  const answer = await requestService(
    { fetch, timeoutMs, signal },
    what,
    endpoint,
    { method: "GET", headers: bearerHeaders(token) },
    { expect: PING_STATUSES },
  );
  if (answer.status === 401) return { status: "unauthorized" };
  if (answer.status !== 200) return { status: "unavailable", httpStatus: answer.status };
  return {
    status: "available",
    configuration: parseWith(
      endpointConfigurationSchema,
      readAnswerJson(answer, what),
      "The configuration of the endpoint",
    ),
  };
}
