import { type CallOptions, DataError, requestService } from "@interopkit/core";
import { checkRecord, MAX_JSON_DEPTH, nestsDeeperThan, parseWith } from "@interopkit/core/checks";
import type { EndpointConfiguration } from "../model/index.js";
import { endpointConfigurationSchema } from "./configuration.js";
import { bearerHeaders, type CaliperSender, checkSender, DEFAULT_CALIPER_TIMEOUT_MS } from "./sender.js";

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

/** The statuses that a ping returns as values: every one a service answers with but a redirect, which no call follows. */
const PING_STATUSES: readonly number[] = Array.from({ length: 500 }, (_, at) => 100 + at).filter(
  (status) => status < 300 || status >= 400,
);

/**
 * Asks a Caliper endpoint for its configuration and says whether it is available.
 *
 * @remarks
 * The request is a GET over HTTPS with the bearer token when the sender has one. Caliper 1.2 section 6.2 reads 200 as available
 * with the configuration in the body, 401 as unauthorized, and any other status as unavailable. A redirect is an error, as in
 * every call of the package, since it would send the token elsewhere. The answer has at most 65,536 bytes, and its JSON at most
 * 64 levels.
 *
 * @param sender - The endpoint, the token, `fetch`, the sensor and the time limit, as for `sendCaliper`.
 * @param options - The signal that ends the caller's wait.
 * @returns What the endpoint said: available with its configuration, unauthorized, or unavailable with its status.
 * @throws `DataError` when an argument has the wrong type or value, before any request, and when the endpoint answers 200 with
 * a body that is not JSON, nests deeper than 64 levels, or is not the configuration of section 6.2.
 * @throws `ServiceError` with status `0` when the endpoint did not answer in time, and with its status when it answered with a
 * redirect or with more than 65,536 bytes.
 * @throws The `reason` of `options.signal` when it aborts, before or during the call.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2#configuration-information | Caliper Analytics 1.2, Configuration Information}
 */
export async function pingEndpoint(sender: CaliperSender, options?: CallOptions): Promise<PingResult> {
  checkSender(sender);
  checkRecord(options ?? {}, "The options must be an object");
  const { endpoint, token, fetch, timeoutMs = DEFAULT_CALIPER_TIMEOUT_MS } = sender;
  const what = `The Caliper endpoint at ${endpoint}`;
  const answer = await requestService(
    { fetch, timeoutMs, signal: options?.signal },
    what,
    endpoint,
    { method: "GET", headers: bearerHeaders(token) },
    { expect: PING_STATUSES },
  );
  if (answer.status === 401) return { status: "unauthorized" };
  if (answer.status !== 200) return { status: "unavailable", httpStatus: answer.status };
  // The answer has at most 65,536 bytes, so it has far fewer tokens than the limit of a text of JSON: only its depth is counted.
  const text = new TextDecoder().decode(answer.body);
  if (nestsDeeperThan(text, MAX_JSON_DEPTH)) {
    throw new DataError(`${what} answered with JSON that nests deeper than the limit of ${MAX_JSON_DEPTH} levels.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DataError(`${what} answered with a body that is not JSON.`);
  }
  return {
    status: "available",
    configuration: parseWith(endpointConfigurationSchema, value, "The configuration of the endpoint"),
  };
}
