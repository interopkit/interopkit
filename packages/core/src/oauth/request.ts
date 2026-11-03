// biome-ignore-all lint/style/useNamingConvention: OAuth is a name of the specification, and the API names it as such.

import * as oauth from "oauth4webapi";
import { checkRecord } from "../checks.js";
import { type Clock, checkClock } from "../clock.js";
import { ServiceError } from "../errors.js";
import { checkServiceCall, requestService, type ServiceCall, type ServiceResponse } from "../service.js";

/** What a call to an authorization server needs: the `fetch`, the deadline, the signal and the clock. */
export interface OAuthCallOptions extends ServiceCall {
  /**
   * Gives the time of an assertion and of the expiry of a token.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
}

/** The statuses that oauth4webapi reads: success, and the two that carry an error (RFC 6749 section 5.2, RFC 7235). */
const READ_STATUSES = [200, 201, 400, 401];

/** The request that oauth4webapi makes, as it hands it to the `fetch` that replaces its own. */
interface LibraryRequest {
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: URLSearchParams | string;
}

/** The `fetch` that oauth4webapi calls instead of its own, which is how every request goes through `requestService`. */
type LibraryFetch = (url: string, init: LibraryRequest) => Promise<Response>;

/**
 * Checks the options of a call.
 *
 * @throws `DataError` when `fetch`, `timeoutMs`, `signal` or `clock` is not valid.
 */
export function checkOAuthCallOptions(options: unknown): asserts options is OAuthCallOptions {
  checkRecord(options, "The options of a call must be an object");
  checkServiceCall(options);
  checkClock(options.clock);
}

/** Turns what oauth4webapi throws into what a caller of this module expects: a `ServiceError` for a refusal by the server. */
function refusal(error: unknown, what: string, answer: ServiceResponse | undefined): unknown {
  const status = answer?.status ?? 0;
  const body = new TextDecoder().decode(answer?.body);
  if (error instanceof oauth.ResponseBodyError) {
    const description = error.error_description === undefined ? "" : ` (${error.error_description})`;
    return new ServiceError(`${what} refused the request: ${error.error}${description}.`, error.status, body);
  }
  if (error instanceof oauth.WWWAuthenticateChallengeError) {
    return new ServiceError(
      `${what} answered ${error.status} and challenged the client to authenticate.`,
      error.status,
      body,
    );
  }
  const invalid = error instanceof oauth.OperationProcessingError || error instanceof oauth.UnsupportedOperationError;
  if (invalid && answer !== undefined) {
    return new ServiceError(`${what} answered with a response that is not valid: ${error.message}.`, status, body);
  }
  return error;
}

/**
 * Runs the requests of one operation of oauth4webapi through `requestService`, so that the deadline, the size limit, the
 * refusal of redirects and the signals of this package hold for them too.
 *
 * @param options - The `fetch`, the deadline and the signal.
 * @param what - Names the service in the error messages.
 * @param operation - Makes the requests with the `fetch` it is given, and reads their answers.
 * @returns What the operation returns.
 * @throws `ServiceError` when the service does not answer, answers with an error status, or refuses the request with an OAuth error.
 */
export async function exchange<T>(
  options: OAuthCallOptions,
  what: string,
  operation: (through: { readonly [oauth.customFetch]: LibraryFetch }) => Promise<T>,
): Promise<T> {
  options.signal?.throwIfAborted();
  const seen: { answer?: ServiceResponse } = {};
  const through = {
    [oauth.customFetch]: async (url: string, init: LibraryRequest): Promise<Response> => {
      const answer = await requestService(
        options,
        what,
        url,
        { method: init.method, headers: init.headers, body: init.body.toString() },
        { expect: READ_STATUSES },
      );
      seen.answer = answer;
      return new Response(answer.body, { status: answer.status, headers: answer.headers });
    },
  };
  try {
    return await operation(through);
  } catch (error) {
    throw refusal(error, what, seen.answer);
  }
}
